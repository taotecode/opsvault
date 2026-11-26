import type { Kysely } from 'kysely';
import { ulid } from 'ulid';
import type { AppConfig } from '../config.js';
import type { DatabaseSchema, KeypairsTable, HostsTable } from '../db/types.js';
import {
  encryptSecret,
  getMasterKey,
} from '../lib/crypto.js';
import {
  decryptKeypairPrivate,
  execRemote,
  openSsh,
  persistHostFingerprint,
  resolveHostAuth,
} from '../lib/ssh.js';
import {
  generateSshKeyPair,
  parsePublicKey,
  prepareImportedPrivateKey,
} from '../lib/sshKeys.js';
import { errors } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import type { Actor } from '../lib/actor.js';
import type { KeypairImportInput } from '@opsvault/shared';
import { getHostRow } from './hosts.js';

export interface KeypairDto {
  id: string;
  name: string;
  algorithm: string;
  source: string;
  fingerprint: string;
  hasPrivate: boolean;
  publicKey: string;
  deployed: number;
  verified: number;
  failed: number;
  lastVerifiedAt: string | null;
  createdBy: string;
  createdAt: string;
  hosts: Array<{ hostId: string; hostName: string; verifyOk: boolean | null }>;
}

export interface QuickConnectDto {
  keypairId: string;
  keyName: string;
  keyFile: string;
  hostId: string;
  hostName: string;
  address: string;
  port: number;
  sshUser: string;
  ssh: string;
  scp: string;
  deployed: boolean;
}

function keypairDto(
  kp: KeypairsTable,
  deployments: Array<{ host_id: string; host_name: string; verify_ok: number | null }>,
): KeypairDto {
  return {
    id: kp.id,
    name: kp.name,
    algorithm: kp.algorithm,
    source: kp.source,
    fingerprint: kp.fingerprint,
    hasPrivate: !!kp.has_private,
    publicKey: kp.public_key,
    deployed: deployments.length,
    verified: deployments.filter((d) => d.verify_ok === 1).length,
    failed: deployments.filter((d) => d.verify_ok === 0).length,
    lastVerifiedAt: kp.last_verified_at,
    createdBy: kp.created_by,
    createdAt: kp.created_at,
    hosts: deployments.map((d) => ({ hostId: d.host_id, hostName: d.host_name, verifyOk: d.verify_ok === null ? null : !!d.verify_ok })),
  };
}

async function deploymentsFor(
  db: Kysely<DatabaseSchema>,
  keypairIds: string[],
): Promise<Map<string, Array<{ host_id: string; host_name: string; verify_ok: number | null }>>> {
  const map = new Map<string, Array<{ host_id: string; host_name: string; verify_ok: number | null }>>();
  if (!keypairIds.length) return map;
  const rows = await db
    .selectFrom('key_deployments')
    .innerJoin('hosts', 'hosts.id', 'key_deployments.host_id')
    .select([
      'key_deployments.keypair_id',
      'key_deployments.host_id',
      'key_deployments.verify_ok',
      'hosts.name as host_name',
    ])
    .where('key_deployments.keypair_id', 'in', keypairIds)
    .execute();
  for (const r of rows) {
    const list = map.get(r.keypair_id) ?? [];
    list.push({ host_id: r.host_id, host_name: r.host_name, verify_ok: r.verify_ok });
    map.set(r.keypair_id, list);
  }
  return map;
}

function encryptPrivateKey(privateKey: string, config: AppConfig): string {
  return JSON.stringify(encryptSecret(privateKey, getMasterKey(config)));
}

export async function listKeypairs(db: Kysely<DatabaseSchema>): Promise<KeypairDto[]> {
  const rows = await db.selectFrom('keypairs').selectAll().orderBy('created_at', 'desc').execute();
  const deployments = await deploymentsFor(db, rows.map((r) => r.id));
  return rows.map((r) => keypairDto(r, deployments.get(r.id) ?? []));
}

