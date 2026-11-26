import type { FastifyInstance } from 'fastify';
import { APP_VERSION } from '@opsvault/shared';
import { denyAgent, getAuth, requireAdmin, requireSession, scopeCheck } from '../lib/permissions.js';
import { checkUpdates, versionHistory, versionInfo } from '../services/system.js';
import { isInstalled } from '../services/setup.js';
import { requireReveal } from '../services/auth.js';
import { writeAudit } from '../lib/audit.js';
import { actorFromRequest } from '../lib/actor.js';

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/system/version', async (req) => {
    scopeCheck('system:read')(req);
    const installed = await isInstalled(app.db, app.config);
    return {
      data: {
        ...versionInfo(app.config),
        installed: installed.installed,
        locked: installed.locked,
      },
    };
  });

  app.get('/api/v1/system/updates', async (req) => {
    denyAgent(req);
    requireSession(req);
    requireAdmin(req);
    return { data: await checkUpdates(app.config) };
  });

  app.get('/api/v1/system/update-history', async (req) => {
    denyAgent(req);
    requireSession(req);
    requireAdmin(req);
    return { data: await versionHistory(app.db) };
  });

  app.post('/api/v1/system/check-updates', async (req) => {
    denyAgent(req);
    requireSession(req);
    requireAdmin(req);
    return { data: await checkUpdates(app.config) };
  });

  app.post('/api/v1/system/export', async (req, reply) => {
    denyAgent(req);
    requireSession(req);
    requireAdmin(req);
    requireReveal(getAuth(req));
    const data = {
      users: await app.db.selectFrom('users').selectAll().execute(),
      hosts: await app.db.selectFrom('hosts').selectAll().execute(),
      credentials: await app.db.selectFrom('credentials').selectAll().execute(),
      keypairs: await app.db.selectFrom('keypairs').selectAll().execute(),
      host_credentials: await app.db.selectFrom('host_credentials').selectAll().execute(),
      key_deployments: await app.db.selectFrom('key_deployments').selectAll().execute(),
      probe_snapshots: await app.db.selectFrom('probe_snapshots').selectAll().execute(),
      audit_logs: await app.db.selectFrom('audit_logs').selectAll().execute(),
      settings: await app.db.selectFrom('settings').selectAll().execute(),
      version_history: await app.db.selectFrom('version_history').selectAll().execute(),
      api_tokens: await app.db.selectFrom('api_tokens').selectAll().execute(),
      sessions: await app.db.selectFrom('sessions').selectAll().execute(),
    };
    const now = new Date().toISOString();
    const filename = `opsvault-export-${now.slice(0, 10)}.json`;
    await writeAudit(app.db, {
      ...actorFromRequest(req),
      actorId: req.auth?.user.id ?? null,
      actorLabel: req.auth?.actorLabel ?? 'system',
      actorKind: req.auth?.actorKind ?? 'system',
      action: '导出数据',
      category: 'system',
      detail: { counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])) },
    });
    reply
      .header('content-disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .type('application/json; charset=utf-8')
      .send(JSON.stringify({ version: APP_VERSION, exportedAt: now, data }, null, 2));
  });
}
