import type { Kysely } from 'kysely';
import type { AppConfig } from '../config.js';
import type { DatabaseSchema } from '../db/types.js';
import { decryptCredentialValue, openSsh } from '../lib/ssh.js';
import { parsePrivateKey } from '../lib/sshKeys.js';
import { getHostRow } from './hosts.js';
import { errors } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import type { Actor } from '../lib/actor.js';

export interface CredentialCheckResult {
  hostId: string;
  hostName: string;
  ok: boolean;
  error?: string;
  checkedAt: string;
}

export interface HostCredentialView {
  id: string;
  name: string;
  type: string;
  role: string;
  strength: string | null;
  hasCheck: boolean;
  lastCheckOk: boolean | null;
  lastCheckError: string | null;
  lastCheckedAt: string | null;
}

function describeError(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 240);
}

async function buildAuthForCredential(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  credentialId: string,
  username: string,
): Promise<{ username: string; password?: string; privateKey?: string }> {
  const cred = await db.selectFrom('credentials').selectAll().where('id', '=', credentialId).executeTakeFirst();
  if (!cred) throw errors.notFound('凭据');
  const value = decryptCredentialValue(cred, config);
  if (cred.type === 'password') return { username, password: value };
  if (cred.type === 'ssh_key') {
    const parsed = parsePrivateKey(value);
    return { username, privateKey: parsed.privateText };
  }
  throw errors.conflict('该凭据类型不支持 SSH 登录');
}

/**
 * 对某条凭据逐个关联主机做 SSH 认证测试，并写回每条关联的可用状态。
 * 只使用该凭据本身，不回退到其他凭据，便于定位失效密码。
 */
export async function testCredentialAgainstHosts(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  credentialId: string,
  hostIds: string[] | undefined,
  actor: Actor,
): Promise<CredentialCheckResult[]> {
  const cred = await db.selectFrom('credentials').selectAll().where('id', '=', credentialId).executeTakeFirst();
  if (!cred) throw errors.notFound('凭据');
  if (!['password', 'ssh_key'].includes(cred.type)) {
    throw errors.conflict('仅密码与 SSH 私钥凭据可用于 SSH 检测');
  }

  const links = await db
    .selectFrom('host_credentials')
    .innerJoin('hosts', 'hosts.id', 'host_credentials.host_id')
    .select(['hosts.id', 'hosts.name'])
    .where('host_credentials.credential_id', '=', credentialId)
    .execute();
  const legacy = await db
    .selectFrom('hosts')
    .select(['id', 'name'])
    .where('credential_id', '=', credentialId)
    .execute();
  const targets = [...new Set([...links.map((l) => l.id), ...legacy.map((l) => l.id)])].filter(
    (id) => !hostIds?.length || hostIds.includes(id),
  );
  if (!targets.length) return [];

  const results: CredentialCheckResult[] = [];
  for (const hostId of targets) {
    const host = await getHostRow(db, hostId);
    const checkedAt = new Date().toISOString();
    try {
      const auth = await buildAuthForCredential(db, config, credentialId, host.ssh_user);
      const opened = await openSsh(host, { ...auth, source: `credential:${cred.name}` }, host.host_key_fp);
      opened.client.end();
      await db
        .updateTable('host_credentials')
        .set({ last_check_ok: 1, last_check_error: null, last_checked_at: checkedAt })
        .where('host_id', '=', hostId)
        .where('credential_id', '=', credentialId)
        .execute();
      results.push({ hostId, hostName: host.name, ok: true, checkedAt });
    } catch (e) {
      const message = describeError(e);
      await db
        .updateTable('host_credentials')
        .set({ last_check_ok: 0, last_check_error: message, last_checked_at: checkedAt })
        .where('host_id', '=', hostId)
        .where('credential_id', '=', credentialId)
        .execute();
      results.push({ hostId, hostName: host.name, ok: false, error: message, checkedAt });
    }
  }

  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '检测凭据可用性',
    category: 'cred',
    targetId: credentialId,
    detail: {
      name: cred.name,
      hosts: results.length,
      usable: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    },
    ip: actor.ip,
    ua: actor.ua,
    success: results.every((r) => r.ok),
  });
  return results;
}

