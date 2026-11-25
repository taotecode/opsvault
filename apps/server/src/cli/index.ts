import { loadConfig } from '../config.js';
import { createDatabase, migrateToLatest } from '../db/database.js';
import { currentSetupToken, isInstalled, resetInstall } from '../services/setup.js';
import { APP_VERSION } from '@boerfen/shared';

const commands = ['migrate', 'reset-install', 'setup-token', 'version', 'status'] as const;
type Command = (typeof commands)[number];

async function main(): Promise<void> {
  const [, , rawCommand] = process.argv;
  const command = rawCommand as Command | undefined;
  if (!command || !commands.includes(command)) {
    // eslint-disable-next-line no-console
    console.log(`用法：pnpm cli <${commands.join('|')}> [--yes]`);
    process.exit(1);
  }
  const config = loadConfig();
  const db = createDatabase(config.db);
  try {
    if (command === 'version') {
      // eslint-disable-next-line no-console
      console.log(APP_VERSION);
      return;
    }
    await migrateToLatest(db);
    if (command === 'migrate') {
      // eslint-disable-next-line no-console
      console.log('数据库迁移完成');
      return;
    }
    if (command === 'status') {
      const state = await isInstalled(db, config);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ...state, database: config.db.driver, version: APP_VERSION }, null, 2));
      return;
    }
    if (command === 'setup-token') {
      if ((await isInstalled(db, config)).installed) {
        // eslint-disable-next-line no-console
        console.log('平台已安装，安装入口已锁定。如确需重装，请执行 pnpm cli reset-install --yes（需先清空数据库用户）');
        return;
      }
      // eslint-disable-next-line no-console
      console.log(currentSetupToken(config));
      return;
    }
    if (command === 'reset-install') {
      const yes = process.argv.includes('--yes');
      if (!yes) {
        // eslint-disable-next-line no-console
        console.log('该命令将移除安装锁，使 /setup 可再次访问。确认请在命令后追加 --yes。');
        return;
      }
      await resetInstall(db, config);
      // eslint-disable-next-line no-console
      console.log('安装锁已移除；重启服务后访问 /setup（新 Setup Token 将打印到控制台）。');
    }
  } finally {
    await db.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
