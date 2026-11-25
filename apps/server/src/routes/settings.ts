import type { FastifyInstance } from 'fastify';
import { settingsPatchSchema } from '@boerfen/shared';
import { requireAdmin, scopeCheck } from '../lib/permissions.js';
import { parseBody } from '../lib/validate.js';
import { actorFromRequest } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';

export const SETTING_DEFAULTS = {
  security: {
    sessionDays: 7,
    forceTotp: false,
    revealWindowMinutes: 5,
    loginLockout: true,
  },
  probe: {
    schedule: 'off',
    concurrency: 4,
    timeoutSec: 8,
    snapshotKeep: 20,
  },
  notifications: {
    expiryDays: 30,
    webhookUrl: '',
  },
  system: {
    updateChannel: 'github',
  },
};

const ALLOWED_KEYS = Object.keys(SETTING_DEFAULTS) as Array<keyof typeof SETTING_DEFAULTS>;

function stripUnknown(key: string, value: unknown): unknown {
  const base = SETTING_DEFAULTS[key as keyof typeof SETTING_DEFAULTS];
  if (!base || typeof base !== 'object' || value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base as Record<string, unknown>)) {
    if ((value as Record<string, unknown>)[k] !== undefined) {
      out[k] = (value as Record<string, unknown>)[k];
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function mergedSettings(app: FastifyInstance): Promise<Record<string, unknown>> {
  const rows = await app.db.selectFrom('settings').selectAll().execute();
  const merged: Record<string, unknown> = JSON.parse(JSON.stringify(SETTING_DEFAULTS));
  for (const row of rows) {
    if (!(row.key in merged)) continue;
    try {
      merged[row.key] = { ...(merged[row.key] as object), ...(JSON.parse(row.value_json) as object) };
    } catch {
      /* ignore corrupt */
    }
  }
  return merged;
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/settings', async (req) => {
    scopeCheck('settings:read')(req);
    return { data: await mergedSettings(app) };
  });

  app.patch('/api/v1/settings', async (req) => {
    requireAdmin(req);
    const patch = parseBody(settingsPatchSchema, req.body);
    const now = new Date().toISOString();
    for (const [key, value] of Object.entries(patch)) {
      if (!ALLOWED_KEYS.includes(key as never)) continue;
      const cleaned = stripUnknown(key, value);
      await app.db
        .insertInto('settings')
        .values({ key, value_json: JSON.stringify(cleaned), updated_at: now })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value_json: JSON.stringify(cleaned), updated_at: now }))
        .execute();
    }
    await writeAudit(app.db, {
      ...actorFromRequest(req),
      actorId: (req.auth?.user.id ?? null) as string | null,
      actorLabel: req.auth?.actorLabel ?? 'system',
      actorKind: req.auth?.actorKind ?? 'system',
      action: '更新设置',
      category: 'system',
      detail: { keys: Object.keys(patch) },
    });
    return { data: await mergedSettings(app) };
  });
}