export async function getKeypairRow(
  db: Kysely<DatabaseSchema>,
  id: string,
): Promise<KeypairsTable> {
  const row = await db.selectFrom('keypairs').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw errors.notFound('密钥对');
  return row;
}

export async function getKeypairDto(
  db: Kysely<DatabaseSchema>,
  id: string,
): Promise<KeypairDto> {
  const row = await getKeypairRow(db, id);
  const deployments = await deploymentsFor(db, [id]);
  return keypairDto(row, deployments.get(id) ?? []);
}

export async function generateKeypair(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  input: { name: string; algorithm: 'Ed25519' | 'RSA-4096' },
  actor: Actor,
): Promise<KeypairDto & { privateKey: string }> {
  const generated = await generateSshKeyPair(input.algorithm);
  const now = new Date().toISOString();
  const id = ulid();
  await db
    .insertInto('keypairs')
    .values({
      id,
      name: input.name,
      algorithm: generated.algorithm,
      source: 'generated',
      public_key: generated.publicKeyText,
      encrypted_private_key: encryptPrivateKey(generated.privateKeyPem, config),
      private_iv: null,
      private_tag: null,
      fingerprint: generated.fingerprint,
      has_private: 1,
      last_verified_at: null,
      created_by: actor.label,
      created_at: now,
    })
    .execute();
  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '生成密钥对',
    category: 'key',
    targetId: id,
    detail: { name: input.name, algorithm: generated.algorithm },
    ip: actor.ip,
    ua: actor.ua,
  });
  return { ...(await getKeypairDto(db, id)), privateKey: generated.privateKeyPem };
}

export async function importKeypair(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  input: KeypairImportInput,
  actor: Actor,
): Promise<KeypairDto> {
  let algorithm: 'Ed25519' | 'RSA-4096';
  let publicKey: string;
  let fingerprint: string;
  let privateText: string | null = null;
  if (input.privateKey) {
    const parsed = await prepareImportedPrivateKey(input.privateKey, input.passphrase);
    algorithm = parsed.algorithm;
    publicKey = parsed.publicText;
    fingerprint = parsed.fingerprint;
    privateText = parsed.privateText;
  } else {
    const parsed = parsePublicKey(input.publicKey!);
    algorithm = parsed.algorithm;
    publicKey = parsed.publicText;
    fingerprint = parsed.fingerprint;
  }
  const now = new Date().toISOString();
  const id = ulid();
  await db
    .insertInto('keypairs')
    .values({
      id,
      name: input.name,
      algorithm,
      source: 'imported',
      public_key: publicKey,
      encrypted_private_key: privateText ? encryptPrivateKey(privateText, config) : null,
      private_iv: null,
      private_tag: null,
      fingerprint,
      has_private: privateText ? 1 : 0,
      last_verified_at: null,
      created_by: actor.label,
      created_at: now,
    })
    .execute();
  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '导入密钥',
    category: 'key',
    targetId: id,
    detail: { name: input.name, algorithm, hasPrivate: !!privateText },
    ip: actor.ip,
    ua: actor.ua,
  });
  return getKeypairDto(db, id);
}

export async function deleteKeypair(
  db: Kysely<DatabaseSchema>,
  id: string,
  actor: Actor,
): Promise<void> {
  const kp = await getKeypairRow(db, id);
  await db.updateTable('hosts').set({ keypair_id: null }).where('keypair_id', '=', id).execute();
  await db.deleteFrom('keypairs').where('id', '=', id).execute();
  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '删除密钥对',
    category: 'key',
    targetId: id,
    detail: { name: kp.name },
    ip: actor.ip,
    ua: actor.ua,
  });
}

function keyFileFor(kp: KeypairsTable): string {
  return `${kp.name.replace(/[^a-zA-Z0-9._-]/g, '_')}.pem`;
}

