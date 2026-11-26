import type { FastifyInstance } from 'fastify';
import {
  batchProbeSchema,
  hostCreateSchema,
  hostListQuerySchema,
  hostPatchSchema,
} from '@opsvault/shared';
import {
  createHost,
  deleteHost,
  getHostRow,
  hostDto,
  listHosts,
  listSnapshots,
  patchHost,
  projectHosts,
} from '../services/hosts.js';
import { probeHost, probeMany } from '../services/probe.js';
import { hostCredentials, setPrimaryCredential } from '../services/credentialChecks.js';
import { actorFromRequest } from '../lib/actor.js';
import { getAuth, scopeCheck, denyAgent } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';
import { parseBody, parseQuery } from '../lib/validate.js';

export async function hostRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/hosts', async (req) => {
    scopeCheck('hosts:read')(req);
    const query = parseQuery(hostListQuerySchema, req.query);
    const result = await listHosts(app.db, {
      limit: query.limit,
      cursor: query.cursor,
      q: query.q,
      env: query.env,
      status: query.status,
    });
    return { data: projectHosts(result.items, query.fields), page: { cursor: result.nextCursor, hasMore: result.hasMore } };
  });

  app.get('/api/v1/hosts/:id', async (req) => {
    scopeCheck('hosts:read')(req);
    const { id } = req.params as { id: string };
    return { data: hostDto(await getHostRow(app.db, id)) };
  });

  app.post('/api/v1/hosts', async (req) => {
    scopeCheck('hosts:write')(req);
    const body = parseBody(hostCreateSchema, req.body);
    const host = await createHost(app.db, body, actorFromRequest(req));
    return { data: host };
  });

  app.patch('/api/v1/hosts/:id', async (req) => {
    scopeCheck('hosts:write')(req);
    const { id } = req.params as { id: string };
    const patch = parseBody(hostPatchSchema, req.body);
    return { data: await patchHost(app.db, id, patch, actorFromRequest(req)) };
  });

  app.delete('/api/v1/hosts/:id', async (req) => {
    scopeCheck('hosts:write')(req);
    const { id } = req.params as { id: string };
    await deleteHost(app.db, id, actorFromRequest(req));
    return { data: { ok: true } };
  });

  app.post('/api/v1/hosts/:id/probe', async (req) => {
    scopeCheck('hosts:write')(req);
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { credentialId?: string };
    // 手动指定凭据只对登录用户开放；Agent 若可指定凭据，即可把保险库里的密码发往任意地址
    if (typeof body.credentialId === 'string') denyAgent(req);
    const result = await probeHost(app.db, app.config, id, actorFromRequest(req), {
      credentialId: typeof body.credentialId === 'string' ? body.credentialId : undefined,
    });
    return { data: { host: result.host, partial: result.partial } };
  });

  app.get('/api/v1/hosts/:id/credentials', async (req) => {
    scopeCheck('hosts:read')(req);
    const { id } = req.params as { id: string };
    const links = (await hostCredentials(app.db)).get(id) ?? [];
    const credentials = links.length
      ? await app.db
          .selectFrom('credentials')
          .select(['id', 'name', 'type', 'strength'])
          .where('id', 'in', links.map((l) => l.id))
          .execute()
      : [];
    const byId = new Map(credentials.map((c) => [c.id, c]));
    return {
      data: links
        .filter((l) => byId.has(l.id))
        .map((l) => ({
          id: l.id,
          name: byId.get(l.id)!.name,
          type: byId.get(l.id)!.type,
          strength: byId.get(l.id)!.strength,
          role: l.role,
          lastCheckOk: l.ok,
          lastCheckError: l.error,
          lastCheckedAt: l.at,
        })),
    };
  });

  app.post('/api/v1/hosts/:id/credentials/:credentialId/primary', async (req) => {
    scopeCheck('hosts:write')(req);
    denyAgent(req);
    const { id, credentialId } = req.params as { id: string; credentialId: string };
    await setPrimaryCredential(app.db, id, credentialId);
    await writeAudit(app.db, {
      ...actorFromRequest(req),
      actorId: req.auth?.user.id ?? null,
      actorLabel: req.auth?.actorLabel ?? 'system',
      actorKind: req.auth?.actorKind ?? 'system',
      action: '设置主凭据',
      category: 'cred',
      targetId: id,
      detail: { credentialId },
    });
    return { data: { ok: true } };
  });

  app.post('/api/v1/hosts/batch-probe', async (req) => {
    scopeCheck('hosts:write')(req);
    const body = parseBody(batchProbeSchema, req.body);
    const results = await probeMany(app.db, app.config, body.hostIds, actorFromRequest(req));
    return { data: results };
  });

  app.get('/api/v1/hosts/:id/snapshots', async (req) => {
    scopeCheck('hosts:read')(req);
    const { id } = req.params as { id: string };
    return { data: await listSnapshots(app.db, id) };
  });

  app.get('/api/v1/auth/ping', async (req) => ({ data: { auth: !!getAuth(req) } }));
}
