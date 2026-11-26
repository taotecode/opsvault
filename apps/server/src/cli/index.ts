import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig } from '../config.js';
import { createDatabase, migrateToLatest } from '../db/database.js';
import { currentSetupToken, isInstalled, resetInstall } from '../services/setup.js';
import { APP_VERSION } from '@opsvault/shared';
import { ulid } from 'ulid';
import { getMasterKey } from '../lib/crypto.js';
import { rotateMasterKey } from '../lib/masterKeyRotation.js';

const commands = [
  'migrate',
  'reset-install',
  'setup-token',
  'version',
  'status',
  'record-upgrade',
  'master-key-status',
  'rotate-master-key',
] as const;
type Command = (typeof commands)[number];

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const [, , rawCommand] = process.argv;
  const command = rawCommand as Command | undefined;
  if (!command || !commands.includes(command)) {

    console.log(`用法：pnpm cli <${commands.join('|')}> [--yes]`);
    process.exit(1);
  }
  const config = loadConfig();
  const db = createDatabase(config.db);
  try {
    if (command === 'version') {

      console.log(APP_VERSION);
      return;
    }
    await migrateToLatest(db);
    if (command === 'migrate') {

      console.log('数据库迁移完成');
      return;
    }
    if (command === 'status') {
      const state = await isInstalled(db, config);

      console.log(JSON.stringify({ ...state, database: config.db.driver, version: APP_VERSION }, null, 2));
      return;
    }
    if (command === 'setup-token') {
      if ((await isInstalled(db, config)).installed) {

        console.log('平台已安装，安装入口已锁定。如确需重装，请执行 pnpm cli reset-install --yes（需先清空数据库用户）');
        return;
      }

      console.log(currentSetupToken(config));
      return;
    }
    if (command === 'record-upgrade') {
      const from = argValue('--from') ?? 'unknown';
      const to = argValue('--to') ?? APP_VERSION;
      const status = argValue('--status') === 'failed' ? 'failed' : 'success';
      const now = new Date().toISOString();
      await db
        .insertInto('version_history')
        .values({
          id: ulid(),
          version: to,
          action: 'upgrade',
          detail_json: JSON.stringify({ from, to, status }),
          actor_label: 'upgrade.sh',
          created_at: now,
        })
        .execute();
      await db
        .insertInto('audit_logs')
        .values({
          id: ulid(),
          actor_id: null,
          actor_label: 'upgrade.sh',
          actor_kind: 'system',
          action: '在线升级',
          target_type: 'system',
          target_id: null,
          detail_json: JSON.stringify({ from, to, status }),
          ip: null,
          ua: null,
          success: status === 'success' ? 1 : 0,
          created_at: now,
        })
        .execute();
      console.log(`已记录升级：${from} → ${to}（${status}）`);
      return;
    }
    if (command === 'master-key-status') {
      const keyFile = path.join(config.dataDir, 'master.key');
      console.log(
        JSON.stringify(
          {
            source: config.masterKey ? 'env' : fs.existsSync(keyFile) ? 'file' : 'auto-generated',
            keyFile,
            keyFileExists: fs.existsSync(keyFile),
            rotationSupported: !config.masterKey,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (command === 'rotate-master-key') {
      if (config.masterKey) {
        console.error('MASTER_KEY 由环境变量提供，CLI 不会改动环境；请轮换环境变量并重启，或改用 master.key 文件模式。');
        process.exit(2);
      }
      if (!process.argv.includes('--yes')) {
        console.log('该命令将重加密全部凭据、密钥对私钥与 TOTP 密钥的 KEK。请先停止服务并备份数据库与 master.key，然后追加 --yes。');
        return;
      }
      const keyFile = path.join(config.dataDir, 'master.key');
      const oldKey = getMasterKey(config);
      const rawNew = argValue('--new-key');
      const newKey = rawNew ? Buffer.from(rawNew, 'base64') : crypto.randomBytes(32);
      if (newKey.length !== 32) {
        console.error('新主密钥必须是 base64 编码的 32 字节');
        process.exit(2);
      }
      if (config.db.driver === 'sqlite' && fs.existsSync(config.db.path)) {
        const backupDir = path.join(config.dataDir, 'backups');
        fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
        const backup = path.join(backupDir, `pre-rotate-${Date.now()}.db`);
        fs.copyFileSync(config.db.path, backup);
        console.log(`已备份 SQLite 数据库到 ${backup}`);
      }
      const tmpKeyFile = `${keyFile}.next`;
      fs.writeFileSync(tmpKeyFile, newKey.toString('base64'), { mode: 0o600 });
      try {
        const stats = await rotateMasterKey(db, oldKey, newKey);
        fs.renameSync(tmpKeyFile, keyFile);
        await db
          .insertInto('audit_logs')
          .values({
            id: ulid(),
            actor_id: null,
            actor_label: 'cli',
            actor_kind: 'system',
            action: '轮换主密钥',
            target_type: 'system',
            target_id: null,
            detail_json: JSON.stringify(stats),
            ip: null,
            ua: null,
            success: 1,
            created_at: new Date().toISOString(),
          })
          .execute();
        console.log(`主密钥已轮换并写入 ${keyFile}：${JSON.stringify(stats)}`);
        console.log('请备份新的 master.key；旧备份需与旧密钥一起保留以便恢复历史备份。');
      } catch (e) {
        fs.rmSync(tmpKeyFile, { force: true });
        throw e;
      }
      return;
    }
    if (command === 'reset-install') {
      const yes = process.argv.includes('--yes');
      if (!yes) {

        console.log('该命令将移除安装锁，使 /setup 可再次访问。确认请在命令后追加 --yes。');
        return;
      }
      await resetInstall(db, config);

      console.log('安装锁已移除；重启服务后访问 /setup（新 Setup Token 将打印到控制台）。');
    }
  } finally {
    await db.destroy().catch(() => undefined);
  }
}

main().catch((err) => {

  console.error(err);
  process.exit(1);
});
