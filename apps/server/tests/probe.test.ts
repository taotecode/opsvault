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
import { createCredential } from '../src/services/credentials.js';
import { probeHost } from '../src/services/probe.js';

const FIXTURE = `@@HOSTNAME@@
ali-hk-web-01
@@OS@@
PRETTY_NAME="Ubuntu 24.04 LTS"
@@UNAME@@
Linux 6.8.0-45-generic x86_64
@@CORES@@
4
@@CPU@@
Intel Xeon Platinum 8269CY @ 2.50GHz
@@MEM@@
MemTotal:       8123456 kB
@@DF@@
/dev/vda1 107374182400 50331648000 57042534400 47% /
tmpfs 4096000 0 4096000 0% /dev/shm
/dev/vdb1 214748364800 171798691840 42949672960 80% /data
@@IP@@
[{"ifname":"eth0","addr_info":[{"family":"inet","local":"47.242.101.18"},{"family":"inet6","local":"::1"}]}]
@@LOAD@@
0.82 0.76 0.71 2/192 12345
@@UPTIME@@
12268800.00 456789.00
@@VIRT@@
kvm
@@TZ@@
CST
@@DOCKER@@
3`;

const sshState = vi.hoisted(() => ({
  stdout: '',
  fail: null as Error | null,
}));

vi.mock('../src/lib/ssh.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/ssh.js')>();
  return {
    ...actual,
    resolveHostAuth: vi.fn(async () => ({ username: 'root', password: 'x', privateKey: undefined })),
    openSsh: vi.fn(async () => ({
      client: { end: vi.fn() },
      fingerprint: 'SHA256:probe-test',
    })),
    persistHostFingerprint: vi.fn(async () => undefined),
    execRemote: vi.fn(async () => {
      if (sshState.fail) throw sshState.fail;
      return { stdout: sshState.stdout };
    }),
  };
});

let dir: string;
let config: AppConfig;
let db: Kysely<DatabaseSchema>;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsvault-probe-'));
  config = loadConfig({
    dataDir: dir,
    db: { driver: 'sqlite', path: path.join(dir, 'probe.db') },
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

describe('probe engine', () => {
  it('persists a snapshot and never overwrites manual fields', async () => {
    sshState.stdout = FIXTURE;
    sshState.fail = null;
    const host = await createHost(
      db,
      {
        name: 'probe-host',
        address: '203.0.113.10',
        port: 22,
        sshUser: 'root',
        env: 'prod',
        notes: '手动备注',
        bandwidthMbps: 1000,
        trafficTb: 2,
        billingType: '包年包月',
        costMonth: 99,
      },
      systemActor('test'),
    );
    const credential = await createCredential(
      db,
      config,
      { name: 'probe-cred', type: 'password', value: 'ProbePass1!', hostIds: [host.id] },
      systemActor('test'),
    );
    await db
      .updateTable('hosts')
      .set({ credential_id: credential.id })
      .where('id', '=', host.id)
      .execute();

    const first = await probeHost(db, config, host.id, systemActor('test'));
    expect(first.partial).toEqual([]);
    expect(first.host.os).toBe('Ubuntu 24.04 LTS');
    expect(first.host.cpuCores).toBe(4);
    expect(first.host.status).toBe('warning');

    await db
      .updateTable('hosts')
      .set({ bandwidth_mbps: 2000 })
      .where('id', '=', host.id)
      .execute();
    const second = await probeHost(db, config, host.id, systemActor('test'));

    expect(second.host.bandwidthMbps).toBe(2000);
    expect(second.host.notes).toBe('手动备注');
    expect(second.host.costMonth).toBe(99);
    expect(second.host.os).toBe('Ubuntu 24.04 LTS');

    sshState.stdout = '@@HOSTNAME@@\nali-hk-web-01\n@@OS@@\nPRETTY_NAME="Debian 12"';
    const third = await probeHost(db, config, host.id, systemActor('test'));
    expect(third.partial.length).toBeGreaterThan(0);
    expect(third.partial).toContain('disk');
    expect(third.host.os).toBe('Debian 12');
    expect(third.host.kernel).toBe('6.8.0-45-generic');
    expect(third.host.disks.length).toBe(2);
    sshState.stdout = FIXTURE;

    const snapshots = await db
      .selectFrom('probe_snapshots')
      .select(['id', 'facts_json', 'raw_json'])
      .where('host_id', '=', host.id)
      .execute();
    expect(snapshots).toHaveLength(3);
    expect(snapshots.some((s) => s.facts_json.includes('ali-hk-web-01'))).toBe(true);
    expect(snapshots.every((s) => s.raw_json?.includes('@@HOSTNAME@@'))).toBe(true);

    const audits = await db
      .selectFrom('audit_logs')
      .select(['action', 'success'])
      .where('target_id', '=', host.id)
      .execute();
    expect(audits.filter((a) => a.action === '探测服务器')).toHaveLength(3);
    expect(audits.every((a) => a.success === 1)).toBe(true);
  });

  it('records an offline snapshot and audit when the SSH command fails', async () => {
    sshState.fail = new Error('connect timeout');
    const host = await createHost(
      db,
      { name: 'probe-fail', address: '203.0.113.11', port: 22, sshUser: 'root', env: 'dev' },
      systemActor('test'),
    );
    const failCredential = await createCredential(
      db,
      config,
      { name: 'probe-fail-cred', type: 'password', value: 'ProbePass2!', hostIds: [host.id] },
      systemActor('test'),
    );
    await db
      .updateTable('hosts')
      .set({ credential_id: failCredential.id })
      .where('id', '=', host.id)
      .execute();

    await expect(probeHost(db, config, host.id, systemActor('test'))).rejects.toThrow('connect timeout');

    const row = await db
      .selectFrom('hosts')
      .select(['status', 'probe_ok'])
      .where('id', '=', host.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('offline');
    expect(row.probe_ok).toBe(0);

    const snapshot = await db
      .selectFrom('probe_snapshots')
      .select(['status', 'error'])
      .where('host_id', '=', host.id)
      .executeTakeFirstOrThrow();
    expect(snapshot.status).toBe('offline');
    expect(snapshot.error).toContain('connect timeout');

    const audit = await db
      .selectFrom('audit_logs')
      .select(['success'])
      .where('target_id', '=', host.id)
      .where('action', '=', '探测服务器')
      .executeTakeFirstOrThrow();
    expect(audit.success).toBe(0);
    sshState.fail = null;
  });
});
