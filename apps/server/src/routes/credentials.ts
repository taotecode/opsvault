import type { FastifyInstance } from 'fastify';
import {
  credentialCreateSchema,
  credentialPatchSchema,
  generatePasswordSchema,
} from '@boerfen/shared';
import {
  createCredential,
  deleteCredential,
  isRevealWindowActive,
  listCredentials,
  revealCredential,
  updateCredential,
} from '../services/credentials.js';
import { generatePassword, passwordStrength } from '../lib/crypto.js';
import { actorFromRequest } from '../lib/actor.js';
import { denyAgent, getAuth, requireRole, scopeCheck } from '../lib/permissions.js';
import { parseBody } from '../lib/validate.js';
import { errors } from '../lib/errors.js';

export async function credentialRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/credentials', async (req) => {
    scopeCheck('credentials:read')(req);
    return { data: await listCredentials(app.db) };
  });

  app.post('/api/v1/credentials', async (req) => {
    scopeCheck('credentials:write')(req);
    denyAgent(req);
    const body = parseBody(credentialCreateSchema, req.body);
    return { data: await createCredential(app.db, app.config, body, actorFromRequest(req)) };
  });

  app.patch('/api/v1/credentials/:id', async (req) => {
    scopeCheck('credentials:write')(req);
    denyAgent(req);
    const { id } = req.params as { id: string };
    const body = parseBody(credentialPatchSchema, req.body);
    return { data: await updateCredential(app.db, app.config, id, body, actorFromRequest(req)) };
  });

  app.delete('/api/v1/credentials/:id', async (req) => {
    scopeCheck('credentials:write')(req);
    denyAgent(req);
    const { id } = req.params as { id: string };
    await deleteCredential(app.db, id, actorFromRequest(req));
    return { data: { ok: true } };
  });

  app.post('/api/v1/credentials/:id/reveal', async (req) => {
    scopeCheck('credentials:read')(req);
    denyAgent(req);
    requireRole(req, ['admin', 'operator']);
    const auth = getAuth(req);
    if (auth.via !== 'session') throw errors.forbidden('敏感操作仅支持登录会话');
    if (!isRevealWindowActive(auth.revealUntil)) {
      throw errors.forbidden('需要先完成二次验证', '请在 5 分钟内通过 /api/v1/auth/reveal 验证密码');
    }
    const { id } = req.params as { id: string };
    return { data: await revealCredential(app.db, app.config, id, actorFromRequest(req)) };
  });

  app.post('/api/v1/credentials/generate-password', async (req) => {
    scopeCheck('credentials:write')(req);
    const body = parseBody(generatePasswordSchema, req.body ?? {});
    const password = generatePassword(body);
    return { data: { password, strength: passwordStrength(password) } };
  });
}
