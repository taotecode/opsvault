import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../db/types.js';

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

export type SecuritySettings = {
  forceTotp: boolean;
  revealWindowMinutes: number;
  loginLockout: boolean;
};

export type ProbeSettings = {
  schedule: 'off' | 'hourly' | 'daily';
  concurrency: number;
  timeoutSec: number;
  snapshotKeep: number;
};

export type NotificationSettings = { expiryDays: number };

export async function mergedSettings(db: Kysely<DatabaseSchema>): Promise<Record<string, unknown>> {
  const rows = await db.selectFrom('settings').selectAll().execute();
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

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export async function securitySettings(db: Kysely<DatabaseSchema>): Promise<SecuritySettings> {
  const merged = await mergedSettings(db);
  const sec = merged.security as Record<string, unknown>;
  return {
    forceTotp: sec.forceTotp === true,
    revealWindowMinutes: clampInt(sec.revealWindowMinutes, 5, 1, 60),
    loginLockout: sec.loginLockout !== false,
  };
}

export async function probeSettings(db: Kysely<DatabaseSchema>): Promise<ProbeSettings> {
  const merged = await mergedSettings(db);
  const probe = merged.probe as Record<string, unknown>;
  return {
    schedule: probe.schedule === 'hourly' || probe.schedule === 'daily' ? probe.schedule : 'off',
    concurrency: clampInt(probe.concurrency, 4, 1, 8),
    timeoutSec: clampInt(probe.timeoutSec, 8, 3, 60),
    snapshotKeep: clampInt(probe.snapshotKeep, 20, 1, 200),
  };
}

export async function notificationSettings(db: Kysely<DatabaseSchema>): Promise<NotificationSettings> {
  const merged = await mergedSettings(db);
  const n = merged.notifications as Record<string, unknown>;
  return { expiryDays: clampInt(n.expiryDays, 30, 1, 365) };
}