export function quickConnectFor(
  kp: KeypairsTable,
  host: HostsTable,
  deployed: boolean,
): QuickConnectDto {
  const keyFile = keyFileFor(kp);
  const ssh = `ssh -i ~/.ssh/${keyFile} -p ${host.port} ${host.ssh_user}@${host.address}`;
  const scp = `scp -i ~/.ssh/${keyFile} ./local-file ${host.ssh_user}@${host.address}:/opt/`;
  return {
    keypairId: kp.id,
    keyName: kp.name,
    keyFile,
    hostId: host.id,
    hostName: host.name,
    address: host.address,
    port: host.port,
    sshUser: host.ssh_user,
    ssh,
    scp,
    deployed,
  };
}

export async function connectCommand(
  db: Kysely<DatabaseSchema>,
  keypairId: string,
  hostId?: string,
): Promise<QuickConnectDto> {
  const kp = await getKeypairRow(db, keypairId);
  let host: HostsTable | undefined;
  let deployed = false;
  if (hostId) {
    host = await getHostRow(db, hostId);
    const d = await db
      .selectFrom('key_deployments')
      .select('host_id')
      .where('keypair_id', '=', keypairId)
      .where('host_id', '=', hostId)
      .executeTakeFirst();
    deployed = !!d;
  } else {
    const d = await db
      .selectFrom('key_deployments')
      .innerJoin('hosts', 'hosts.id', 'key_deployments.host_id')
      .selectAll('hosts')
      .where('key_deployments.keypair_id', '=', keypairId)
      .executeTakeFirst();
    if (d) {
      host = d as unknown as HostsTable;
      deployed = true;
    } else {
      host = await db
        .selectFrom('hosts')
        .selectAll()
        .where('keypair_id', '=', keypairId)
        .executeTakeFirst();
      if (!host) host = await db.selectFrom('hosts').selectAll().orderBy('created_at', 'asc').executeTakeFirst();
    }
  }
  if (!host) throw errors.notFound('服务器');
  return quickConnectFor(kp, host, deployed);
}

function appendKeyCommand(publicKey: string): string {
  const parts = publicKey.trim().split(/\s+/);
  const keyLine = parts.slice(0, 2).join(' ');
  if (!/^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+$/.test(keyLine)) {
    throw errors.conflict('公钥格式无效，拒绝写入 authorized_keys');
  }
  return `umask 077; mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"; touch "$HOME/.ssh/authorized_keys"; grep -qxF '${keyLine}' "$HOME/.ssh/authorized_keys" 2>/dev/null || echo '${keyLine}' >> "$HOME/.ssh/authorized_keys"`;
}

