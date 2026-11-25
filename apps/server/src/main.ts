import fs from 'node:fs';
import { loadConfig } from './config.js';
import { createDatabase, migrateToLatest } from './db/database.js';
import {
  autoInstallFromEnv,
  currentSetupToken,
  installLockPath,
  isInstalled,
} from './services/setup.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDatabase(config.db);
  await migrateToLatest(db);
  const installedByEnv = await autoInstallFromEnv(db, config);

  let state = await isInstalled(db, config);
  if (state.installed && !state.locked) {
    fs.writeFileSync(
      installLockPath(config),
      JSON.stringify({ installedAt: new Date().toISOString(), version: '0.1.0', inferred: true }, null, 2),
    );
    state = await isInstalled(db, config);
  }
  if (!state.installed) {
    const token = currentSetupToken(config);
    // eslint-disable-next-line no-console
    console.log('==================================================');
    // eslint-disable-next-line no-console
    console.log('🚀 铂尔分服务器资产管理平台 首次安装');
    // eslint-disable-next-line no-console
    console.log(`   安装地址： ${config.baseUrl}/setup`);
    // eslint-disable-next-line no-console
    console.log(`   Setup Token： ${token}`);
    // eslint-disable-next-line no-console
    console.log('   安装完成后 /setup 与安装 API 将永久返回 404。');
    // eslint-disable-next-line no-console
    console.log('==================================================');
  } else if (installedByEnv) {
    // eslint-disable-next-line no-console
    console.log('[setup] 已通过环境变量完成非交互安装，安装入口已锁定');
  }

  const app = await buildApp({ config, db });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`Boerfen Assets listening on ${config.baseUrl} (db=${config.db.driver})`);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    await db.destroy().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
