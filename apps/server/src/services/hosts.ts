import type { Kysely } from 'kysely';
import type { DatabaseSchema, HostsTable } from '../db/types.js';
import type { HostCreateInput, HostPatchInput } from '@boerfen/shared';
import { ulid } from 'ulid';
import { errors } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import type { Actor } from '../lib/actor.js';

export interface HostDto {
  id: string;
  name: string;
  address: string;
  port: number;
  sshUser: string;
  env: string;
  group: string | null;
  provider: string | null;
  tags: string[];
  notes: string | null;
  status: string;
  os: string | null;
  kernel: string | null;
  arch: string | null;
  cpuModel: string | null;
  cpuCores: number | null;
  memTotalMb: number | null;
  disks: unknown[];
  ips: unknown[];
  loadAvg: string | null;
  uptimeSec: number | null;
  virtualization: string | null;
  containers: number | null;
  timezone: string | null;
  hostKeyFp: string | null;
  lastProbeAt: string | null;
  probeOk: boolean | null;
  bandwidthMbps: number | null;
  trafficTb: number | null;
  billingType: string | null;
  costMonth: number | null;
  expiresAt: string | null;
  credentialId: string | null;
  keypairId: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseJsonArray(text: string | null): unknown[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function hostDto(h: HostsTable): HostDto {
  return {
    id: h.id,
    name: h.name,
    address: h.address,
    port: h.port,
    sshUser: h.ssh_user,
    env: h.env,
    group: h.group_name,
    provider: h.provider,
    tags: parseJsonArray(h.tags_json) as string[],
    notes: h.notes,
    status: h.status,
    os: h.os,
    kernel: h.kernel,
    arch: h.arch,
    cpuModel: h.cpu_model,
    cpuCores: h.cpu_cores,
    memTotalMb: h.mem_total_mb,
    disks: parseJsonArray(h.disk_json),
    ips: parseJsonArray(h.ips_json),
    loadAvg: h.load_avg,
    uptimeSec: h.uptime_sec,
    virtualization: h.virtualization,
    containers: h.containers,
    timezone: h.timezone,
    hostKeyFp: h.host_key_fp,
    lastProbeAt: h.last_probe_at,
    probeOk: h.probe_ok === null ? null : !!h.probe_ok,
    bandwidthMbps: h.bandwidth_mbps,
    trafficTb: h.traffic_tb,
    billingType: h.billing_type,
    costMonth: h.cost_month,
    expiresAt: h.expires_at,
    credentialId: h.credential_id,
    keypairId: h.keypair_id,
    createdAt: h.created_at,
    updatedAt: h.updated_at,
  };
}

export function projectHosts<T extends { id: string }>(
  items: T[],
  fields?: string,
): Array<Partial<T> & { id: string }> {
  if (!fields) return items;
  const keys = fields.split(',').map((f) => f.trim()).filter(Boolean);
  return items.map((item) => {
    const out = { id: item.id } as Partial<T> & { id: string };
    const source = item as Record<string, unknown>;
    for (const key of keys) {
      if (key in source) (out as Record<string, unknown>)[key] = source[key];
    }
    return out;
  });
}

export async function listHosts(
  db: Kysely<DatabaseSchema>,
  query: { limit: number; cursor?: string; q?: string; env?: string; status?: string },
): Promise<{ items: HostDto[]; nextCursor: string | null; hasMore: boolean }> {
  let qb = db.selectFrom('hosts').selectAll();
  if (query.env) qb = qb.where('env', '=', query.env);
  if (query.status) qb = qb.where('status', '=', query.status);
  if (query.q) {
    const like = `%${query.q.replace(/%/g, '')}%`;
    qb = qb.where((eb) =>
      eb.or([
        eb('name', 'like', like),
        eb('address', 'like', like),
        eb('provider', 'like', like),
        eb('group_name', 'like', like),
      ]),
    );
  }
  const offset = query.cursor ? Math.max(0, Number(query.cursor) || 0) : 0;
  qb = qb.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(query.limit + 1).offset(offset);
  const rows = await qb.execute();
  const hasMore = rows.length > query.limit;
  const items = rows.slice(0, query.limit).map(hostDto);
  return { items, hasMore, nextCursor: hasMore ? String(offset + query.limit) : null };
}

export async function getHostRow(
  db: Kysely<DatabaseSchema>,
  id: string,
): Promise<HostsTable> {
  const row = await db.selectFrom('hosts').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw errors.notFound('服务器');
  return row;
}

export async function createHost(
  db: Kysely<DatabaseSchema>,
  input: HostCreateInput,
  actor: Actor,
): Promise<HostDto> {
  if (actor.kind === 'agent' && (input.credentialId || input.keypairId)) {
    throw errors.forbidden('Agent 令牌创建主机时不可绑定凭据或密钥对');
  }
  if (input.credentialId) {
    const cred = await db.selectFrom('credentials').select('id').where('id', '=', input.credentialId).executeTakeFirst();
    if (!cred) throw errors.notFound('凭据');
  }
  if (input.keypairId) {
    const kp = await db.selectFrom('keypairs').select('id').where('id', '=', input.keypairId).executeTakeFirst();
    if (!kp) throw errors.notFound('密钥对');
  }
  const now = new Date().toISOString();
  const id = ulid();
  await db
    .insertInto('hosts')
    .values({
      id,
      name: input.name,
      address: input.address,
      port: input.port,
      ssh_user: input.sshUser,
      env: input.env,
      group_name: input.group ?? null,
      provider: input.provider ?? null,
      tags_json: input.tags ? JSON.stringify(input.tags) : null,
      notes: input.notes ?? null,
      status: 'pending',
      os: null,
      kernel: null,
      arch: null,
      cpu_model: null,
      cpu_cores: null,
      mem_total_mb: null,
      disk_json: null,
      ips_json: null,
      load_avg: null,
      uptime_sec: null,
      virtualization: null,
      containers: null,
      timezone: null,
      host_key_fp: null,
      last_probe_at: null,
      probe_ok: null,
      bandwidth_mbps: input.bandwidthMbps ?? null,
      traffic_tb: input.trafficTb ?? null,
      billing_type: input.billingType ?? '包年包月',
      cost_month: input.costMonth ?? null,
      expires_at: input.expiresAt ?? null,
      credential_id: input.credentialId ?? null,
      keypair_id: input.keypairId ?? null,
      created_at: now,
      updated_at: now,
    })
    .execute();
  if (input.credentialId) {
    await db
      .insertInto('host_credentials')
      .values({ host_id: id, credential_id: input.credentialId, role: 'primary' })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '添加服务器',
    category: 'asset',
    targetId: id,
    detail: { name: input.name, address: input.address },
    ip: actor.ip,
    ua: actor.ua,
  });
  return hostDto(await getHostRow(db, id));
}

export async function patchHost(
  db: Kysely<DatabaseSchema>,
  id: string,
  patch: HostPatchInput,
  actor: Actor,
): Promise<HostDto> {
  if (actor.kind === 'agent') {
    const blocked = (['address', 'port', 'sshUser', 'credentialId', 'keypairId'] as const).filter(
      (k) => patch[k] !== undefined,
    );
    if (blocked.length) {
      throw errors.forbidden(`Agent 令牌不可修改连接字段：${blocked.join(', ')}`);
    }
  }
  const current = await getHostRow(db, id);
  if (patch.credentialId) {
    const cred = await db.selectFrom('credentials').select('id').where('id', '=', patch.credentialId).executeTakeFirst();
    if (!cred) throw errors.notFound('凭据');
  }
  if (patch.keypairId) {
    const kp = await db.selectFrom('keypairs').select('id').where('id', '=', patch.keypairId).executeTakeFirst();
    if (!kp) throw errors.notFound('密钥对');
  }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const map: Array<[keyof HostPatchInput, keyof HostsTable, (v: unknown) => unknown]> = [
    ['name', 'name', (v) => v],
    ['address', 'address', (v) => v],
    ['port', 'port', (v) => v],
    ['sshUser', 'ssh_user', (v) => v],
    ['env', 'env', (v) => v],
    ['group', 'group_name', (v) => v],
    ['provider', 'provider', (v) => v],
    ['tags', 'tags_json', (v) => (v === undefined ? v : JSON.stringify(v))],
    ['notes', 'notes', (v) => v],
    ['bandwidthMbps', 'bandwidth_mbps', (v) => v],
    ['trafficTb', 'traffic_tb', (v) => (v === null ? null : Number(v))],
    ['billingType', 'billing_type', (v) => v],
    ['costMonth', 'cost_month', (v) => v],
    ['expiresAt', 'expires_at', (v) => v],
    ['credentialId', 'credential_id', (v) => v],
    ['keypairId', 'keypair_id', (v) => v],
  ];
  for (const [from, to, transform] of map) {
    if (patch[from] !== undefined) updates[to] = transform(patch[from]);
  }
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('hosts').set(updates as never).where('id', '=', id).execute();
    if (patch.credentialId === null) {
      await trx.deleteFrom('host_credentials').where('host_id', '=', id).execute();
    } else if (patch.credentialId) {
      await trx
        .insertInto('host_credentials')
        .values({ host_id: id, credential_id: patch.credentialId, role: 'primary' })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
  });
  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '更新服务器',
    category: 'asset',
    targetId: id,
    detail: { fields: Object.keys(updates).filter((k) => k !== 'updated_at'), name: current.name },
    ip: actor.ip,
    ua: actor.ua,
  });
  return hostDto(await getHostRow(db, id));
}

export async function deleteHost(
  db: Kysely<DatabaseSchema>,
  id: string,
  actor: Actor,
): Promise<void> {
  const host = await getHostRow(db, id);
  await db.deleteFrom('hosts').where('id', '=', id).execute();
  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '删除服务器',
    category: 'asset',
    targetId: id,
    detail: { name: host.name },
    ip: actor.ip,
    ua: actor.ua,
  });
}

export async function listSnapshots(
  db: Kysely<DatabaseSchema>,
  hostId: string,
  limit = 20,
): Promise<
  Array<{ id: string; status: string; facts: unknown; error: string | null; createdAt: string }>
> {
  const rows = await db
    .selectFrom('probe_snapshots')
    .selectAll()
    .where('host_id', '=', hostId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    facts: r.facts_json ? (JSON.parse(r.facts_json) as unknown) : null,
    error: r.error,
    createdAt: r.created_at,
  }));
}
