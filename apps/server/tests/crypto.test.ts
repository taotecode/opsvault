import { describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {
  encryptSecret,
  decryptSecret,
  getMasterKey,
  hashPassword,
  verifyPassword,
  generateTotpSecret,
  verifyTotpCode,
  totpUri,
  generatePassword,
  passwordStrength,
} from '../src/lib/crypto.js';
import { generateSshKeyPair, prepareImportedPrivateKey, parsePublicKey } from '../src/lib/sshKeys.js';
import { loadConfig } from '../src/config.js';
import { TOTP, Secret } from 'otpauth';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsvault-crypto-'));
const config = loadConfig({
  dataDir: dir,
  db: { driver: 'sqlite', path: path.join(dir, 'unused.db') },
  baseUrl: 'http://localhost',
});

describe('crypto', () => {
  it('envelope encryption round-trips and rejects tampering', () => {
    const key = getMasterKey(config);
    const env = encryptSecret('top-secret-value', key);
    expect(env.encryptedValue).not.toContain('top-secret');
    expect(decryptSecret(env, key)).toBe('top-secret-value');
    const tampered = { ...env, valueTag: env.dekTag };
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it('argon2id hashes verify correctly', async () => {
    const hash = await hashPassword('CorrectHorse1!');
    expect(hash.startsWith('$argon2id$') || hash.startsWith('$argon2')).toBe(true);
    expect(await verifyPassword(hash, 'CorrectHorse1!')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('totp generate/verify works', () => {
    const secret = generateTotpSecret();
    const otp = new TOTP({ secret: Secret.fromBase32(secret) });
    const code = otp.generate();
    expect(verifyTotpCode(secret, code)).toBe(true);
    expect(verifyTotpCode(secret, '000000')).toBe(false);
    expect(totpUri(secret, 'admin@example.com')).toContain('otpauth://totp/');
  });

  it('password generator respects options and strength', () => {
    const pw = generatePassword({ length: 24, uppercase: true, lowercase: true, digits: true, symbols: true });
    expect(pw).toHaveLength(24);
    expect(/[A-Z]/.test(pw)).toBe(true);
    expect(/[a-z]/.test(pw)).toBe(true);
    expect(/\d/.test(pw)).toBe(true);
    expect(/[^A-Za-z0-9]/.test(pw)).toBe(true);
    expect(passwordStrength(pw)).toBe('strong');
    expect(passwordStrength('short')).toBe('weak');
  });
});

describe('ssh key material', () => {
  it('generates OpenSSH Ed25519 keys parseable by import flow', async () => {
    const generated = await generateSshKeyPair('Ed25519');
    expect(generated.privateKeyPem).toContain('BEGIN OPENSSH PRIVATE KEY');
    const parsed = await prepareImportedPrivateKey(generated.privateKeyPem);
    expect(parsed.algorithm).toBe('Ed25519');
    expect(parsed.fingerprint).toBe(generated.fingerprint);
    expect(parsed.publicText.split(' ')[0]).toBe('ssh-ed25519');
    expect(parsePublicKey(generated.publicKeyText).fingerprint).toBe(generated.fingerprint);
  });

  it('rejects unsupported PKCS8 ed25519 with a clear error', async () => {
    const crypto = await import('node:crypto');
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    await expect(prepareImportedPrivateKey(pem)).rejects.toThrow(/OpenSSH|格式/);
  });
});