/** 主机维度的关联凭据列表（含每条凭据对该主机的最近检测状态）。 */
export async function hostCredentials(
  db: Kysely<DatabaseSchema>,
): Promise<Map<string, Array<{ id: string; ok: boolean | null; error: string | null; at: string | null; role: string }>>> {
  const rows = await db.selectFrom('host_credentials').selectAll().execute();
  const map = new Map<string, Array<{ id: string; ok: boolean | null; error: string | null; at: string | null; role: string }>>();
  for (const row of rows) {
    const list = map.get(row.host_id) ?? [];
    list.push({
      id: row.credential_id,
      ok: row.last_check_ok === null ? null : !!row.last_check_ok,
      error: row.last_check_error,
      at: row.last_checked_at,
      role: row.role,
    });
    map.set(row.host_id, list);
  }
  return map;
}

/** 凭据页展示：每条凭据在所有关联主机的检测概况。 */
export async function credentialCheckSummary(
  db: Kysely<DatabaseSchema>,
): Promise<Map<string, { usable: number; failed: number; unchecked: number; hosts: HostCredentialView[] }>> {
  const rows = await db
    .selectFrom('host_credentials')
    .innerJoin('credentials', 'credentials.id', 'host_credentials.credential_id')
    .innerJoin('hosts', 'hosts.id', 'host_credentials.host_id')
    .select([
      'host_credentials.host_id',
      'host_credentials.credential_id',
      'host_credentials.role',
      'host_credentials.last_check_ok',
      'host_credentials.last_check_error',
      'host_credentials.last_checked_at',
      'credentials.name as credential_name',
      'credentials.type as credential_type',
      'credentials.strength as credential_strength',
      'hosts.name as host_name',
    ])
    .execute();

  const map = new Map<string, { usable: number; failed: number; unchecked: number; hosts: HostCredentialView[] }>();
  for (const row of rows) {
    const entry = map.get(row.credential_id) ?? { usable: 0, failed: 0, unchecked: 0, hosts: [] };
    if (row.last_check_ok === null) entry.unchecked += 1;
    else if (row.last_check_ok) entry.usable += 1;
    else entry.failed += 1;
    entry.hosts.push({
      id: row.host_id,
      name: row.host_name,
      type: row.credential_type,
      role: row.role,
      strength: row.credential_strength,
      hasCheck: row.last_check_ok !== null,
      lastCheckOk: row.last_check_ok === null ? null : !!row.last_check_ok,
      lastCheckError: row.last_check_error,
      lastCheckedAt: row.last_checked_at,
    });
    map.set(row.credential_id, entry);
  }
  return map;
}

/** 把一条凭据设为主机的主凭据（其余降级为 linked）。 */
export async function setPrimaryCredential(
  db: Kysely<DatabaseSchema>,
  hostId: string,
  credentialId: string,
): Promise<void> {
  const [host, credential] = await Promise.all([
    db.selectFrom('hosts').select('id').where('id', '=', hostId).executeTakeFirst(),
    db.selectFrom('credentials').select('id').where('id', '=', credentialId).executeTakeFirst(),
  ]);
  if (!host) throw errors.notFound('主机');
  if (!credential) throw errors.notFound('凭据');
  await db.transaction().execute(async (trx) => {
    const exists = await trx
      .selectFrom('host_credentials')
      .select(['credential_id'])
      .where('host_id', '=', hostId)
      .where('credential_id', '=', credentialId)
      .executeTakeFirst();
    if (!exists) {
      await trx
        .insertInto('host_credentials')
        .values({ host_id: hostId, credential_id: credentialId, role: 'primary', created_at: new Date().toISOString() })
        .execute();
    }
    await trx
      .updateTable('host_credentials')
      .set({ role: 'linked' })
      .where('host_id', '=', hostId)
      .where('credential_id', '!=', credentialId)
      .execute();
    await trx.updateTable('host_credentials').set({ role: 'primary' }).where('host_id', '=', hostId).where('credential_id', '=', credentialId).execute();
    await trx.updateTable('hosts').set({ credential_id: credentialId }).where('id', '=', hostId).execute();
  });
}
