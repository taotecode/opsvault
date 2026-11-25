import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../lib/permissions.js';
import { checkUpdates, versionHistory, versionInfo } from '../services/system.js';
import { isInstalled } from '../services/setup.js';

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/system/version', async () => {
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
    requireAdmin(req);
    return { data: await checkUpdates(app.config) };
  });

  app.get('/api/v1/system/update-history', async (req) => {
    requireAdmin(req);
    return { data: await versionHistory(app.db) };
  });

  app.post('/api/v1/system/check-updates', async (req) => {
    requireAdmin(req);
    return { data: await checkUpdates(app.config) };
  });
}