export async function deployKeypair(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  keypairId: string,
  hostIds: string[],
  actor: Actor,
): Promise<Array<{ hostId: string; hostName: string; ok: boolean; error?: string }>> {
  const kp = await getKeypairRow(db, keypairId);
  const cmd = appendKeyCommand(kp.public_key);
  const results: Array<{ hostId: string; hostName: string; ok: boolean; error?: string }> = [];
  for (const hostId of hostIds) {
    let hostName = hostId;
    try {
      const host = await getHostRow(db, hostId);
      hostName = host.name;
      const auth = await resolveHostAuth(db, config, host);
      const opened = await openSsh(host, auth, host.host_key_fp);
      try {
        await persistHostFingerprint(db, host.id, host.host_key_fp, opened.fingerprint);
        const res = await execRemote(opened.client, cmd, 15_000);
        if (res.code !== 0) {
          throw errors.sshConnect(`部署命令失败（退出码 ${res.code ?? 'unknown'}）`);
        }
      } finally {
        opened.client.end();
      }
      const now = new Date().toISOString();
      await db
        .insertInto('key_deployments')
        .values({
          keypair_id: keypairId,
          host_id: hostId,
          deployed_by: actor.label,
          deployed_at: now,
          verify_ok: null,
          verified_at: null,
        })
        .onConflict((oc) =>
          oc.columns(['keypair_id', 'host_id']).doUpdateSet({
            deployed_by: actor.label,
            deployed_at: now,
          }),
        )
        .execute();
      await writeAudit(db, {
        actorId: actor.id,
        actorLabel: actor.label,
        actorKind: actor.kind,
        action: '部署公钥',
        category: 'key',
        targetId: hostId,
        detail: { keypair: kp.name, host: host.name },
        ip: actor.ip,
        ua: actor.ua,
        success: true,
      });
      results.push({ hostId, hostName: host.name, ok: true });
    } catch (e) {
      await writeAudit(db, {
        actorId: actor.id,
        actorLabel: actor.label,
        actorKind: actor.kind,
        action: '部署公钥',
        category: 'key',
        targetId: hostId,
        detail: { keypair: kp.name, host: hostName, error: (e as Error).message },
        ip: actor.ip,
        ua: actor.ua,
        success: false,
      });
      results.push({ hostId, hostName, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

export async function verifyKeypair(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  keypairId: string,
  hostIds: string[] | undefined,
  actor: Actor,
): Promise<Array<{ hostId: string; hostName: string; ok: boolean; error?: string }>> {
  const kp = await getKeypairRow(db, keypairId);
  if (!kp.has_private || !kp.encrypted_private_key) {
    throw errors.conflict('该密钥仅含公钥，无法进行私钥认证检测');
  }
  const deployments = await db
    .selectFrom('key_deployments')
    .innerJoin('hosts', 'hosts.id', 'key_deployments.host_id')
    .select([
      'key_deployments.host_id',
      'hosts.name as host_name',
      'hosts.address',
      'hosts.port',
      'hosts.ssh_user',
      'hosts.host_key_fp',
    ])
    .where('key_deployments.keypair_id', '=', keypairId)
    .execute();
  const targetIds = hostIds?.length ? hostIds : deployments.map((d) => d.host_id);
  const results: Array<{ hostId: string; hostName: string; ok: boolean; error?: string }> = [];
  const privateKey = decryptKeypairPrivate(kp, config);
  for (const hostId of targetIds) {
    const host = await getHostRow(db, hostId);
    try {
      const opened = await openSsh(host, { username: host.ssh_user, privateKey, source: 'verify' }, host.host_key_fp);
      try {
        await persistHostFingerprint(db, host.id, host.host_key_fp, opened.fingerprint);
        const res = await execRemote(opened.client, 'true', 10_000);
        if (res.code !== 0) {
          throw errors.sshAuth(`验证命令失败（退出码 ${res.code ?? 'unknown'}）`);
        }
      } finally {
        opened.client.end();
      }
      const now = new Date().toISOString();
      await db
        .updateTable('key_deployments')
        .set({ verify_ok: 1, verified_at: now })
        .where('keypair_id', '=', keypairId)
        .where('host_id', '=', hostId)
        .execute();
      await db.updateTable('hosts').set({ keypair_id: keypairId }).where('id', '=', hostId).execute();
      results.push({ hostId, hostName: host.name, ok: true });
    } catch (e) {
      const now = new Date().toISOString();
      await db
        .updateTable('key_deployments')
        .set({ verify_ok: 0, verified_at: now })
        .where('keypair_id', '=', keypairId)
        .where('host_id', '=', hostId)
        .execute();
      results.push({ hostId, hostName: host.name, ok: false, error: (e as Error).message });
    }
  }
  await db
    .updateTable('keypairs')
    .set({ last_verified_at: new Date().toISOString() })
    .where('id', '=', keypairId)
    .execute();
  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '检测密钥可用性',
    category: 'key',
    targetId: keypairId,
    detail: {
      keypair: kp.name,
      total: results.length,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    },
    ip: actor.ip,
    ua: actor.ua,
    success: results.every((r) => r.ok),
  });
  return results;
}

export function decryptPrivateForDownload(kp: KeypairsTable, config: AppConfig): string {
  return decryptKeypairPrivate(kp, config);
}
