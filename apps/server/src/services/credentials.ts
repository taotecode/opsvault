import type { Kysely } from 'kysely';
import { ulid } from 'ulid';
import type { AppConfig } from '../config.js';
import type { DatabaseSchema, CredentialsTable } from '../db/types.js';
import type { CredentialCreateInput } from '@opsvault/shared';
import { encryptSecret, getMasterKey, passwordStrength } from '../lib/crypto.js';
import { decryptCredentialValue } from '../lib/ssh.js';
import { parsePrivateKey } from '../lib/sshKeys.js';
import { errors } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import { credentialCheckSummary, type HostCredentialView } from './credentialChecks.js';
import type { Actor } from '../lib/actor.js';

export interface CredentialDto {
  id: string;
  name: string;
  type: string;
  strength: string | null;
  fingerprint: string | null;
  hostCount: number;
  hosts: string[];
  /** 关联主机的 ID（编辑表单用；主机名不唯一，不能拿名字回填） */
  hostIds: string[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  /** 关联主机的认证检测概况；未关联主机时为 null */
  checkSummary: { usable: number; failed: number; unchecked: number; lastCheckedAt: string | null } | null;
}

function credentialDto(
  c: CredentialsTable,
  hostNames: string[],
  checks: { usable: number; failed: number; unchecked: number; hosts: HostCredentialView[] } | undefined,
  hostIds: string[],
): CredentialDto {
  const checkedAt = checks?.hosts
    .map((h) => h.lastCheckedAt)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1) ?? null;
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    strength: c.strength,
    fingerprint: c.fingerprint,
    hostCount: hostNames.length,
    hosts: hostNames,
    hostIds,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    updatedBy: c.updated_by,
    checkSummary: checks
      ? { usable: checks.usable, failed: checks.failed, unchecked: checks.unchecked, lastCheckedAt: checkedAt }
      : null,
  };
}

async function hostNamesForCredential(
  db: Kysely<DatabaseSchema>,
  credentialId: string,
): Promise<{ names: string[]; ids: string[] }> {
  const direct = await db
    .selectFrom('hosts')
    .select(['id', 'name'])
    .where('credential_id', '=', credentialId)
    .execute();
  const linked = await db
    .selectFrom('host_credentials')
    .innerJoin('hosts', 'hosts.id', 'host_credentials.host_id')
    .select(['hosts.id as id', 'hosts.name as name'])
    .where('host_credentials.credential_id', '=', credentialId)
    .execute();
  const rows = [...direct, ...linked];
  return {
    names: [...new Set(rows.map((d) => d.name))],
    ids: [...new Set(rows.map((d) => d.id))],
  };
}

export async function listCredentials(
  db: Kysely<DatabaseSchema>,
): Promise<CredentialDto[]> {
  const rows = await db.selectFrom('credentials').selectAll().orderBy('created_at', 'desc').execute();
  const summaries = await credentialCheckSummary(db);
  const result: CredentialDto[] = [];
  for (const row of rows) {
    const hosts = await hostNamesForCredential(db, row.id);
    result.push(credentialDto(row, hosts.names, summaries.get(row.id), hosts.ids));
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
        .values({ host_id: hostId, credential_id: id, role: 'linked', created_at: new Date().toISOString() })
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
  const hosts = await hostNamesForCredential(db, id);
  return credentialDto(
    (await db.selectFrom('credentials').selectAll().where('id', '=', id).executeTakeFirst())!,
    hosts.names,
    (await credentialCheckSummary(db)).get(id),
    hosts.ids,
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
      // 重建关联时保留原有的 primary 角色，避免改名把主凭据降级
      const existing = await trx
        .selectFrom('host_credentials')
        .select(['host_id', 'role'])
        .where('credential_id', '=', id)
        .execute();
      const roleByHost = new Map(existing.map((r) => [r.host_id, r.role]));
      await trx.deleteFrom('host_credentials').where('credential_id', '=', id).execute();
      for (const hostId of hostIds) {
        await trx
          .insertInto('host_credentials')
          .values({
            host_id: hostId,
            credential_id: id,
            role: roleByHost.get(hostId) ?? 'linked',
            created_at: new Date().toISOString(),
          })
          .onConflict((oc) => oc.doNothing())
          .execute();
      }
      let clear = trx
        .updateTable('hosts')
        .set({ credential_id: null })
        .where('credential_id', '=', id);
      if (hostIds.length) clear = clear.where('id', 'not in', hostIds);
      await clear.execute();
      for (const hostId of hostIds) {
        const role = roleByHost.get(hostId);
        if (role === 'primary') {
          await trx.updateTable('hosts').set({ credential_id: id }).where('id', '=', hostId).execute();
        } else {
          await trx
            .updateTable('hosts')
            .set({ credential_id: id })
            .where('id', '=', hostId)
            .where('credential_id', 'is', null)
            .execute();
        }
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
  const hosts = await hostNamesForCredential(db, id);
  return credentialDto(
    (await db.selectFrom('credentials').selectAll().where('id', '=', id).executeTakeFirst())!,
    hosts.names,
    (await credentialCheckSummary(db)).get(id),
    hosts.ids,
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
