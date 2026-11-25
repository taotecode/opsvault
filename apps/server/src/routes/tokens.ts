import type { FastifyInstance } from 'fastify';
import { tokenCreateSchema } from '@boerfen/shared';
import { createToken, deleteToken, listTokens } from '../services/tokens.js';
import { actorFromRequest } from '../lib/actor.js';
import { requireAdmin } from '../lib/permissions.js';
import { parseBody } from '../lib/validate.js';

export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/tokens', async (req) => {
    requireAdmin(req);
    return { data: await listTokens(app.db) };
  });

  app.post('/api/v1/tokens', async (req) => {
    requireAdmin(req);
    const body = parseBody(tokenCreateSchema, req.body);
    const result = await createToken(app.db, actorFromRequest(req), {
      name: body.name,
      kind: body.kind,
      scopes: body.scopes,
      expiresDays: body.expiresDays,
    });
    return { data: { ...result.dto, token: result.token } };
  });

  app.delete('/api/v1/tokens/:id', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    await deleteToken(app.db, id, actorFromRequest(req));
    return { data: { ok: true } };
  });
}
