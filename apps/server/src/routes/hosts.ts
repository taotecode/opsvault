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
import { actorFromRequest } from '../lib/actor.js';
import { getAuth, scopeCheck } from '../lib/permissions.js';
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
    const result = await probeHost(app.db, app.config, id, actorFromRequest(req));
    return { data: { host: result.host, partial: result.partial } };
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
