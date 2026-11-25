import type { Kysely } from 'kysely';
import { ulid } from 'ulid';
import type { AppConfig } from '../config.js';
import type { DatabaseSchema, CredentialsTable } from '../db/types.js';
import type { CredentialCreateInput } from '@boerfen/shared';
import { encryptSecret, getMasterKey, passwordStrength } from '../lib/crypto.js';
import { decryptCredentialValue } from '../lib/ssh.js';
import { parsePrivateKey } from '../lib/sshKeys.js';
import { errors } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import type { Actor } from '../lib/actor.js';

export interface CredentialDto {
  id: string;
  name: string;
  type: string;
  strength: string | null;
  fingerprint: string | null;
  hostCount: number;
  hosts: string[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

function credentialDto(
  c: CredentialsTable,
  hostNames: string[],
): CredentialDto {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    strength: c.strength,
    fingerprint: c.fingerprint,
    hostCount: hostNames.length,
    hosts: hostNames,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    updatedBy: c.updated_by,
  };
}

async function hostNamesForCredential(
  db: Kysely<DatabaseSchema>,
  credentialId: string,
): Promise<string[]> {
  const direct = await db
    .selectFrom('hosts')
    .select(['name'])
    .where('credential_id', '=', credentialId)
    .execute();
  const linked = await db
    .selectFrom('host_credentials')
    .innerJoin('hosts', 'hosts.id', 'host_credentials.host_id')
    .select(['hosts.name'])
    .where('host_credentials.credential_id', '=', credentialId)
    .execute();
  return [...new Set([...direct.map((d) => d.name), ...linked.map((l) => l.name)])];
}

export async function listCredentials(
  db: Kysely<DatabaseSchema>,
): Promise<CredentialDto[]> {
  const rows = await db.selectFrom('credentials').selectAll().orderBy('created_at', 'desc').execute();
  const result: CredentialDto[] = [];
  for (const row of rows) {
    result.push(credentialDto(row, await hostNamesForCredential(db, row.id)));
  }
  return result;
}

export async function createCredential(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  input: CredentialCreateInput,
  actor: Actor,
): Promise<CredentialDto> {
  const hostIds = [...new Set(input.hostIds ?? [])];
  await assertHostsExist(db, hostIds);
  const masterKey = getMasterKey(config);
  let fingerprint: string | null = null;
  if (input.type === 'ssh_key') {
    try {
      fingerprint = parsePrivateKey(input.value).fingerprint;
    } catch {
      fingerprint = null;
    }
  }
  const envelope = encryptSecret(input.value, masterKey);
  const now = new Date().toISOString();
  const id = ulid();
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('credentials')
      .values({
        id,
        name: input.name,
        type: input.type,
        encrypted_dek: envelope.encryptedDek,
        encrypted_value: envelope.encryptedValue,
        dek_iv: envelope.dekIv,
        dek_tag: envelope.dekTag,
        value_iv: envelope.valueIv,
        value_tag: envelope.valueTag,
        fingerprint,
        strength: input.type === 'password' ? passwordStrength(input.value) : null,
        owner_id: actor.id ?? 'system',
        updated_by: actor.label,
        created_at: now,
        updated_at: now,
      })
      .execute();
    for (const hostId of hostIds) {
      await trx
        .insertInto('host_credentials')
        .values({ host_id: hostId, credential_id: id, role: 'linked' })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await trx
        .updateTable('hosts')
        .set({ credential_id: id })
        .where('id', '=', hostId)
        .where('credential_id', 'is', null)
        .execute();
    }
  });
  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '创建凭据',
    category: 'cred',
    targetId: id,
    detail: { name: input.name, type: input.type, hostCount: hostIds.length },
    ip: actor.ip,
    ua: actor.ua,
  });
  return credentialDto(
    (await db.selectFrom('credentials').selectAll().where('id', '=', id).executeTakeFirst())!,
    await hostNamesForCredential(db, id),
  );
}

