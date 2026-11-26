import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { createDatabase, migrateToLatest } from '../src/db/database.js';
import type { DatabaseSchema } from '../src/db/types.js';
import { getOrCreateSetupToken } from '../src/lib/crypto.js';

let app: FastifyInstance;
let config: AppConfig;
let db: Kysely<DatabaseSchema>;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsvault-setup-'));
  config = loadConfig({
    dataDir: dir,
    db: { driver: 'sqlite', path: path.join(dir, 'setup.db') },
    baseUrl: 'http://localhost',
    sessionDays: 1,
    isProd: false,
    logLevel: 'silent',
  });
  db = createDatabase(config.db);
  await migrateToLatest(db);
  app = await buildApp({ config, db, logger: false });
});

afterAll(async () => {
  await app.close();
  await db.destroy().catch(() => undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('setup wizard and lock', () => {
  it('is open before installation and rejects wrong setup token', async () => {
    const status = await app.inject({ method: 'GET', url: '/api/v1/setup/status' });
    expect(status.json().data.installed).toBe(false);
    const bootstrap = await app.inject({ method: 'GET', url: '/api/v1/bootstrap/status' });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json().data.installed).toBe(false);
    const env = await app.inject({ method: 'GET', url: '/api/v1/setup/env-check' });
    expect(env.statusCode).toBe(200);
    expect(env.json().data.nodeVersion).toBe(process.version);
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/verify-token',
      headers: { 'x-setup-token': 'WRONG' },
      payload: {},
    });
    expect(wrong.statusCode).toBe(403);
  });

  it('accepts the console token, completes installation, and permanently locks /setup', async () => {
    const token = getOrCreateSetupToken(config.dataDir);
    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/verify-token',
      headers: { 'x-setup-token': token },
      payload: {},
    });
    expect(verify.statusCode).toBe(200);

    const testDb = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/test-database',
      headers: { 'x-setup-token': token, 'content-type': 'application/json' },
      payload: { database: { driver: 'sqlite', path: 'data/opsvault.db' } },
    });
    expect(testDb.statusCode).toBe(200);
    expect(testDb.json().data.ok).toBe(true);

    const complete = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/complete',
      headers: { 'content-type': 'application/json' },
      payload: {
        token,
        database: { driver: 'sqlite', path: 'data/opsvault.db' },
        admin: { email: 'install-admin@example.com', password: 'InstallPass1!', enableTotp: false },
      },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().data.locked).toBe(true);

    const after = await app.inject({ method: 'GET', url: '/api/v1/setup/status' });
    expect(after.json().data.installed).toBe(true);
    expect(after.json().data.locked).toBe(true);
    expect(fs.existsSync(path.join(dir, 'install.lock'))).toBe(true);

    const verifyAgain = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/verify-token',
      headers: { 'x-setup-token': token },
      payload: {},
    });
    expect(verifyAgain.statusCode).toBe(404);

    const page = await app.inject({ method: 'GET', url: '/setup' });
    expect(page.statusCode).toBe(404);
    const pageSlash = await app.inject({ method: 'GET', url: '/setup/' });
    expect(pageSlash.statusCode).toBe(404);
    const pageIndex = await app.inject({ method: 'GET', url: '/setup/index.html' });
    expect(pageIndex.statusCode).toBe(404);
    const bootstrapAfter = await app.inject({ method: 'GET', url: '/api/v1/bootstrap/status' });
    expect(bootstrapAfter.statusCode).toBe(404);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'install-admin@example.com', password: 'InstallPass1!' },
    });
    expect(login.statusCode).toBe(200);
  });
});
