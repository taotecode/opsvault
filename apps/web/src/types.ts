export type Role = 'admin' | 'operator' | 'viewer';
export type Env = 'prod' | 'staging' | 'dev';
export type HostStatus = 'pending' | 'online' | 'warning' | 'offline';

export interface User {
  id: string;
  username: string;
  email: string;
  role: Role;
  status: string;
  totpEnabled: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface DiskInfo {
  mount: string;
  filesystem: string;
  sizeKb: number;
  usedKb: number;
  usePct: number;
}
export interface IpInfo {
  iface: string;
  address: string;
}

export interface Host {
  id: string;
  name: string;
  address: string;
  port: number;
  sshUser: string;
  env: Env;
  group: string | null;
  provider: string | null;
  tags: string[];
  notes: string | null;
  status: HostStatus;
  os: string | null;
  kernel: string | null;
  arch: string | null;
  cpuModel: string | null;
  cpuCores: number | null;
  memTotalMb: number | null;
  disks: DiskInfo[];
  ips: IpInfo[];
  loadAvg: string | null;
  uptimeSec: number | null;
  virtualization: string | null;
  containers: number | null;
  timezone: string | null;
  hostKeyFp: string | null;
  lastProbeAt: string | null;
  probeOk: boolean | null;
  bandwidthMbps: number | null;
  trafficTb: number | null;
  billingType: string | null;
  costMonth: number | null;
  expiresAt: string | null;
  credentialId: string | null;
  keypairId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Credential {
  id: string;
  name: string;
  type: 'password' | 'ssh_key' | 'api_token' | 'certificate' | 'custom';
  strength: 'strong' | 'medium' | 'weak' | null;
  fingerprint: string | null;
  hostCount: number;
  hosts: string[];
  hostIds?: string[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  checkSummary?: {
    usable: number;
    failed: number;
    unchecked: number;
    lastCheckedAt: string | null;
  } | null;
}

/** 主机维度的关联凭据（含对该主机的最近验证状态）。 */
export interface HostCredentialLink {
  id: string;
  name: string;
  type: Credential['type'];
  strength: Credential['strength'];
  role: 'primary' | 'linked' | string;
  lastCheckOk: boolean | null;
  lastCheckError: string | null;
  lastCheckedAt: string | null;
}

export interface CredentialCheckResult {
  hostId: string;
  hostName: string;
  ok: boolean;
  error?: string;
  checkedAt: string;
}

export interface KeypairHost {
  hostId: string;
  hostName: string;
  verifyOk: boolean | null;
}

export interface Keypair {
  id: string;
  name: string;
  algorithm: 'Ed25519' | 'RSA-4096';
  source: 'generated' | 'imported';
  fingerprint: string;
  hasPrivate: boolean;
  publicKey: string;
  deployed: number;
  verified: number;
  failed: number;
  lastVerifiedAt: string | null;
  createdBy: string;
  createdAt: string;
  hosts: KeypairHost[];
  privateKey?: string;
}

export interface QuickConnect {
  keypairId: string;
  keyName: string;
  keyFile: string;
  hostId: string;
  hostName: string;
  address: string;
  port: number;
  sshUser: string;
  ssh: string;
  scp: string;
  deployed: boolean;
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  kind: 'user' | 'agent';
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  token?: string;
}

export interface AuditEntry {
  id?: string;
  time: string;
  actor: string;
  actorKind?: string;
  action: string;
  category?: string | null;
  target?: string | null;
  detail?: unknown;
  ip?: string | null;
  success: boolean;
}

export interface SetupStatus {
  installed: boolean;
  locked: boolean;
  version: string;
}

export interface VersionInfo {
  version: string;
  commit: string;
  buildDate: string | null;
  database: string;
  baseUrl: string;
  installed?: boolean;
  locked?: boolean;
  masterKeySource?: 'env' | 'file' | 'missing';
  masterKeyRotationSupported?: boolean;
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

export interface MeResponse {
  user: User;
  via: 'session' | 'token';
  revealUntil: string | null;
}
