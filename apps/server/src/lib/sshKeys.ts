import crypto from 'node:crypto';
import ssh2 from 'ssh2';

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

function uint32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function sshString(buf: Buffer): Buffer {
  return Buffer.concat([uint32(buf.length), buf]);
}

function mpint(buf: Buffer): Buffer {
  let b = buf;
  if (b.length === 0) return Buffer.concat([uint32(0), Buffer.alloc(0)]);
  if (b[0]! & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return Buffer.concat([uint32(b.length), b]);
}

function fromBase64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
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

export function generateSshKeyPair(algorithm: 'Ed25519' | 'RSA-4096'): {
  privateKeyPem: string;
  publicKeyText: string;
  fingerprint: string;
  algorithm: 'Ed25519' | 'RSA-4096';
} {
  let privateKeyPem: string;
  let publicKeyText: string;
  if (algorithm === 'Ed25519') {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const jwk = publicKey.export({ format: 'jwk' }) as { x?: string };
    if (!jwk.x) throw new Error('ed25519 export failed');
    const raw = fromBase64url(jwk.x);
    const blob = Buffer.concat([sshString(Buffer.from('ssh-ed25519')), sshString(raw)]);
    publicKeyText = publicKeyTextFromBlob('ssh-ed25519', blob);
  } else {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 4096 });
    privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const jwk = publicKey.export({ format: 'jwk' }) as { n?: string; e?: string };
    if (!jwk.n || !jwk.e) throw new Error('rsa export failed');
    const e = mpint(fromBase64url(jwk.e));
    const n = mpint(fromBase64url(jwk.n));
    const blob = Buffer.concat([sshString(Buffer.from('ssh-rsa')), e, n]);
    publicKeyText = publicKeyTextFromBlob('ssh-rsa', blob);
  }
  const parsed = parsePublicKey(publicKeyText);
  return {
    privateKeyPem,
    publicKeyText,
    fingerprint: parsed.fingerprint,
    algorithm,
  };
}

export function parseAuthorizedKeyLine(text: string): SshPublicKeyInfo {
  return parsePublicKey(text);
}
