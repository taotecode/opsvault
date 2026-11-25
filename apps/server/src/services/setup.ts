import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ulid } from 'ulid';
import type { Kysely } from 'kysely';
import { APP_VERSION, setupAdminSchema } from '@boerfen/shared';
import type { AppConfig, DbConfig } from '../config.js';
import type { DatabaseSchema } from '../db/types.js';
import { createDatabase, migrateToLatest, testDatabase } from '../db/database.js';
import { countUsers, createUser } from './users.js';
import { clearSetupToken, getOrCreateSetupToken, safeEqual } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';

export const installLockPath = (config: AppConfig): string =>
  path.join(config.dataDir, 'install.lock');

export async function isInstalled(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
): Promise<{ installed: boolean; locked: boolean }> {
  const locked = fs.existsSync(installLockPath(config)) || config.forceInstallLock;
  const users = await countUsers(db);
  return { installed: locked || users > 0, locked };
}

export async function setupStatus(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
): Promise<{ installed: boolean; locked: boolean; version: string }> {
  const state = await isInstalled(db, config);
  return { ...state, version: APP_VERSION };
}

export function currentSetupToken(config: AppConfig): string {
  return getOrCreateSetupToken(config.dataDir);
}

export interface EnvironmentCheck {
  nodeVersion: string;
  openssh: boolean;
  dataDirWritable: boolean;
}

export function checkEnvironment(config: AppConfig): EnvironmentCheck {
  const ssh = spawnSync('ssh-keygen', ['-V'], { encoding: 'utf8', timeout: 2_000 });
  let dataDirWritable = false;
  try {
    fs.accessSync(config.dataDir, fs.constants.W_OK);
    dataDirWritable = true;
  } catch {
    /* not writable */
  }
  return {
    nodeVersion: process.version,
    openssh: !ssh.error,
    dataDirWritable,
  };
}

export function verifySetupToken(config: AppConfig, token: string): void {
  const expected = getOrCreateSetupToken(config.dataDir);
  if (!safeEqual(token, expected)) {
    throw errors.forbidden('Setup Token 不正确', 'Token 打印在服务端控制台');
  }
}

function resolveSetupDatabase(config: AppConfig, input: {
  driver: 'sqlite' | 'postgres';
  path?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
}): DbConfig {
  if (input.driver === 'sqlite') {
    const raw = input.path || 'data/boerfen.db';
    const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(config.dataDir, raw.replace(/^data\//, ''));
    if (!resolved.startsWith(config.dataDir + path.sep)) {
      throw errors.validation(resolved, 'SQLite 数据文件必须位于 data 目录内');
    }
    return { driver: 'sqlite', path: resolved };
  }
  const password = input.password ? `:${encodeURIComponent(input.password)}` : '';
  const connectionString = `postgres://${encodeURIComponent(input.user || 'boerfen')}${password}@${input.host}:${input.port || 5432}/${input.database}`;
  return { driver: 'postgres', connectionString };
}

export async function testSetupDatabase(
  config: AppConfig,
  input: Parameters<typeof resolveSetupDatabase>[1],
): Promise<{ ok: boolean; error?: string }> {
  return testDatabase(resolveSetupDatabase(config, input));
}

export interface CompleteSetupResult {
  db: Kysely<DatabaseSchema>;
  adminEmail: string;
}

export async function completeSetup(
  currentDb: Kysely<DatabaseSchema>,
  config: AppConfig,
  input: {
    token: string;
    database: Parameters<typeof resolveSetupDatabase>[1];
    admin: { email: string; password: string; enableTotp?: boolean };
  },
): Promise<CompleteSetupResult> {
  verifySetupToken(config, input.token);
  const installed = await isInstalled(currentDb, config);
  if (installed.installed) throw errors.setupLocked();

  const target = resolveSetupDatabase(config, input.database);
  const probe = await testDatabase(target);
  if (!probe.ok) throw errors.validation(probe.error, '数据库连接失败');
  const newDb = createDatabase(target);
  await migrateToLatest(newDb);
  const users = await countUsers(newDb);
  if (users > 0) {
    await newDb.destroy();
    throw errors.setupLocked();
  }
  await createUser(newDb, {
    email: input.admin.email,
    password: input.admin.password,
    role: 'admin',
  });
  const now = new Date().toISOString();
  await newDb
    .insertInto('version_history')
    .values({
      id: ulid(),
      version: APP_VERSION,
      action: 'install',
      detail_json: JSON.stringify({ database: target.driver }),
      actor_label: 'system',
      created_at: now,
    })
    .execute();
  await newDb
    .insertInto('audit_logs')
    .values({
      id: ulid(),
      actor_id: null,
      actor_label: 'system',
      actor_kind: 'system',
      action: '完成在线安装',
      target_type: 'system',
      target_id: null,
      detail_json: JSON.stringify({ database: target.driver, admin: input.admin.email }),
      ip: null,
      ua: null,
      success: 1,
      created_at: now,
    })
    .execute();
  fs.writeFileSync(
    config.runtimeConfigPath,
    JSON.stringify({ database: target, installedAt: now }, null, 2),
    { mode: 0o600 },
  );
  fs.writeFileSync(
    installLockPath(config),
    JSON.stringify({ installedAt: now, version: APP_VERSION, database: target.driver }, null, 2),
    { mode: 0o600 },
  );
  clearSetupToken(config.dataDir);
  return { db: newDb, adminEmail: input.admin.email };
}

/** 非交互安装（Docker/CI）：有管理员变量且尚无管理员时创建并锁定 */
export async function autoInstallFromEnv(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
): Promise<boolean> {
  if (!config.adminEmail || !config.adminPassword) return false;
  const parsed = setupAdminSchema.safeParse({
    email: config.adminEmail,
    password: config.adminPassword,
    enableTotp: false,
  });
  if (!parsed.success) {
    throw new Error('ADMIN_EMAIL/ADMIN_PASSWORD 不合法：邮箱需有效，密码至少 8 位');
  }
  const users = await countUsers(db);
  if (users > 0) return false;
  await createUser(db, {
    email: config.adminEmail,
    password: config.adminPassword,
    role: 'admin',
  });
  fs.writeFileSync(
    installLockPath(config),
    JSON.stringify({ installedAt: new Date().toISOString(), version: APP_VERSION, database: config.db.driver, via: 'env' }, null, 2),
    { mode: 0o600 },
  );
  clearSetupToken(config.dataDir);
  return true;
}

export async function resetInstall(db: Kysely<DatabaseSchema>, config: AppConfig): Promise<void> {
  const users = await countUsers(db);
  if (users > 0) {
    throw errors.conflict('仍有用户存在；重装前请先备份并清空数据库');
  }
  try {
    fs.rmSync(installLockPath(config));
  } catch {
    /* ignore */
  }
  await db
    .insertInto('audit_logs')
    .values({
      id: ulid(),
      actor_id: null,
      actor_label: 'cli',
      actor_kind: 'system',
      action: '重置安装锁',
      target_type: 'system',
      target_id: null,
      detail_json: null,
      ip: null,
      ua: null,
      success: 1,
      created_at: new Date().toISOString(),
    })
    .execute();
}
