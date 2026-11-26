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

  it('explicit selection skips the host keypair too', async () => {
    const host = await createHost(
      db,
      { name: 'explicit-host', address: '203.0.113.22', port: 22, sshUser: 'root', env: 'dev' },
      systemActor('test'),
    );
    const cred = await createCredential(
      db,
      config,
      { name: 'explicit-cred', type: 'password', value: 'ExplicitPass1!', hostIds: [host.id] },
      systemActor('test'),
    );
    // 装一条“密钥对”绑定，验证手动选择时不会被它抢先
    await db
      .updateTable('hosts')
      .set({ keypair_id: 'kp-should-not-be-used' })
      .where('id', '=', host.id)
      .execute();
    const hostRow = await db.selectFrom('hosts').selectAll().where('id', '=', host.id).executeTakeFirstOrThrow();
    const candidates = await collectAuthCandidates(db, config, hostRow, cred.id);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ ref: `credential:${cred.id}`, role: 'explicit' });

    sshState.failingPasswords = new Set();
    sshState.attempts = [];
    await openWithFallback(db, hostRow, candidates, null, async () => undefined);
    expect(sshState.attempts).toEqual(['ExplicitPass1!']);
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

  it('rename preserves check status and link order; removing a host clears hosts.credential_id', async () => {
    const host = await createHost(
      db,
      { name: 'rename-host', address: '203.0.113.23', port: 22, sshUser: 'root', env: 'dev' },
      systemActor('test'),
    );
    const cred = await createCredential(
      db,
      config,
      { name: 'rename-cred', type: 'password', value: 'RenamePass1!', hostIds: [host.id] },
      systemActor('test'),
    );
    const createdAt = '2026-01-01T00:00:00.000Z';
    await db
      .updateTable('host_credentials')
      .set({ role: 'primary', created_at: createdAt, last_check_ok: 0, last_check_error: '之前失败', last_checked_at: '2026-02-01T00:00:00.000Z' })
      .where('host_id', '=', host.id)
      .where('credential_id', '=', cred.id)
      .execute();

    await updateCredential(db, config, cred.id, { name: 'rename-cred-2', hostIds: [host.id] }, systemActor('test'));
    const link = await db
      .selectFrom('host_credentials')
      .selectAll()
      .where('host_id', '=', host.id)
      .where('credential_id', '=', cred.id)
      .executeTakeFirstOrThrow();
    expect(link.role).toBe('primary');
    expect(link.last_check_ok).toBe(0);
    expect(link.last_check_error).toBe('之前失败');
    expect(link.created_at).toBe(createdAt);

    await updateCredential(db, config, cred.id, { hostIds: [] }, systemActor('test'));
    expect(
      (await db.selectFrom('host_credentials').select('host_id').where('credential_id', '=', cred.id).execute()).length,
    ).toBe(0);
    const after = await db.selectFrom('hosts').select('credential_id').where('id', '=', host.id).executeTakeFirstOrThrow();
    expect(after.credential_id).toBeNull();
  });

  it('an unbuildable candidate does not break the fallback chain', async () => {
    const host = await createHost(
      db,
      { name: 'unbuildable-host', address: '203.0.113.24', port: 22, sshUser: 'root', env: 'dev' },
      systemActor('test'),
    );
    await createCredential(
      db,
      config,
      { name: 'chain-good', type: 'password', value: 'ChainGood1!', hostIds: [host.id] },
      systemActor('test'),
    );
    // 无效私钥内容：解析阶段就失败，不应阻断后续凭据
    await createCredential(
      db,
      config,
      { name: 'chain-broken-key', type: 'ssh_key', value: 'not-a-private-key', hostIds: [host.id] },
      systemActor('test'),
    );

    const hostRow = await db.selectFrom('hosts').selectAll().where('id', '=', host.id).executeTakeFirstOrThrow();
    sshState.failingPasswords = new Set();
    sshState.attempts = [];
    const candidates = await collectAuthCandidates(db, config, hostRow);
    expect(candidates.map((c) => c.label)).toEqual(['chain-good']);
    const opened = await openWithFallback(db, hostRow, candidates, null, async () => undefined);
    expect(opened.candidate.label).toBe('chain-good');
    expect(sshState.attempts).toEqual(['ChainGood1!']);
  });

  it('rejects an explicit credential that is not linked to the host', async () => {
    const host = await createHost(
      db,
      { name: 'unlinked-host', address: '203.0.113.25', port: 22, sshUser: 'root', env: 'dev' },
      systemActor('test'),
    );
    const otherHost = await createHost(
      db,
      { name: 'unlinked-other', address: '203.0.113.26', port: 22, sshUser: 'root', env: 'dev' },
      systemActor('test'),
    );
    const cred = await createCredential(
      db,
      config,
      { name: 'unlinked-cred', type: 'password', value: 'UnlinkedPass1!', hostIds: [otherHost.id] },
      systemActor('test'),
    );
    const hostRow = await db.selectFrom('hosts').selectAll().where('id', '=', host.id).executeTakeFirstOrThrow();
    await expect(collectAuthCandidates(db, config, hostRow, cred.id)).rejects.toMatchObject({
      statusCode: 403,
      hint: '该凭据未关联此主机',
    });
  });
});
