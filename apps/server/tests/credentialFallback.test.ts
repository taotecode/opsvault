import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Kysely } from 'kysely';
import { loadConfig, type AppConfig } from '../src/config.js';
import { createDatabase, migrateToLatest } from '../src/db/database.js';
import type { DatabaseSchema } from '../src/db/types.js';
import { systemActor } from '../src/lib/actor.js';
import { createHost } from '../src/services/hosts.js';
import { createCredential, updateCredential } from '../src/services/credentials.js';
import { collectAuthCandidates, openWithFallback } from '../src/lib/authCandidates.js';

const sshState = vi.hoisted(() => ({
  /** 每条密码对应的结果：键为密码值。 */
  failingPasswords: new Set<string>(),
  attempts: [] as string[],
}));

vi.mock('../src/lib/ssh.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/ssh.js')>();
  return {
    ...actual,
    openSsh: vi.fn(async (_host: unknown, auth: { password?: string }) => {
      const password = auth.password ?? '';
      sshState.attempts.push(password);
      if (sshState.failingPasswords.has(password)) throw new Error('All configured authentication methods failed');
      return { client: { end: vi.fn() }, fingerprint: 'SHA256:fallback-test' };
    }),
    persistHostFingerprint: vi.fn(async () => undefined),
  };
});

let dir: string;
let config: AppConfig;
let db: Kysely<DatabaseSchema>;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsvault-fallback-'));
  config = loadConfig({
    dataDir: dir,
    db: { driver: 'sqlite', path: path.join(dir, 'fallback.db') },
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

describe('credential fallback', () => {
  it('tries primary first, then linked, and records每条的可用状态', async () => {
    const host = await createHost(
      db,
      { name: 'fallback-host', address: '203.0.113.20', port: 22, sshUser: 'root', env: 'dev' },
      systemActor('test'),
    );
    const broken = await createCredential(
      db,
      config,
      { name: 'broken-password', type: 'password', value: 'BrokenPass1!', hostIds: [host.id] },
      systemActor('test'),
    );
    const working = await createCredential(
      db,
      config,
      { name: 'working-password', type: 'password', value: 'WorkingPass1!', hostIds: [host.id] },
      systemActor('test'),
    );
    // broken 先创建，成为旧的第一条；把 working 设为主凭据后应优先尝试 working。
    await db
      .updateTable('host_credentials')
      .set({ role: 'linked' })
      .where('host_id', '=', host.id)
      .where('credential_id', '=', working.id)
      .execute();
    await db
      .updateTable('host_credentials')
      .set({ role: 'primary' })
      .where('host_id', '=', host.id)
      .where('credential_id', '=', broken.id)
      .execute();

    sshState.failingPasswords = new Set(['BrokenPass1!']);
    sshState.attempts = [];
    const hostRow = (await db.selectFrom('hosts').selectAll().where('id', '=', host.id).executeTakeFirstOrThrow());
    const candidates = await collectAuthCandidates(db, config, hostRow);
    expect(candidates.map((c) => c.label)).toEqual(['broken-password', 'working-password']);

    const opened = await openWithFallback(db, hostRow, candidates, null, async () => undefined);
    expect(sshState.attempts).toEqual(['BrokenPass1!', 'WorkingPass1!']);
    expect(opened.candidate.label).toBe('working-password');
    expect(opened.checks).toEqual([
      { ref: `credential:${broken.id}`, label: 'broken-password', role: 'primary', ok: false, error: expect.any(String) },
      { ref: `credential:${working.id}`, label: 'working-password', role: 'linked', ok: true },
    ]);

    const links = await db
      .selectFrom('host_credentials')
      .select(['credential_id', 'last_check_ok', 'last_check_error'])
      .where('host_id', '=', host.id)
      .execute();
    const brokenLink = links.find((l) => l.credential_id === broken.id)!;
    const workingLink = links.find((l) => l.credential_id === working.id)!;
    expect(brokenLink.last_check_ok).toBe(0);
    expect(brokenLink.last_check_error).toContain('authentication');
    expect(workingLink.last_check_ok).toBe(1);
    expect(workingLink.last_check_error).toBeNull();

    // 显式指定失效凭据时不应回退到其他凭据
    sshState.attempts = [];
    const explicit = await collectAuthCandidates(db, config, hostRow, broken.id);
    await expect(openWithFallback(db, hostRow, explicit, null, async () => undefined)).rejects.toThrow();
    expect(sshState.attempts).toEqual(['BrokenPass1!']);
  });

  it('editing a credential keeps its primary role on linked hosts', async () => {
    const host = await createHost(
      db,
      { name: 'edit-host', address: '203.0.113.21', port: 22, sshUser: 'root', env: 'dev' },
      systemActor('test'),
    );
    const cred = await createCredential(
      db,
      config,
      { name: 'edit-primary', type: 'password', value: 'EditPass1!', hostIds: [host.id] },
      systemActor('test'),
    );
    await db
      .updateTable('host_credentials')
      .set({ role: 'primary' })
      .where('host_id', '=', host.id)
      .where('credential_id', '=', cred.id)
      .execute();

    await updateCredential(db, config, cred.id, { name: 'edit-primary-renamed', hostIds: [host.id] }, systemActor('test'));

    const link = await db
      .selectFrom('host_credentials')
      .select(['role'])
      .where('host_id', '=', host.id)
      .where('credential_id', '=', cred.id)
      .executeTakeFirstOrThrow();
    expect(link.role).toBe('primary');
    const hostRow = await db.selectFrom('hosts').select(['credential_id']).where('id', '=', host.id).executeTakeFirstOrThrow();
    expect(hostRow.credential_id).toBe(cred.id);
  });
});
