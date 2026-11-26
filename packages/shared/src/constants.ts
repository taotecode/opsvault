export const ROLES = ['admin', 'operator', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const HOST_ENVS = ['prod', 'staging', 'dev'] as const;
export type HostEnv = (typeof HOST_ENVS)[number];

export const HOST_STATUSES = ['pending', 'online', 'warning', 'offline'] as const;
export type HostStatus = (typeof HOST_STATUSES)[number];

export const CREDENTIAL_TYPES = ['password', 'ssh_key', 'api_token', 'certificate', 'custom'] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export const KEY_ALGORITHMS = ['Ed25519', 'RSA-4096'] as const;
export type KeyAlgorithm = (typeof KEY_ALGORITHMS)[number];

export const TOKEN_KINDS = ['user', 'agent'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export const AUDIT_CATEGORIES = ['auth', 'asset', 'cred', 'key', 'user', 'api', 'system'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const SCOPES = [
  'hosts:read',
  'hosts:write',
  'credentials:read',
  'credentials:write',
  'keypairs:read',
  'keypairs:write',
  'audit:read',
  'system:read',
  'users:read',
  'users:write',
  'settings:read',
  'settings:write',
] as const;
export type Scope = (typeof SCOPES)[number];

/** Agent tokens are read-only unless write scopes are explicitly granted. */
export const AGENT_DENIED_OPERATIONS = ['credentials:reveal', 'keypairs:private-key', 'terminal'] as const;

export const DEFAULT_TOKEN_SCOPES: Scope[] = [
  'hosts:read',
  'credentials:read',
  'keypairs:read',
  'audit:read',
  'system:read',
];

export const APP_NAME = 'OpsVault';
export const APP_VERSION = '0.1.0';
