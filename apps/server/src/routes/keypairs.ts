import type { FastifyInstance } from 'fastify';
import {
  connectCommandQuerySchema,
  keypairDeploySchema,
  keypairGenerateSchema,
  keypairImportSchema,
  keypairVerifySchema,
} from '@boerfen/shared';
import {
  connectCommand,
  decryptPrivateForDownload,
  deleteKeypair,
  deployKeypair,
  generateKeypair,
  getKeypairDto,
  getKeypairRow,
  importKeypair,
  listKeypairs,
  verifyKeypair,
} from '../services/keypairs.js';
import { actorFromRequest } from '../lib/actor.js';
import { denyAgent, getAuth, scopeCheck } from '../lib/permissions.js';
import { parseBody, parseQuery } from '../lib/validate.js';
import { errors } from '../lib/errors.js';
import { isRevealWindowActive } from '../services/credentials.js';
import { writeAudit } from '../lib/audit.js';

export async function keypairRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/keypairs', async (req) => {
    scopeCheck('keypairs:read')(req);
    return { data: await listKeypairs(app.db) };
  });

  app.get('/api/v1/keypairs/:id', async (req) => {
    scopeCheck('keypairs:read')(req);
    const { id } = req.params as { id: string };
    return { data: await getKeypairDto(app.db, id) };
  });

  app.post('/api/v1/keypairs/generate', async (req) => {
    scopeCheck('keypairs:write')(req);
    const body = parseBody(keypairGenerateSchema, req.body);
    return {
      data: await generateKeypair(app.db, app.config, body, actorFromRequest(req)),
    };
  });

  app.post('/api/v1/keypairs/import', async (req) => {
    scopeCheck('keypairs:write')(req);
    const body = parseBody(keypairImportSchema, req.body);
    try {
      return {
        data: await importKeypair(app.db, app.config, body, actorFromRequest(req)),
      };
    } catch (e) {
      if (e instanceof Error && /key|parse|private|unsupported/i.test(e.message)) {
        throw errors.keyParse(e.message);
      }
      throw e;
    }
  });

  app.delete('/api/v1/keypairs/:id', async (req) => {
    scopeCheck('keypairs:write')(req);
    const { id } = req.params as { id: string };
    await deleteKeypair(app.db, id, actorFromRequest(req));
    return { data: { ok: true } };
  });

  app.post('/api/v1/keypairs/:id/deploy', async (req) => {
    scopeCheck('keypairs:write')(req);
    const { id } = req.params as { id: string };
    const body = parseBody(keypairDeploySchema, req.body);
    return {
      data: await deployKeypair(app.db, app.config, id, body.hostIds, actorFromRequest(req)),
    };
  });

  app.post('/api/v1/keypairs/:id/verify', async (req) => {
    scopeCheck('keypairs:write')(req);
    const { id } = req.params as { id: string };
    const body = parseBody(keypairVerifySchema, req.body ?? {});
    return {
      data: await verifyKeypair(app.db, app.config, id, body.hostIds, actorFromRequest(req)),
    };
  });

  app.get('/api/v1/keypairs/:id/connect-command', async (req) => {
    scopeCheck('keypairs:read')(req);
    const { id } = req.params as { id: string };
    const query = parseQuery(connectCommandQuerySchema, req.query);
    return { data: await connectCommand(app.db, id, query.hostId) };
  });

  app.get('/api/v1/keypairs/:id/public-key', async (req, reply) => {
    scopeCheck('keypairs:read')(req);
    const { id } = req.params as { id: string };
    const kp = await getKeypairRow(app.db, id);
    reply
      .type('text/plain; charset=utf-8')
      .header('content-disposition', `attachment; filename="${kp.name}.pub"`)
      .send(kp.public_key);
  });

  app.post('/api/v1/keypairs/:id/private-key', async (req, reply) => {
    scopeCheck('keypairs:read')(req);
    denyAgent(req);
    const auth = getAuth(req);
    if (auth.via !== 'session') throw errors.forbidden('私钥导出仅支持登录会话');
    if (!isRevealWindowActive(auth.revealUntil)) {
      throw errors.forbidden('需要先完成二次验证', '请在 5 分钟内通过 /api/v1/auth/reveal 验证密码');
    }
    const { id } = req.params as { id: string };
    const kp = await getKeypairRow(app.db, id);
    if (!kp.has_private) throw errors.conflict('该密钥不含私钥');
    const privateKey = decryptPrivateForDownload(kp, app.config);
    await writeAudit(app.db, {
      actorId: auth.user.id,
      actorLabel: auth.actorLabel,
      actorKind: auth.actorKind,
      action: '导出私钥',
      category: 'key',
      targetId: id,
      detail: { name: kp.name },
      ip: req.ip,
      ua: (req.headers['user-agent'] as string | undefined) ?? null,
      success: true,
    });
    reply
      .type('application/x-pem-file')
      .header('content-disposition', `attachment; filename="${kp.name}.pem"`)
      .send(privateKey);
  });
}
