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

export interface ProbeResult {
  host: HostDto;
  partial: string[];
}

function statusFor(partial: number, disks: Array<{ usePct: number }>): 'online' | 'warning' {
  const highDisk = disks.some((d) => d.usePct >= 80);
  return partial > 0 || highDisk ? 'warning' : 'online';
}

export async function probeHost(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  hostId: string,
  actor: Actor,
): Promise<ProbeResult> {
  const host = await getHostRow(db, hostId);
  const now = new Date().toISOString();
  let client: Awaited<ReturnType<typeof openSsh>>['client'] | null = null;
  try {
    const auth = await resolveHostAuth(db, config, host);
    const opened = await openSsh(host, auth, host.host_key_fp);
    client = opened.client;
    await persistHostFingerprint(db, host.id, host.host_key_fp, opened.fingerprint);
    const { stdout } = await execRemote(client, PROBE_SCRIPT, 25_000);
    client.end();
    client = null;
    const { facts, partial } = parseProbe(stdout);
    const disks = (facts.disks ?? []) as Array<{ usePct: number }>;
    const status = statusFor(partial.length, disks);
    await db
      .updateTable('hosts')
      .set({
        status,
        os: facts.os ?? null,
        kernel: facts.kernel ?? null,
        arch: facts.arch ?? null,
        cpu_model: facts.cpuModel ?? null,
        cpu_cores: facts.cpuCores ?? null,
        mem_total_mb: facts.memTotalMb ?? null,
        disk_json: facts.disks ? JSON.stringify(facts.disks) : null,
        ips_json: facts.ips ? JSON.stringify(facts.ips) : null,
        load_avg: facts.loadAvg ?? null,
        uptime_sec: facts.uptimeSec ?? null,
        virtualization: facts.virtualization ?? null,
        containers: facts.containers ?? null,
        timezone: facts.timezone ?? null,
        last_probe_at: now,
        probe_ok: 1,
        host_key_fp: (await getHostRow(db, hostId)).host_key_fp,
        updated_at: now,
      })
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
  const concurrency = 3;
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
