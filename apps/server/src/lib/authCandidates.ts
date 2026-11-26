import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { AppConfig } from '../config.js';
import type { DatabaseSchema, HostsTable } from '../db/types.js';
import { decryptCredentialValue, decryptKeypairPrivate, openSsh } from './ssh.js';
import type { Client } from 'ssh2';
import { parsePrivateKey } from './sshKeys.js';
import { errors } from './errors.js';

export interface AuthCandidate {
  /** credential:<id> 或 keypair:<id> */
  ref: string;
  kind: 'keypair' | 'password' | 'ssh_key';
  label: string;
  role: 'primary' | 'linked' | 'host-keypair' | 'explicit';
  auth: { username: string; password?: string; privateKey?: string };
}

export interface CandidateCheck {
  ref: string;
  label: string;
  role: AuthCandidate['role'];
  ok: boolean;
  error?: string;
}

export interface AuthAttemptResult {
  client: Client;
  fingerprint: string | null;
  candidate: AuthCandidate;
  checks: CandidateCheck[];
}

function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/\s+/g, ' ').slice(0, 240);
}

/**
 * 收集一台主机的候选认证方式，按尝试顺序：
 * 1) 主机绑定的密钥对（hosts.keypair_id）
 * 2) 显式指定的凭据（手动选择）
 * 3) host_credentials 中 role=primary 的凭据
 * 4) 其余关联凭据（linked），按关联创建时间
 */
export async function collectAuthCandidates(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  host: HostsTable,
  explicitCredentialId?: string,
): Promise<AuthCandidate[]> {
  const out: AuthCandidate[] = [];
  const username = host.ssh_user;

  const pushKeypair = async (id: string, role: AuthCandidate['role']): Promise<void> => {
    const kp = await db.selectFrom('keypairs').selectAll().where('id', '=', id).executeTakeFirst();
    if (!kp || !kp.has_private) return;
    out.push({
      ref: `keypair:${kp.id}`,
      kind: 'keypair',
      label: kp.name,
      role,
      auth: { username, privateKey: decryptKeypairPrivate(kp, config) },
    });
  };

  if (host.keypair_id) await pushKeypair(host.keypair_id, 'host-keypair');

  const pushCredential = async (row: { id: string; name: string; type: string }, role: AuthCandidate['role']): Promise<void> => {
    if (out.some((c) => c.ref === `credential:${row.id}`)) return;
    const full = await db.selectFrom('credentials').selectAll().where('id', '=', row.id).executeTakeFirst();
    if (!full) return;
    const value = decryptCredentialValue(full, config);
    if (full.type === 'password') {
      out.push({ ref: `credential:${full.id}`, kind: 'password', label: full.name, role, auth: { username, password: value } });
      return;
    }
    if (full.type === 'ssh_key') {
      const parsed = parsePrivateKey(value);
      out.push({ ref: `credential:${full.id}`, kind: 'ssh_key', label: full.name, role, auth: { username, privateKey: parsed.privateText } });
    }
  };

  if (explicitCredentialId) {
    const row = await db.selectFrom('credentials').select(['id', 'name', 'type']).where('id', '=', explicitCredentialId).executeTakeFirst();
    if (!row) throw errors.notFound('凭据');
    await pushCredential(row, 'explicit');
    // 手动选择：只尝试该凭据，不回退到其他凭据
    return out;
  }

  const links = await db
    .selectFrom('host_credentials')
    .innerJoin('credentials', 'credentials.id', 'host_credentials.credential_id')
    .select(['credentials.id', 'credentials.name', 'credentials.type', 'host_credentials.role', 'host_credentials.created_at'])
    .where('host_credentials.host_id', '=', host.id)
    .orderBy(sql<number>`case when "host_credentials"."role" = 'primary' then 0 else 1 end`)
    .orderBy('host_credentials.created_at', 'asc')
    .execute();
  for (const link of links) {
    await pushCredential(link, link.role === 'primary' ? 'primary' : 'linked');
  }

  // 兼容旧数据：hosts.credential_id 未写入关联表时也纳入候选
  if (host.credential_id && !out.some((c) => c.ref === `credential:${host.credential_id}`)) {
    const row = await db.selectFrom('credentials').select(['id', 'name', 'type']).where('id', '=', host.credential_id).executeTakeFirst();
    if (row) await pushCredential(row, 'primary');
  }

  return out;
}

/** 记录每个候选用（凭据）在一台主机上的检测结果，供列表展示与后续排序。 */
export async function recordCredentialCheck(
  db: Kysely<DatabaseSchema>,
  hostId: string,
  candidate: AuthCandidate,
  ok: boolean,
  error?: string,
): Promise<void> {
  if (!candidate.ref.startsWith('credential:')) return;
  const credentialId = candidate.ref.slice('credential:'.length);
  await db
    .updateTable('host_credentials')
    .set({
      last_check_ok: ok ? 1 : 0,
      last_check_error: ok ? null : (error ?? '认证失败'),
      last_checked_at: new Date().toISOString(),
    })
    .where('host_id', '=', hostId)
    .where('credential_id', '=', credentialId)
    .execute();
}

/**
 * 依次尝试候选认证方式，返回第一个可用连接。每次尝试的结果都会写回凭据校验状态。
 * @throws 最后一次的认证错误（附全部尝试摘要）
 */
export async function openWithFallback(
  db: Kysely<DatabaseSchema>,
  host: Pick<HostsTable, 'id' | 'address' | 'port'>,
  candidates: AuthCandidate[],
  storedFingerprint: string | null,
  persistFingerprint: (current: string | null, observed: string) => Promise<void>,
): Promise<AuthAttemptResult> {
  if (!candidates.length) throw errors.forbidden('未配置可用的 SSH 凭据或密钥对');
  const checks: CandidateCheck[] = [];
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      const opened = await openSsh(host, { ...candidate.auth, source: candidate.ref }, storedFingerprint);
      if (opened.fingerprint && !storedFingerprint) {
        storedFingerprint = opened.fingerprint;
        await persistFingerprint(null, opened.fingerprint);
      }
      await recordCredentialCheck(db, host.id, candidate, true);
      checks.push({ ref: candidate.ref, label: candidate.label, role: candidate.role, ok: true });
      return { client: opened.client, fingerprint: opened.fingerprint ?? storedFingerprint, candidate, checks };
    } catch (e) {
      lastError = e;
      const message = describeError(e);
      await recordCredentialCheck(db, host.id, candidate, false, message).catch(() => undefined);
      checks.push({ ref: candidate.ref, label: candidate.label, role: candidate.role, ok: false, error: message });
    }
  }

  const base = lastError instanceof Error ? lastError : new Error('SSH 认证失败');
  const summary = checks.map((c) => `${c.label}: ${c.ok ? '可用' : c.error ?? '失败'}`).join('；');
  const err = new Error(`${base.message}（尝试 ${checks.length} 个认证方式：${summary}）`, { cause: lastError });
  (err as Error & { statusCode?: number }).statusCode = (base as Error & { statusCode?: number }).statusCode ?? 502;
  throw err;
}
