import type { Kysely } from 'kysely';
import { APP_VERSION } from '@opsvault/shared';
import type { DatabaseSchema } from '../db/types.js';
import { mergedSettings } from './settings.js';

export async function sendWebhook(
  db: Kysely<DatabaseSchema>,
  event: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  let url: string;
  try {
    const settings = await mergedSettings(db);
    url = String((settings.notifications as Record<string, unknown>).webhookUrl ?? '').trim();
  } catch {
    return { ok: false, error: 'settings unreadable' };
  }
  if (!url) return { ok: false, error: '未配置 Webhook' };
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Webhook 必须是 http(s) 地址' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event, platform: 'opsvault', version: APP_VERSION, at: new Date().toISOString(), ...payload }),
      signal: AbortSignal.timeout(5_000),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
