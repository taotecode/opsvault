import type { FastifyInstance } from 'fastify';
import { settingsPatchSchema } from '@opsvault/shared';
import { denyAgent, requireAdmin, requireSession, scopeCheck } from '../lib/permissions.js';
import { parseBody } from '../lib/validate.js';
import { actorFromRequest } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { errors } from '../lib/errors.js';
import { SETTING_DEFAULTS, mergedSettings } from '../services/settings.js';
import { sendWebhook } from '../services/webhook.js';

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

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/settings', async (req) => {
    denyAgent(req);
    scopeCheck('settings:read')(req);
    const data = await mergedSettings(app.db);
    const auth = req.auth;
    if (auth?.user.role !== 'admin') {
      const notifications = data.notifications as Record<string, unknown>;
      notifications.webhookUrl = '';
    }
    return { data };
  });

  app.patch('/api/v1/settings', async (req) => {
    denyAgent(req);
    requireSession(req);
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
    return { data: await mergedSettings(app.db) };
  });

  app.post('/api/v1/settings/webhook-test', async (req) => {
    denyAgent(req);
    requireSession(req);
    requireAdmin(req);
    const settings = await mergedSettings(app.db);
    const notifications = settings.notifications as Record<string, unknown>;
    const url = String(notifications.webhookUrl ?? '').trim();
    if (!url) throw errors.validation(null, '请先保存 Webhook 地址');
    return { data: await sendWebhook(app.db, 'test', { message: 'OpsVault Webhook 测试消息' }) };
  });
}
