import fs from 'node:fs';
import { APP_VERSION } from '@boerfen/shared';
import { loadConfig } from './config.js';
import { createDatabase, migrateToLatest } from './db/database.js';
import {
  autoInstallFromEnv,
  currentSetupToken,
  installLockPath,
  isInstalled,
} from './services/setup.js';
import { startProbeScheduler } from './services/probeScheduler.js';
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
      JSON.stringify({ installedAt: new Date().toISOString(), version: APP_VERSION, inferred: true }, null, 2),
    );
    state = await isInstalled(db, config);
  }
  if (!state.installed) {
    const token = currentSetupToken(config);

    console.log('==================================================');

    console.log('🚀 铂尔分服务器资产管理平台 首次安装');

    console.log(`   安装地址： ${config.baseUrl}/setup`);

    console.log(`   Setup Token： ${token}`);

    console.log('   安装完成后 /setup 与安装 API 将永久返回 404。');

    console.log('==================================================');
  } else if (installedByEnv) {

    console.log('[setup] 已通过环境变量完成非交互安装，安装入口已锁定');
  }

  const app = await buildApp({ config, db });
  startProbeScheduler(app);
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

  console.error(err);
  process.exit(1);
});
