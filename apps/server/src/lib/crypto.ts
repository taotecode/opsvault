import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Algorithm, hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { Secret, TOTP } from 'otpauth';
import type { AppConfig } from '../config.js';

export const ARGON_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

const b64 = (b: Buffer) => b.toString('base64');
const fromB64 = (s: string) => Buffer.from(s, 'base64');

let cachedMasterKey: Buffer | null = null;

export function getMasterKey(config: AppConfig): Buffer {
  if (cachedMasterKey) return cachedMasterKey;
  if (config.masterKey) {
    const key = fromB64(config.masterKey.trim());
    if (key.length !== 32) throw new Error('MASTER_KEY must be base64 of 32 bytes');
    cachedMasterKey = key;
    return key;
  }
  const keyFile = path.join(config.dataDir, 'master.key');
  if (fs.existsSync(keyFile)) {
    const key = fromB64(fs.readFileSync(keyFile, 'utf8').trim());
    if (key.length !== 32) throw new Error('invalid data/master.key');
    cachedMasterKey = key;
    return key;
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, b64(key), { mode: 0o600 });

  console.log(`[setup] 已生成主密钥文件 ${keyFile}，请与数据库一起备份`);
  cachedMasterKey = key;
  return key;
}

export interface EncryptedEnvelope {
  encryptedDek: string;
  encryptedValue: string;
  dekIv: string;
  dekTag: string;
  valueIv: string;
  valueTag: string;
}

function gcmEncrypt(key: Buffer, data: Buffer): { data: Buffer; iv: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return { data: encrypted, iv: b64(iv), tag: b64(cipher.getAuthTag()) };
}

function gcmDecrypt(key: Buffer, data: Buffer, ivB64: string, tagB64: string): Buffer {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, fromB64(ivB64));
  decipher.setAuthTag(fromB64(tagB64));
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** 信封加密：每条密文独立随机 DEK，DEK 由主密钥加密 */
export function encryptSecret(plain: string, masterKey: Buffer): EncryptedEnvelope {
  const dek = crypto.randomBytes(32);
  const value = gcmEncrypt(dek, Buffer.from(plain, 'utf8'));
  const wrapped = gcmEncrypt(masterKey, dek);
  return {
    encryptedDek: b64(wrapped.data),
    encryptedValue: b64(value.data),
    dekIv: wrapped.iv,
    dekTag: wrapped.tag,
    valueIv: value.iv,
    valueTag: value.tag,
  };
}

export function decryptSecret(row: EncryptedEnvelope, masterKey: Buffer): string {
  const dek = gcmDecrypt(masterKey, fromB64(row.encryptedDek), row.dekIv, row.dekTag);
  return gcmDecrypt(dek, fromB64(row.encryptedValue), row.valueIv, row.valueTag).toString('utf8');
}

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTIONS);
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hashValue, password);
  } catch {
    return false;
  }
}

export const sha256Hex = (s: string) =>
  crypto.createHash('sha256').update(s).digest('hex');

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function newApiToken(): { token: string; hash: string; prefix: string } {
  const token = 'ovt_' + crypto.randomBytes(32).toString('hex');
  return { token, hash: sha256Hex(token), prefix: token.slice(0, 12) };
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* ---------- installer setup token ---------- */
export function getOrCreateSetupToken(dataDir: string): string {
  const file = path.join(dataDir, 'setup.token');
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  }
  const token =
    crypto.randomBytes(4).toString('hex').toUpperCase() +
    '-' +
    crypto.randomBytes(4).toString('hex').toUpperCase();
  fs.writeFileSync(file, token, { mode: 0o600 });
  return token;
}

export function clearSetupToken(dataDir: string): void {
  try {
    fs.rmSync(path.join(dataDir, 'setup.token'));
  } catch {
    /* ignore */
  }
}

/* ---------- TOTP ---------- */
export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function totpFrom(secret: string): TOTP {
  return new TOTP({
    issuer: 'OpsVault',
    label: 'admin',
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
}

export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    const delta = totpFrom(secret).validate({ token: code.replace(/\s/g, ''), window: 1 });
    return delta !== null;
  } catch {
    return false;
  }
}

export function totpUri(secret: string, account: string): string {
  return new TOTP({
    issuer: 'OpsVault',
    label: account,
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).toString();
}

/* ---------- password helpers ---------- */
export function generatePassword(opts: {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
}): string {
  const sets: string[] = [];
  if (opts.uppercase) sets.push('ABCDEFGHJKLMNPQRSTUVWXYZ');
  if (opts.lowercase) sets.push('abcdefghijkmnopqrstuvwxyz');
  if (opts.digits) sets.push('23456789');
  if (opts.symbols) sets.push('!@#$%^&*-_+=?');
  if (!sets.length) sets.push('abcdefghijkmnopqrstuvwxyz');
  const all = sets.join('');
  const pick = (s: string) => s[crypto.randomInt(s.length)]!;
  const chars = sets.map(pick);
  while (chars.length < opts.length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.slice(0, opts.length).join('');
}

export function passwordStrength(pw: string): 'strong' | 'medium' | 'weak' {
  let score = 0;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score >= 5 ? 'strong' : score >= 3 ? 'medium' : 'weak';
}
