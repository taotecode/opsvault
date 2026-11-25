import BetterSqlite3 from 'better-sqlite3';
import { Kysely, PostgresDialect, SqliteDialect, sql } from 'kysely';
import { Migrator, type Migration } from 'kysely/migration';
import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import type { DbConfig } from '../config.js';
import type { DatabaseSchema } from './types.js';

export function createDatabase(cfg: DbConfig): Kysely<DatabaseSchema> {
  if (cfg.driver === 'postgres') {
    const pool = new Pool({ connectionString: cfg.connectionString, max: 10 });
    return new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  }
  const file = cfg.path;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const database = new BetterSqlite3(file);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  return new Kysely<DatabaseSchema>({ dialect: new SqliteDialect({ database }) });
}

/** 双方言可用的表结构迁移（统一使用 text/integer，时间 ISO 文本，布尔 0/1） */
const migrations: Record<string, Migration> = {
  '001_init': {
    async up(db) {
      await db.schema
        .createTable('users')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('username', 'text', (c) => c.notNull())
        .addColumn('email', 'text', (c) => c.notNull().unique())
        .addColumn('password_hash', 'text', (c) => c.notNull())
        .addColumn('role', 'text', (c) => c.notNull())
        .addColumn('totp_secret_enc', 'text')
        .addColumn('totp_enabled', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('last_login_at', 'text')
        .addColumn('last_login_ip', 'text')
        .execute();

      await db.schema
        .createTable('sessions')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('token_hash', 'text', (c) => c.notNull().unique())
        .addColumn('csrf_token', 'text', (c) => c.notNull())
        .addColumn('reveal_until', 'text')
        .addColumn('ip', 'text')
        .addColumn('ua', 'text')
        .addColumn('expires_at', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('api_tokens')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('prefix', 'text', (c) => c.notNull())
        .addColumn('token_hash', 'text', (c) => c.notNull().unique())
        .addColumn('scopes_json', 'text', (c) => c.notNull())
        .addColumn('kind', 'text', (c) => c.notNull())
        .addColumn('expires_at', 'text')
        .addColumn('last_used_at', 'text')
        .addColumn('created_at', 'text', (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('credentials')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('type', 'text', (c) => c.notNull())
        .addColumn('encrypted_dek', 'text', (c) => c.notNull())
        .addColumn('encrypted_value', 'text', (c) => c.notNull())
        .addColumn('dek_iv', 'text', (c) => c.notNull())
        .addColumn('dek_tag', 'text', (c) => c.notNull())
        .addColumn('value_iv', 'text', (c) => c.notNull())
        .addColumn('value_tag', 'text', (c) => c.notNull())
        .addColumn('fingerprint', 'text')
        .addColumn('strength', 'text')
        .addColumn('owner_id', 'text', (c) => c.notNull())
        .addColumn('updated_by', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('updated_at', 'text', (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('keypairs')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('algorithm', 'text', (c) => c.notNull())
        .addColumn('source', 'text', (c) => c.notNull())
        .addColumn('public_key', 'text', (c) => c.notNull())
        .addColumn('encrypted_private_key', 'text')
        .addColumn('private_iv', 'text')
        .addColumn('private_tag', 'text')
        .addColumn('fingerprint', 'text', (c) => c.notNull())
        .addColumn('has_private', 'integer', (c) => c.notNull())
        .addColumn('last_verified_at', 'text')
        .addColumn('created_by', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('hosts')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('address', 'text', (c) => c.notNull())
        .addColumn('port', 'integer', (c) => c.notNull())
        .addColumn('ssh_user', 'text', (c) => c.notNull())
        .addColumn('env', 'text', (c) => c.notNull())
        .addColumn('group_name', 'text')
        .addColumn('provider', 'text')
        .addColumn('tags_json', 'text')
        .addColumn('notes', 'text')
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('os', 'text')
        .addColumn('kernel', 'text')
        .addColumn('arch', 'text')
        .addColumn('cpu_model', 'text')
        .addColumn('cpu_cores', 'integer')
        .addColumn('mem_total_mb', 'integer')
        .addColumn('disk_json', 'text')
        .addColumn('ips_json', 'text')
        .addColumn('load_avg', 'text')
        .addColumn('uptime_sec', 'integer')
        .addColumn('virtualization', 'text')
        .addColumn('containers', 'integer')
        .addColumn('timezone', 'text')
        .addColumn('host_key_fp', 'text')
        .addColumn('last_probe_at', 'text')
        .addColumn('probe_ok', 'integer')
        .addColumn('bandwidth_mbps', 'integer')
        .addColumn('traffic_tb', 'integer')
        .addColumn('billing_type', 'text')
        .addColumn('cost_month', 'real')
        .addColumn('expires_at', 'text')
        .addColumn('credential_id', 'text')
        .addColumn('keypair_id', 'text')
        .addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('updated_at', 'text', (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('host_credentials')
        .addColumn('host_id', 'text', (c) =>
          c.notNull().references('hosts.id').onDelete('cascade'),
        )
        .addColumn('credential_id', 'text', (c) =>
          c.notNull().references('credentials.id').onDelete('cascade'),
        )
        .addColumn('role', 'text', (c) => c.notNull().defaultTo('primary'))
        .addPrimaryKeyConstraint('host_credentials_pk', ['host_id', 'credential_id'])
        .execute();

      await db.schema
        .createTable('probe_snapshots')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('host_id', 'text', (c) => c.notNull().references('hosts.id').onDelete('cascade'))
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('facts_json', 'text', (c) => c.notNull())
        .addColumn('raw_json', 'text')
        .addColumn('error', 'text')
        .addColumn('created_at', 'text', (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('key_deployments')
        .addColumn('keypair_id', 'text', (c) =>
          c.notNull().references('keypairs.id').onDelete('cascade'),
        )
        .addColumn('host_id', 'text', (c) => c.notNull().references('hosts.id').onDelete('cascade'))
        .addColumn('deployed_by', 'text', (c) => c.notNull())
        .addColumn('deployed_at', 'text', (c) => c.notNull())
        .addColumn('verify_ok', 'integer')
        .addColumn('verified_at', 'text')
        .addPrimaryKeyConstraint('key_deployments_pk', ['keypair_id', 'host_id'])
        .execute();

      await db.schema
        .createTable('audit_logs')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('actor_id', 'text')
        .addColumn('actor_label', 'text', (c) => c.notNull())
        .addColumn('actor_kind', 'text', (c) => c.notNull())
        .addColumn('action', 'text', (c) => c.notNull())
        .addColumn('target_type', 'text')
        .addColumn('target_id', 'text')
        .addColumn('detail_json', 'text')
        .addColumn('ip', 'text')
        .addColumn('ua', 'text')
        .addColumn('success', 'integer', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('settings')
        .addColumn('key', 'text', (c) => c.primaryKey())
        .addColumn('value_json', 'text', (c) => c.notNull())
        .addColumn('updated_at', 'text', (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('version_history')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('version', 'text', (c) => c.notNull())
        .addColumn('action', 'text', (c) => c.notNull())
        .addColumn('detail_json', 'text')
        .addColumn('actor_label', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .execute();

      await db.schema
        .createIndex('idx_hosts_env')
        .on('hosts')
        .columns(['env', 'status'])
        .execute();
      await db.schema.createIndex('idx_audit_created').on('audit_logs').columns(['created_at']).execute();
      await db.schema
        .createIndex('idx_sessions_user')
        .on('sessions')
        .columns(['user_id'])
        .execute();
      await db.schema
        .createIndex('idx_snapshots_host')
        .on('probe_snapshots')
        .columns(['host_id', 'created_at'])
        .execute();
    },
    async down(db) {
      await db.schema.dropTable('version_history').ifExists().execute();
      await db.schema.dropTable('settings').ifExists().execute();
      await db.schema.dropTable('audit_logs').ifExists().execute();
      await db.schema.dropTable('key_deployments').ifExists().execute();
      await db.schema.dropTable('probe_snapshots').ifExists().execute();
      await db.schema.dropTable('host_credentials').ifExists().execute();
      await db.schema.dropTable('hosts').ifExists().execute();
      await db.schema.dropTable('keypairs').ifExists().execute();
      await db.schema.dropTable('credentials').ifExists().execute();
      await db.schema.dropTable('api_tokens').ifExists().execute();
      await db.schema.dropTable('sessions').ifExists().execute();
      await db.schema.dropTable('users').ifExists().execute();
    },
  },
};

class Provider {
  async getMigrations() {
    return migrations;
  }
}

export async function migrateToLatest(db: Kysely<DatabaseSchema>): Promise<void> {
  const migrator = new Migrator({ db, provider: new Provider(), migrationTableName: 'schema_migrations', migrationLockTableName: 'schema_migrations_lock' });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    if (r.status === 'Error') throw new Error(`migration failed: ${r.migrationName}`);
  }
  if (error) throw error;
}

export async function testDatabase(cfg: DbConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = createDatabase(cfg);
    await sql`select 1`.execute(db);
    await db.destroy();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
