import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Kysely } from 'kysely';
import type { AppConfig } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { createDatabase, migrateToLatest } from '../src/db/database.js';
import type { DatabaseSchema } from '../src/db/types.js';
import { decryptSecret, encryptSecret } from '../src/lib/crypto.js';
import { rotateMasterKey } from '../src/lib/masterKeyRotation.js';

let dir: string;
let config: AppConfig;
let db: Kysely<DatabaseSchema>;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsvault-mk-'));
  config = loadConfig({
    dataDir: dir,
    db: { driver: 'sqlite', path: path.join(dir, 'mk.db') },
    baseUrl: 'http://localhost',
    sessionDays: 1,
    revealWindowMinutes: 5,
    isProd: false,
    logLevel: 'silent',
  });
  db = createDatabase(config.db);
  await migrateToLatest(db);
});

afterAll(async () => {
  await db?.destroy().catch(() => undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('master key rotation', () => {
  it('re-wraps credentials, keypair private keys and TOTP secrets', async () => {
    const oldKey = crypto.randomBytes(32);
    const newKey = crypto.randomBytes(32);
    const now = new Date().toISOString();

    const credEnv = encryptSecret('credential-value', oldKey);
    await db
      .insertInto('credentials')
      .values({
        id: 'cred-1',
        name: 'c1',
        type: 'password',
        encrypted_dek: credEnv.encryptedDek,
        encrypted_value: credEnv.encryptedValue,
        dek_iv: credEnv.dekIv,
        dek_tag: credEnv.dekTag,
        value_iv: credEnv.valueIv,
        value_tag: credEnv.valueTag,
        fingerprint: null,
        strength: null,
        owner_id: 'system',
        updated_by: 'test',
        created_at: now,
        updated_at: now,
      })
      .execute();

    await db
      .insertInto('keypairs')
      .values({
        id: 'kp-1',
        name: 'k1',
        algorithm: 'Ed25519',
        source: 'generated',
        public_key: 'ssh-ed25519 AAAA test',
        encrypted_private_key: JSON.stringify(encryptSecret('PRIVATE-KEY', oldKey)),
        private_iv: null,
        private_tag: null,
        fingerprint: 'SHA256:test',
        has_private: 1,
        last_verified_at: null,
        created_by: 'test',
        created_at: now,
      })
      .execute();

    await db
      .insertInto('users')
      .values({
        id: 'user-1',
        username: 'u1',
        email: 'u1@example.com',
        password_hash: '$argon2id$dummy',
        role: 'admin',
        totp_secret_enc: JSON.stringify(encryptSecret('TOTP-SECRET', oldKey)),
        totp_enabled: 1,
        status: 'active',
        created_at: now,
      } as never)
      .execute();

    const stats = await rotateMasterKey(db, oldKey, newKey);
    expect(stats).toEqual({ credentials: 1, keypairs: 1, totp: 1 });

    const cred = await db.selectFrom('credentials').selectAll().where('id', '=', 'cred-1').executeTakeFirstOrThrow();
    const credAfter = {
      encryptedDek: cred.encrypted_dek,
      encryptedValue: cred.encrypted_value,
      dekIv: cred.dek_iv,
      dekTag: cred.dek_tag,
      valueIv: cred.value_iv,
      valueTag: cred.value_tag,
    };
    expect(decryptSecret(credAfter, newKey)).toBe('credential-value');
    expect(() => decryptSecret(credAfter, oldKey)).toThrow();

    const kp = await db.selectFrom('keypairs').selectAll().where('id', '=', 'kp-1').executeTakeFirstOrThrow();
    const kpEnv = JSON.parse(kp.encrypted_private_key!) as Parameters<typeof decryptSecret>[0];
    expect(decryptSecret(kpEnv, newKey)).toBe('PRIVATE-KEY');

    const user = await db.selectFrom('users').selectAll().where('id', '=', 'user-1').executeTakeFirstOrThrow();
    const totpEnv = JSON.parse(user.totp_secret_enc!) as Parameters<typeof decryptSecret>[0];
    expect(decryptSecret(totpEnv, newKey)).toBe('TOTP-SECRET');
  });
});
