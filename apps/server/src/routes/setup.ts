import type { FastifyInstance } from 'fastify';
import {
  setupCompleteSchema,
  setupTestDbSchema,
} from '@boerfen/shared';
import {
  checkEnvironment,
  completeSetup,
  currentSetupToken,
  isInstalled,
  setupStatus,
  testSetupDatabase,
  verifySetupToken,
} from '../services/setup.js';
import { errors } from '../lib/errors.js';
import { parseBody } from '../lib/validate.js';

async function ensureSetupOpen(app: FastifyInstance): Promise<void> {
  const status = await isInstalled(app.db, app.config);
  if (status.installed) throw errors.setupLocked();
}

export async function setupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/setup/status', { config: { rateLimit: false } }, async () => {
    const status = await setupStatus(app.db, app.config);
    return { data: status };
  });

  app.get('/api/v1/bootstrap/status', { config: { rateLimit: false } }, async () => {
    const status = await setupStatus(app.db, app.config);
    if (status.installed) throw errors.setupLocked();
    return { data: status };
  });

  app.post('/api/v1/setup/verify-token', async (req) => {
    await ensureSetupOpen(app);
    const token = String(req.headers['x-setup-token'] ?? '');
    verifySetupToken(app.config, token);
    return { data: { ok: true } };
  });

  app.post('/api/v1/setup/test-database', async (req) => {
    await ensureSetupOpen(app);
    verifySetupToken(app.config, String(req.headers['x-setup-token'] ?? ''));
    const body = parseBody(setupTestDbSchema, req.body);
    const result = await testSetupDatabase(app.config, body.database as never);
    return { data: result };
  });

  app.post('/api/v1/setup/complete', async (req) => {
    await ensureSetupOpen(app);
    const body = parseBody(setupCompleteSchema, req.body);
    const result = await completeSetup(app.db, app.config, {
      token: body.token,
      database: body.database as never,
      admin: body.admin,
    });
    const oldDb = app.dbState.current;
    app.dbState.current = result.db;
    await oldDb.destroy();
    return { data: { ok: true, adminEmail: result.adminEmail, locked: true } };
  });

  app.get('/api/v1/setup/env-check', async () => {
    await ensureSetupOpen(app);
    return { data: checkEnvironment(app.config) };
  });

  // 仅供 CLI 初始化提示使用（不泄露 token）
  app.get('/api/v1/setup/console-hint', async () => {
    await ensureSetupOpen(app);
    return { data: { message: 'Setup Token 已打印在服务端控制台；无法通过 HTTP 获取。' } };
  });

  void currentSetupToken;
}
