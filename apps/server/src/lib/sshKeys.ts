import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ssh2 from 'ssh2';

const execFileAsync = promisify(execFile);

export interface SshPublicKeyInfo {
  publicText: string;
  blob: Buffer;
  fingerprint: string;
  algorithm: 'Ed25519' | 'RSA-4096';
  type: string;
}

export interface SshPrivateKeyInfo extends SshPublicKeyInfo {
  privateText: string;
}

export function fingerprintOfBlob(blob: Buffer): string {
  const digest = crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
  return `SHA256:${digest}`;
}

export function publicKeyTextFromBlob(type: string, blob: Buffer, comment = ''): string {
  const suffix = comment ? ` ${comment}` : '';
  return `${type} ${blob.toString('base64')}${suffix}`;
}

function algorithmFor(type: string): 'Ed25519' | 'RSA-4096' {
  if (type.includes('ed25519')) return 'Ed25519';
  if (type.includes('rsa')) return 'RSA-4096';
  throw new Error(`unsupported key type: ${type}`);
}

export function parsePublicKey(text: string): SshPublicKeyInfo {
  const trimmed = text.trim();
  const parsed = ssh2.utils.parseKey(trimmed) as unknown;
  if (parsed instanceof Error) throw parsed;
  if (Array.isArray(parsed) && parsed.length > 1) throw new Error('multiple keys are not supported');
  const key = (Array.isArray(parsed) ? parsed[0] : parsed) as {
    type?: string;
    getPublicSSH?: () => Buffer;
  };
  const blob = key.getPublicSSH?.();
  if (!blob) throw new Error('public key parse failed');
  const type = key.type || trimmed.split(/\s+/)[0] || '';
  const algorithm = algorithmFor(type);
  return {
    publicText: trimmed.startsWith('ssh-') || trimmed.startsWith('ecdsa-')
      ? trimmed
      : publicKeyTextFromBlob(type, blob),
    blob,
    fingerprint: fingerprintOfBlob(blob),
    algorithm,
    type,
  };
}

export function parsePrivateKey(text: string, passphrase?: string): SshPrivateKeyInfo {
  const normalized = text.trim() + (text.endsWith('\n') ? '' : '\n');
  const parsed = ssh2.utils.parseKey(normalized, passphrase || undefined) as unknown;
  if (parsed instanceof Error) throw parsed;
  if (Array.isArray(parsed) && parsed.length > 1) throw new Error('multiple keys are not supported');
  const key = (Array.isArray(parsed) ? parsed[0] : parsed) as {
    type?: string;
    getPublicSSH?: () => Buffer;
    isPrivateKey?: () => boolean;
  };
  if (key.isPrivateKey && !key.isPrivateKey()) throw new Error('not a private key');
  const blob = key.getPublicSSH?.();
  if (!blob) throw new Error('private key parse failed');
  const type = key.type || 'ssh-ed25519';
  const algorithm = algorithmFor(type);
  return {
    privateText: normalized,
    publicText: publicKeyTextFromBlob(type, blob),
    blob,
    fingerprint: fingerprintOfBlob(blob),
    algorithm,
    type,
  };
}

export async function generateSshKeyPair(algorithm: 'Ed25519' | 'RSA-4096'): Promise<{
  privateKeyPem: string;
  publicKeyText: string;
  fingerprint: string;
  algorithm: 'Ed25519' | 'RSA-4096';
}> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boerfen-key-'));
  const keyPath = path.join(dir, 'id_key');
  try {
    const args = [
      '-t',
      algorithm === 'Ed25519' ? 'ed25519' : 'rsa',
      ...(algorithm === 'RSA-4096' ? ['-b', '4096'] : []),
      '-N',
      '',
      '-C',
      'boerfen-assets',
      '-f',
      keyPath,
    ];
    try {
      await execFileAsync('ssh-keygen', args, { timeout: 20_000 });
    } catch (e) {
      const message = (e as NodeJS.ErrnoException).code === 'ENOENT'
        ? '系统缺少 ssh-keygen（请安装 openssh-client）'
        : (e as Error).message;
      throw new Error(`密钥生成失败：${message}`, { cause: e });
    }
    const privateKeyPem = fs.readFileSync(keyPath, 'utf8');
    const publicKeyText = fs.readFileSync(`${keyPath}.pub`, 'utf8').trim();
    const parsed = parsePublicKey(publicKeyText);
    return {
      privateKeyPem,
      publicKeyText,
      fingerprint: parsed.fingerprint,
      algorithm,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 规范化用户上传的私钥：
 * - 支持 OpenSSH 私钥与 RSA PKCS#1；Ed25519 PKCS#8 不受 ssh2 支持，将给出明确提示。
 * - 若带口令，使用 ssh-keygen 去除口令，保存解密后的 OpenSSH 私钥（平台会再次加密存储）。
 */
export async function prepareImportedPrivateKey(
  text: string,
  passphrase?: string,
): Promise<SshPrivateKeyInfo> {
  const trimmed = text.trim();
  let parsed = ssh2.utils.parseKey(trimmed, passphrase || undefined) as unknown;
  if (parsed instanceof Error) {
    throw new Error(
      parsed.message.includes('Unsupported key format')
        ? '无法解析该私钥格式；请使用 ssh-keygen 生成的 OpenSSH 私钥（Ed25519 请勿使用 PKCS#8）'
        : parsed.message,
    );
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boerfen-import-'));
  const keyPath = path.join(dir, 'id_key');
  try {
    const hasPassphrase = !!passphrase;
    if (hasPassphrase) {
      fs.writeFileSync(keyPath, trimmed.endsWith('\n') ? trimmed : trimmed + '\n', { mode: 0o600 });
      try {
        await execFileAsync('ssh-keygen', ['-p', '-P', passphrase, '-N', '', '-f', keyPath], {
          timeout: 10_000,
        });
      } catch (e) {
        throw new Error('口令不正确或私钥无法解密', { cause: e });
      }
      const decrypted = fs.readFileSync(keyPath, 'utf8');
      parsed = ssh2.utils.parseKey(decrypted) as unknown;
      if (parsed instanceof Error) throw new Error(parsed.message);
      return finishParsed(decrypted, parsed);
    }
    return finishParsed(trimmed.endsWith('\n') ? trimmed : trimmed + '\n', parsed);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function finishParsed(text: string, parsed: unknown): SshPrivateKeyInfo {
  if (Array.isArray(parsed) && parsed.length > 1) throw new Error('multiple keys are not supported');
  const key = (Array.isArray(parsed) ? parsed[0] : parsed) as {
    type?: string;
    getPublicSSH?: () => Buffer;
    isPrivateKey?: () => boolean;
  };
  if (key.isPrivateKey && !key.isPrivateKey()) throw new Error('not a private key');
  const blob = key.getPublicSSH?.();
  if (!blob) throw new Error('private key parse failed');
  const type = key.type || 'ssh-ed25519';
  const algorithm = algorithmFor(type);
  return {
    privateText: text,
    publicText: publicKeyTextFromBlob(type, blob),
    blob,
    fingerprint: fingerprintOfBlob(blob),
    algorithm,
    type,
  };
}

export function parseAuthorizedKeyLine(text: string): SshPublicKeyInfo {
  return parsePublicKey(text);
}
