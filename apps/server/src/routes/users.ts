import type { FastifyInstance } from 'fastify';
import { userInviteSchema, userPatchSchema } from '@boerfen/shared';
import { inviteUser, listUsers, patchUser } from '../services/users.js';
import { actorFromRequest } from '../lib/actor.js';
import { requireAdmin } from '../lib/permissions.js';
import { parseBody } from '../lib/validate.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/users', async (req) => {
    requireAdmin(req);
    return { data: await listUsers(app.db) };
  });

  app.post('/api/v1/users/invite', async (req) => {
    requireAdmin(req);
    const body = parseBody(userInviteSchema, req.body);
    return { data: await inviteUser(app.db, body, actorFromRequest(req)) };
  });

  app.patch('/api/v1/users/:id', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const body = parseBody(userPatchSchema, req.body);
    if (body.role === undefined && body.status === undefined) {
      throw new (await import('../lib/errors.js')).AppError(400, 'VALIDATION_FAILED', '没有可更新字段');
    }
    return { data: await patchUser(app.db, id, body, actorFromRequest(req)) };
  });
}
