import type { Kysely } from 'kysely';
import { ulid } from 'ulid';
import type { AppConfig } from '../config.js';
import type { DatabaseSchema, HostsTable } from '../db/types.js';
import { execRemote, openSsh, persistHostFingerprint, resolveHostAuth } from '../lib/ssh.js';
import { PROBE_SCRIPT, parseProbe } from '../lib/probeParser.js';
import { errors } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import type { Actor } from '../lib/actor.js';
import { getHostRow, hostDto, type HostDto } from './hosts.js';
import { probeSettings } from './settings.js';
import { sendWebhook } from './webhook.js';

export interface ProbeResult {
  host: HostDto;
  partial: string[];
}

function statusFor(partial: number, disks: Array<{ usePct: number }>): 'online' | 'warning' {
  const highDisk = disks.some((d) => d.usePct >= 80);
  return partial > 0 || highDisk ? 'warning' : 'online';
}

async function pruneSnapshots(
  db: Kysely<DatabaseSchema>,
  hostId: string,
  keep: number,
): Promise<void> {
  const stale = await db
    .selectFrom('probe_snapshots')
    .select('id')
    .where('host_id', '=', hostId)
    .orderBy('created_at', 'desc')
    .offset(keep)
    .limit(200)
    .execute();
  if (stale.length) {
    await db
      .deleteFrom('probe_snapshots')
      .where('id', 'in', stale.map((s) => s.id))
      .execute();
  }
}

export async function probeHost(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  hostId: string,
  actor: Actor,
): Promise<ProbeResult> {
  const host = await getHostRow(db, hostId);
  const now = new Date().toISOString();
  const probeCfg = await probeSettings(db);
  let client: Awaited<ReturnType<typeof openSsh>>['client'] | null = null;
  try {
    const auth = await resolveHostAuth(db, config, host);
    const opened = await openSsh(host, auth, host.host_key_fp);
    client = opened.client;
    await persistHostFingerprint(db, host.id, host.host_key_fp, opened.fingerprint);
    const { stdout } = await execRemote(client, PROBE_SCRIPT, probeCfg.timeoutSec * 1000);
    client.end();
    client = null;
    const { facts, partial } = parseProbe(stdout);
    const disks = (facts.disks ?? []) as Array<{ usePct: number }>;
    const status = statusFor(partial.length, disks);
    const updates: Record<string, unknown> = {
      status,
      last_probe_at: now,
      probe_ok: 1,
      host_key_fp: (await getHostRow(db, hostId)).host_key_fp,
      updated_at: now,
    };
    if (facts.os !== undefined) updates.os = facts.os ?? null;
    if (facts.kernel !== undefined) updates.kernel = facts.kernel ?? null;
    if (facts.arch !== undefined) updates.arch = facts.arch ?? null;
    if (facts.cpuModel !== undefined) updates.cpu_model = facts.cpuModel ?? null;
    if (facts.cpuCores !== undefined) updates.cpu_cores = facts.cpuCores ?? null;
    if (facts.memTotalMb !== undefined) updates.mem_total_mb = facts.memTotalMb ?? null;
    if (facts.disks !== undefined) updates.disk_json = facts.disks ? JSON.stringify(facts.disks) : null;
    if (facts.ips !== undefined) updates.ips_json = facts.ips ? JSON.stringify(facts.ips) : null;
    if (facts.loadAvg !== undefined) updates.load_avg = facts.loadAvg ?? null;
    if (facts.uptimeSec !== undefined) updates.uptime_sec = facts.uptimeSec ?? null;
    if (facts.virtualization !== undefined) updates.virtualization = facts.virtualization ?? null;
    if (facts.containers !== undefined) updates.containers = facts.containers ?? null;
    if (facts.timezone !== undefined) updates.timezone = facts.timezone ?? null;
    await db
      .updateTable('hosts')
      .set(updates as never)
      .where('id', '=', hostId)
      .execute();
    await db
      .insertInto('probe_snapshots')
      .values({
        id: ulid(),
        host_id: hostId,
        status,
        facts_json: JSON.stringify(facts),
        raw_json: stdout.slice(0, 200_000),
        error: partial.length ? `partial: ${partial.join(',')}` : null,
        created_at: now,
      })
      .execute();
    await pruneSnapshots(db, hostId, probeCfg.snapshotKeep);
    await writeAudit(db, {
      actorId: actor.id,
      actorLabel: actor.label,
      actorKind: actor.kind,
      action: '探测服务器',
      category: 'asset',
      targetId: hostId,
      detail: { status, partial },
      ip: actor.ip,
      ua: actor.ua,
      success: true,
    });
    return { host: hostDto(await getHostRow(db, hostId)), partial };
  } catch (err) {
    if (client) client.end();
    const message = err instanceof Error ? err.message : 'probe failed';
    await db
      .updateTable('hosts')
      .set({ status: 'offline', probe_ok: 0, last_probe_at: now, updated_at: now })
      .where('id', '=', hostId)
      .execute();
    await db
      .insertInto('probe_snapshots')
      .values({
        id: ulid(),
        host_id: hostId,
        status: 'offline',
        facts_json: '{}',
        raw_json: null,
        error: message,
        created_at: now,
      })
      .execute();
    await pruneSnapshots(db, hostId, probeCfg.snapshotKeep);
    void sendWebhook(db, 'probe.failed', { hostId, host: host.name, error: message }).catch(() => undefined);
    await writeAudit(db, {
      actorId: actor.id,
      actorLabel: actor.label,
      actorKind: actor.kind,
      action: '探测服务器',
      category: 'asset',
      targetId: hostId,
      detail: { error: message },
      ip: actor.ip,
      ua: actor.ua,
      success: false,
    });
    throw err;
  }
}

export async function probeMany(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  hostIds: string[],
  actor: Actor,
): Promise<Array<{ hostId: string; name?: string; ok: boolean; error?: string }>> {
  const results: Array<{ hostId: string; name?: string; ok: boolean; error?: string }> = [];
  const { concurrency } = await probeSettings(db);
  const queue = [...hostIds];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        const r = await probeHost(db, config, id, actor);
        results.push({ hostId: id, name: r.host.name, ok: true });
      } catch (e) {
        const row = await db
          .selectFrom('hosts')
          .select(['name'])
          .where('id', '=', id)
          .executeTakeFirst();
        results.push({ hostId: id, name: row?.name, ok: false, error: (e as Error).message });
      }
    }
  });
  await Promise.all(workers);
  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '批量探测',
    category: 'asset',
    detail: {
      total: hostIds.length,
      success: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    },
    ip: actor.ip,
    ua: actor.ua,
    success: results.every((r) => r.ok),
  });
  return results;
}

export function hostFacts(dto: HostDto): Record<string, unknown> {
  return {
    hostname: dto.name,
    os: dto.os,
    kernel: dto.kernel,
    arch: dto.arch,
    cpu: dto.cpuModel,
    cores: dto.cpuCores,
    memTotalMb: dto.memTotalMb,
    disks: dto.disks,
    ips: dto.ips,
    loadAvg: dto.loadAvg,
    uptimeSec: dto.uptimeSec,
    virtualization: dto.virtualization,
    containers: dto.containers,
    timezone: dto.timezone,
  };
}

export function requireHostAuthConfigured(host: HostsTable): void {
  if (!host.credential_id && !host.keypair_id) {
    throw errors.forbidden('未配置 SSH 凭据或密钥对');
  }
}
