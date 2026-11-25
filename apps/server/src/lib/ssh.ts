import crypto from 'node:crypto';
import { Client, type ConnectConfig } from 'ssh2';
import type { Kysely } from 'kysely';
import type { AppConfig } from '../config.js';
import type { DatabaseSchema, HostsTable } from '../db/types.js';
import { decryptSecret, getMasterKey } from './crypto.js';
import { writeAudit } from './audit.js';
import { errors } from './errors.js';
import { parsePrivateKey } from './sshKeys.js';

export interface SshAuth {
  username: string;
  password?: string;
  privateKey?: string;
  source: string;
}

interface KeypairPrivateRow {
  encrypted_private_key: string | null;
  private_iv: string | null;
  private_tag: string | null;
}

function fingerprintOfHostKey(data: Buffer): string {
  return `SHA256:${crypto.createHash('sha256').update(data).digest('base64').replace(/=+$/, '')}`;
}

export function decryptKeypairPrivate(
  row: KeypairPrivateRow,
  config: AppConfig,
): string {
  if (!row.encrypted_private_key) {
    throw errors.conflict('该密钥不含私钥，无法用于认证');
  }
  const raw = row.encrypted_private_key;
  try {
    const envelope = JSON.parse(raw) as {
      encryptedDek?: string;
      encryptedValue?: string;
      dekIv?: string;
      dekTag?: string;
      valueIv?: string;
      valueTag?: string;
    };
    if (envelope.encryptedDek && envelope.encryptedValue && envelope.dekIv && envelope.dekTag && envelope.valueIv && envelope.valueTag) {
      return decryptSecret(
        {
          encryptedDek: envelope.encryptedDek,
          encryptedValue: envelope.encryptedValue,
          dekIv: envelope.dekIv,
          dekTag: envelope.dekTag,
          valueIv: envelope.valueIv,
          valueTag: envelope.valueTag,
        },
        getMasterKey(config),
      );
    }
  } catch {
    /* fall through to legacy format */
  }
  if (!row.private_iv || !row.private_tag) {
    throw errors.conflict('私钥数据不完整');
  }
  return decryptSecret(
    {
      encryptedDek: '',
      encryptedValue: raw,
      dekIv: '',
      dekTag: '',
      valueIv: row.private_iv,
      valueTag: row.private_tag,
    },
    getMasterKey(config),
  );
}

export function decryptCredentialValue(
  row: {
    encrypted_dek: string;
    encrypted_value: string;
    dek_iv: string;
    dek_tag: string;
    value_iv: string;
    value_tag: string;
  },
  config: AppConfig,
): string {
  return decryptSecret(
    {
      encryptedDek: row.encrypted_dek,
      encryptedValue: row.encrypted_value,
      dekIv: row.dek_iv,
      dekTag: row.dek_tag,
      valueIv: row.value_iv,
      valueTag: row.value_tag,
    },
    getMasterKey(config),
  );
}

export async function resolveHostAuth(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  host: HostsTable,
  overrideKeypairId?: string,
): Promise<SshAuth> {
  const keypairId = overrideKeypairId || host.keypair_id;
  if (keypairId) {
    const kp = await db.selectFrom('keypairs').selectAll().where('id', '=', keypairId).executeTakeFirst();
    if (!kp) throw errors.notFound('密钥对');
    if (!kp.has_private) throw errors.conflict('该密钥仅含公钥，不能用于登录');
    const privateKey = decryptKeypairPrivate(kp, config);
    return { username: host.ssh_user, privateKey, source: `keypair:${kp.name}` };
  }
  if (host.credential_id) {
    const cred = await db
      .selectFrom('credentials')
      .selectAll()
      .where('id', '=', host.credential_id)
      .executeTakeFirst();
    if (!cred) throw errors.notFound('凭据');
    const value = decryptCredentialValue(cred, config);
    if (cred.type === 'password') {
      return { username: host.ssh_user, password: value, source: `credential:${cred.name}` };
    }
    if (cred.type === 'ssh_key') {
      const parsed = parsePrivateKey(value);
      return { username: host.ssh_user, privateKey: parsed.privateText, source: `credential:${cred.name}` };
    }
    throw errors.conflict('该凭据类型不支持 SSH 登录');
  }
  throw errors.forbidden('未配置 SSH 凭据或密钥对');
}

export function sshConfig(
  host: Pick<HostsTable, 'address' | 'port'>,
  auth: SshAuth,
  hostKeyFp: string | null,
): { config: ConnectConfig; getFingerprint: () => string | null } {
  let observed: string | null = null;
  const config: ConnectConfig = {
    host: host.address,
    port: host.port,
    username: auth.username,
    readyTimeout: 10_000,
    hostVerifier: (key: Buffer | string) => {
      const raw = typeof key === 'string' ? Buffer.from(key, 'hex') : key;
      observed = fingerprintOfHostKey(raw);
      if (hostKeyFp && observed !== hostKeyFp) {
        // TOFU：指纹变化拒绝连接
        return false;
      }
      return true;
    },
  };
  if (auth.password) config.password = auth.password;
  if (auth.privateKey) config.privateKey = auth.privateKey;
  return { config, getFingerprint: () => observed };
}

export interface OpenSshResult {
  client: Client;
  fingerprint: string | null;
}

export function openSsh(
  host: Pick<HostsTable, 'address' | 'port'>,
  auth: SshAuth,
  storedFingerprint: string | null,
): Promise<OpenSshResult> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const built = sshConfig(host, auth, storedFingerprint);
    let settled = false;
    client.once('ready', () => {
      settled = true;
      resolve({ client, fingerprint: built.getFingerprint() });
    });
    client.once('error', (err) => {
      if (settled) return;
      settled = true;
      const msg = err.message || 'connection failed';
      if (/verification|host key/i.test(msg) || msg === 'Host key verification failed') {
        reject(errors.sshAuth('主机密钥指纹校验失败（可能发生中间人攻击）'));
      } else if (/authentication|all configured authentication/i.test(msg)) {
        reject(errors.sshAuth(msg));
      } else {
        reject(errors.sshConnect(msg));
      }
    });
    client.connect(built.config);
  });
}

export function execRemote(
  client: Client,
  command: string,
  timeoutMs = 20_000,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        client.end();
      } catch {
        /* ignore */
      }
      reject(errors.internal('SSH 命令执行超时'));
    }, timeoutMs);
    client.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(errors.sshConnect(err.message));
        return;
      }
      let stdout = '';
      let stderr = '';
      stream.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      stream.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      stream.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve({ stdout, stderr, code });
      });
    });
  });
}

export async function persistHostFingerprint(
  db: Kysely<DatabaseSchema>,
  hostId: string,
  current: string | null,
  observed: string | null,
): Promise<void> {
  if (!current && observed) {
    await db.updateTable('hosts').set({ host_key_fp: observed }).where('id', '=', hostId).execute();
    await writeAudit(db, {
      actorLabel: 'system',
      actorKind: 'system',
      action: '固定主机指纹',
      category: 'asset',
      targetId: hostId,
      detail: { fingerprint: observed },
      success: true,
    });
  }
}
