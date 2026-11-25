import fs from 'node:fs';
import path from 'node:path';

export type DbConfig =
  | { driver: 'sqlite'; path: string }
  | { driver: 'postgres'; connectionString: string };

export interface AppConfig {
  port: number;
  baseUrl: string;
  dataDir: string;
  db: DbConfig;
  dbSource: 'env' | 'file' | 'default';
  masterKey?: string;
  sessionDays: number;
  revealWindowMinutes: number;
  githubRepo?: string;
  updateCheck: boolean;
  adminEmail?: string;
  adminPassword?: string;
  forceInstallLock: boolean;
  logLevel: string;
  trustProxy: boolean | string;
  isProd: boolean;
  runtimeConfigPath: string;
}

function readEnvFile(): void {
  try {
    // Node >= 20.12
    (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.('.env');
  } catch {
    /* ignore missing .env */
  }
}

function bool(v: string | undefined, fallback = false): boolean {
  if (v == null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function readRuntimeDbConfig(runtimeConfigPath: string): DbConfig | null {
  try {
    const raw = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf8')) as {
      database?: DbConfig;
    };
    const db = raw.database;
    if (!db) return null;
    if (db.driver === 'sqlite' && typeof db.path === 'string') return db;
    if (db.driver === 'postgres' && typeof db.connectionString === 'string') return db;
  } catch {
    return null;
  }
  return null;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  readEnvFile();
  const dataDir = path.resolve(process.env.DATA_DIR || './data');
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    fs.chmodSync(dataDir, 0o700);
  } catch {
    /* best effort (e.g. Windows) */
  }
  const runtimeConfigPath = path.join(dataDir, 'runtime-config.json');

  const fromFile = readRuntimeDbConfig(runtimeConfigPath);
  const envDriver = process.env.DB_DRIVER as 'sqlite' | 'postgres' | undefined;
  let db: DbConfig;
  let dbSource: 'env' | 'file' | 'default';
  if (fromFile) {
    db = fromFile;
    dbSource = 'file';
  } else if (envDriver === 'postgres') {
    db = {
      driver: 'postgres',
      connectionString:
        process.env.DATABASE_URL || 'postgres://boerfen:boerfen@localhost:5432/boerfen',
    };
    dbSource = 'env';
  } else {
    db = {
      driver: 'sqlite',
      path: path.join(dataDir, 'boerfen.db'),
    };
    dbSource = 'default';
  }

  const config: AppConfig = {
    port: Number(process.env.PORT || 8080),
    baseUrl: process.env.BASE_URL || 'http://localhost:8080',
    dataDir,
    db,
    dbSource,
    masterKey: process.env.MASTER_KEY || undefined,
    sessionDays: Number(process.env.SESSION_DAYS || 7),
    revealWindowMinutes: Number(process.env.REVEAL_WINDOW_MINUTES || 5),
    githubRepo: process.env.GITHUB_REPO || undefined,
    updateCheck: bool(process.env.UPDATE_CHECK, false),
    adminEmail: process.env.ADMIN_EMAIL || undefined,
    adminPassword: process.env.ADMIN_PASSWORD || undefined,
    forceInstallLock: bool(process.env.INSTALL_LOCK, false),
    logLevel: process.env.LOG_LEVEL || 'info',
    trustProxy: process.env.TRUST_PROXY || false,
    isProd: process.env.NODE_ENV === 'production',
    runtimeConfigPath,
    ...overrides,
  };
  // runtime overrides for tests
  if (overrides.dataDir) {
    config.dataDir = path.resolve(overrides.dataDir);
    fs.mkdirSync(config.dataDir, { recursive: true });
    config.runtimeConfigPath = path.join(config.dataDir, 'runtime-config.json');
  }
  return config;
}