async function assertHostsExist(
  db: Kysely<DatabaseSchema>,
  hostIds: string[],
): Promise<void> {
  if (!hostIds.length) return;
  const rows = await db
    .selectFrom('hosts')
    .select('id')
    .where('id', 'in', hostIds)
    .execute();
  if (rows.length !== hostIds.length) throw errors.notFound('主机');
}

export async function updateCredential(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  id: string,
  input: { name?: string; value?: string; hostIds?: string[] },
  actor: Actor,
): Promise<CredentialDto> {
  const row = await db.selectFrom('credentials').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw errors.notFound('凭据');
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actor.label };
  if (input.name) updates.name = input.name;
  let fingerprint = row.fingerprint;
  if (input.value) {
    const envelope = encryptSecret(input.value, getMasterKey(config));
    Object.assign(updates, {
      encrypted_dek: envelope.encryptedDek,
      encrypted_value: envelope.encryptedValue,
      dek_iv: envelope.dekIv,
      dek_tag: envelope.dekTag,
      value_iv: envelope.valueIv,
      value_tag: envelope.valueTag,
      strength: row.type === 'password' ? passwordStrength(input.value) : null,
    });
    if (row.type === 'ssh_key') {
      try {
        fingerprint = parsePrivateKey(input.value).fingerprint;
      } catch {
        fingerprint = null;
      }
    }
    updates.fingerprint = fingerprint;
  }
  const hostIds = input.hostIds ? [...new Set(input.hostIds)] : undefined;
  if (hostIds) await assertHostsExist(db, hostIds);
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('credentials').set(updates as never).where('id', '=', id).execute();
    if (hostIds) {
      await trx.deleteFrom('host_credentials').where('credential_id', '=', id).execute();
      for (const hostId of hostIds) {
        await trx
          .insertInto('host_credentials')
          .values({ host_id: hostId, credential_id: id, role: 'linked' })
          .onConflict((oc) => oc.doNothing())
          .execute();
      }
      let clear = trx
        .updateTable('hosts')
        .set({ credential_id: null })
        .where('credential_id', '=', id);
      if (hostIds.length) clear = clear.where('id', 'not in', hostIds);
      await clear.execute();
      if (hostIds.length) {
        await trx
          .updateTable('hosts')
          .set({ credential_id: id })
          .where('id', 'in', hostIds)
          .where('credential_id', 'is', null)
          .execute();
      }
    }
  });
  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '更新凭据',
    category: 'cred',
    targetId: id,
    detail: { name: input.name ?? row.name, rotated: !!input.value },
    ip: actor.ip,
    ua: actor.ua,
  });
  return credentialDto(
    (await db.selectFrom('credentials').selectAll().where('id', '=', id).executeTakeFirst())!,
    await hostNamesForCredential(db, id),
  );
}

export async function deleteCredential(
  db: Kysely<DatabaseSchema>,
  id: string,
  actor: Actor,
): Promise<void> {
  const row = await db.selectFrom('credentials').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw errors.notFound('凭据');
  await db
    .updateTable('hosts')
    .set({ credential_id: null })
    .where('credential_id', '=', id)
    .execute();
  await db.deleteFrom('credentials').where('id', '=', id).execute();
  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '删除凭据',
    category: 'cred',
    targetId: id,
    detail: { name: row.name },
    ip: actor.ip,
    ua: actor.ua,
  });
}

export async function revealCredential(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  id: string,
  actor: Actor,
): Promise<{ value: string; name: string; type: string }> {
  const row = await db.selectFrom('credentials').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw errors.notFound('凭据');
  const value = decryptCredentialValue(row, config);
  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '查看凭据',
    category: 'cred',
    targetId: id,
    detail: { name: row.name, type: row.type },
    ip: actor.ip,
    ua: actor.ua,
  });
  return { value, name: row.name, type: row.type };
}

export function isRevealWindowActive(revealUntil: string | null | undefined): boolean {
  return !!revealUntil && new Date(revealUntil) > new Date();
}
