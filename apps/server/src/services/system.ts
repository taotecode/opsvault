import fs from 'node:fs';
import path from 'node:path';
import type { Kysely } from 'kysely';
import { APP_VERSION } from '@opsvault/shared';
import type { AppConfig } from '../config.js';
import type { DatabaseSchema } from '../db/types.js';

export function versionInfo(config: AppConfig): {
  version: string;
  commit: string;
  buildDate: string | null;
  database: string;
  baseUrl: string;
  masterKeySource: 'env' | 'file' | 'missing';
  masterKeyRotationSupported: boolean;
} {
  const keyFile = path.join(config.dataDir, 'master.key');
  return {
    version: APP_VERSION,
    commit: process.env.GIT_COMMIT || 'dev',
    buildDate: process.env.BUILD_DATE || null,
    database: config.db.driver,
    baseUrl: config.baseUrl,
    masterKeySource: config.masterKey ? 'env' : fs.existsSync(keyFile) ? 'file' : 'missing',
    masterKeyRotationSupported: !config.masterKey,
  };
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => Number(n) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
}

interface CacheEntry {
  at: number;
  value: UpdateInfo;
}

export interface UpdateInfo {
  enabled: boolean;
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  releaseNotes: string | null;
  releaseUrl: string | null;
  downloadUrl: string | null;
  checksumUrl: string | null;
  checkedAt: string | null;
  reason?: string;
}

const cache = new Map<string, CacheEntry>();
const CACHE_MS = 10 * 60_000;

export async function checkUpdates(config: AppConfig): Promise<UpdateInfo> {
  const base: UpdateInfo = {
    enabled: false,
    currentVersion: APP_VERSION,
    latestVersion: null,
    hasUpdate: false,
    releaseNotes: null,
    releaseUrl: null,
    downloadUrl: null,
    checksumUrl: null,
    checkedAt: null,
  };
  if (!config.updateCheck) return { ...base, reason: 'UPDATE_CHECK 未启用' };
  if (!config.githubRepo) return { ...base, reason: '未配置 GITHUB_REPO' };
  const key = config.githubRepo;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  try {
    const res = await fetch(`https://api.github.com/repos/${config.githubRepo}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'opsvault' },
    });
    if (!res.ok) {
      return { ...base, reason: `GitHub API ${res.status}` };
    }
    const release = (await res.json()) as GitHubRelease;
    const latest = (release.tag_name || '').replace(/^v/, '') || null;
    const assets = release.assets ?? [];
    const download = assets.find((a) => a.name?.endsWith('.tar.gz'))?.browser_download_url ?? null;
    const checksum = assets.find((a) => a.name === 'SHA256SUMS')?.browser_download_url ?? null;
    const value: UpdateInfo = {
      enabled: true,
      currentVersion: APP_VERSION,
      latestVersion: latest,
      hasUpdate: latest ? compareVersions(latest, APP_VERSION) > 0 : false,
      releaseNotes: release.body ?? null,
      releaseUrl: release.html_url ?? null,
      downloadUrl: download,
      checksumUrl: checksum,
      checkedAt: new Date().toISOString(),
    };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    return { ...base, reason: (e as Error).message };
  }
}

export async function versionHistory(
  db: Kysely<DatabaseSchema>,
): Promise<Array<{ id: string; version: string; action: string; detail: string | null; actorLabel: string; createdAt: string }>> {
  const rows = await db
    .selectFrom('version_history')
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(50)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    action: r.action,
    detail: r.detail_json,
    actorLabel: r.actor_label,
    createdAt: r.created_at,
  }));
}
