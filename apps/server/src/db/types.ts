/** Kysely 数据库类型定义（SQLite / PostgreSQL 共用，所有时间为 ISO 文本，布尔为 0/1 整数） */

export interface UsersTable {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  role: string;
  totp_secret_enc: string | null;
  totp_enabled: number;
  status: string;
  created_at: string;
  last_login_at: string | null;
  last_login_ip: string | null;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_token: string;
  reveal_until: string | null;
  ip: string | null;
  ua: string | null;
  expires_at: string;
  created_at: string;
}

export interface ApiTokensTable {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  token_hash: string;
  scopes_json: string;
  kind: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface HostsTable {
  id: string;
  name: string;
  address: string;
  port: number;
  ssh_user: string;
  env: string;
  group_name: string | null;
  provider: string | null;
  tags_json: string | null;
  notes: string | null;
  status: string;
  os: string | null;
  kernel: string | null;
  arch: string | null;
  cpu_model: string | null;
  cpu_cores: number | null;
  mem_total_mb: number | null;
  disk_json: string | null;
  ips_json: string | null;
  load_avg: string | null;
  uptime_sec: number | null;
  virtualization: string | null;
  containers: number | null;
  timezone: string | null;
  host_key_fp: string | null;
  last_probe_at: string | null;
  probe_ok: number | null;
  bandwidth_mbps: number | null;
  traffic_tb: number | null;
  billing_type: string | null;
  cost_month: number | null;
  expires_at: string | null;
  credential_id: string | null;
  keypair_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface HostCredentialsTable {
  host_id: string;
  credential_id: string;
  role: string;
}

export interface ProbeSnapshotsTable {
  id: string;
  host_id: string;
  status: string;
  facts_json: string;
  raw_json: string | null;
  error: string | null;
  created_at: string;
}

export interface CredentialsTable {
  id: string;
  name: string;
  type: string;
  encrypted_dek: string;
  encrypted_value: string;
  dek_iv: string;
  dek_tag: string;
  value_iv: string;
  value_tag: string;
  fingerprint: string | null;
  strength: string | null;
  owner_id: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface KeypairsTable {
  id: string;
  name: string;
  algorithm: string;
  source: string;
  public_key: string;
  encrypted_private_key: string | null;
  private_iv: string | null;
  private_tag: string | null;
  fingerprint: string;
  has_private: number;
  last_verified_at: string | null;
  created_by: string;
  created_at: string;
}

export interface KeyDeploymentsTable {
  keypair_id: string;
  host_id: string;
  deployed_by: string;
  deployed_at: string;
  verify_ok: number | null;
  verified_at: string | null;
}

export interface AuditLogsTable {
  id: string;
  actor_id: string | null;
  actor_label: string;
  actor_kind: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail_json: string | null;
  ip: string | null;
  ua: string | null;
  success: number;
  created_at: string;
}

export interface SettingsTable {
  key: string;
  value_json: string;
  updated_at: string;
}

export interface VersionHistoryTable {
  id: string;
  version: string;
  action: string;
  detail_json: string | null;
  actor_label: string;
  created_at: string;
}

export interface DatabaseSchema {
  users: UsersTable;
  sessions: SessionsTable;
  api_tokens: ApiTokensTable;
  hosts: HostsTable;
  host_credentials: HostCredentialsTable;
  probe_snapshots: ProbeSnapshotsTable;
  credentials: CredentialsTable;
  keypairs: KeypairsTable;
  key_deployments: KeyDeploymentsTable;
  audit_logs: AuditLogsTable;
  settings: SettingsTable;
  version_history: VersionHistoryTable;
}
