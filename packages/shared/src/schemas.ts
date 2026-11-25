import { z } from 'zod';
import {
  CREDENTIAL_TYPES,
  HOST_ENVS,
  KEY_ALGORITHMS,
  ROLES,
  SCOPES,
  TOKEN_KINDS,
} from './constants.js';

export const idSchema = z.string().min(1).max(64);
export const emailSchema = z.string().trim().toLowerCase().email().max(200);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  q: z.string().trim().max(200).optional(),
  fields: z.string().trim().max(400).optional(),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;

/* ---------- auth ---------- */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  totp: z.string().trim().min(4).max(10).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});
export const revealSchema = z.object({ password: z.string().min(1) });
export const totpEnableSchema = z.object({ code: z.string().trim().min(4).max(10) });

/* ---------- setup / installer ---------- */
export const setupDatabaseSchema = z.discriminatedUnion('driver', [
  z.object({ driver: z.literal('sqlite'), path: z.string().min(1).max(500).optional() }),
  z.object({
    driver: z.literal('postgres'),
    host: z.string().min(1),
    port: z.coerce.number().int().min(1).max(65535).default(5432),
    database: z.string().min(1),
    user: z.string().min(1),
    password: z.string().max(500).optional(),
  }),
]);
export const setupCompleteSchema = z.object({
  token: z.string().min(1).max(200),
  database: setupDatabaseSchema,
  admin: z.object({
    email: emailSchema,
    password: z.string().min(8).max(200),
    enableTotp: z.boolean().optional().default(false),
  }),
});
export const setupTestDbSchema = z.object({ database: setupDatabaseSchema });

/* ---------- hosts ---------- */
export const hostCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(300),
  port: z.coerce.number().int().min(1).max(65535).default(22),
  sshUser: z.string().trim().min(1).max(80).default('root'),
  env: z.enum(HOST_ENVS).default('prod'),
  group: z.string().trim().max(120).optional(),
  provider: z.string().trim().max(120).optional(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  notes: z.string().max(2000).optional(),
  bandwidthMbps: z.coerce.number().int().min(0).nullable().optional(),
  trafficTb: z.coerce.number().min(0).nullable().optional(),
  billingType: z.enum(['包年包月', '按量付费', '其他']).optional(),
  costMonth: z.coerce.number().min(0).nullable().optional(),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  credentialId: idSchema.nullable().optional(),
  keypairId: idSchema.nullable().optional(),
});
export type HostCreateInput = z.infer<typeof hostCreateSchema>;
export const hostPatchSchema = hostCreateSchema.partial().refine((v) => Object.keys(v).length > 0, {
  message: 'empty patch',
});
export type HostPatchInput = z.infer<typeof hostPatchSchema>;
export const hostListQuerySchema = paginationSchema.extend({
  env: z.enum(HOST_ENVS).optional(),
  status: z.string().optional(),
});
export const batchProbeSchema = z.object({ hostIds: z.array(idSchema).min(1).max(500) });

/* ---------- credentials ---------- */
export const credentialCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(CREDENTIAL_TYPES),
  value: z.string().min(1).max(100_000),
  hostIds: z.array(idSchema).max(500).optional(),
});
export type CredentialCreateInput = z.infer<typeof credentialCreateSchema>;
export const credentialPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    value: z.string().min(1).max(100_000).optional(),
    hostIds: z.array(idSchema).max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty patch' });
export const generatePasswordSchema = z.object({
  length: z.coerce.number().int().min(12).max(64).default(24),
  uppercase: z.boolean().default(true),
  lowercase: z.boolean().default(true),
  digits: z.boolean().default(true),
  symbols: z.boolean().default(true),
});

/* ---------- keypairs ---------- */
export const keypairGenerateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  algorithm: z.enum(KEY_ALGORITHMS),
});
export const keypairImportSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    privateKey: z.string().min(1).max(100_000).optional(),
    publicKey: z.string().min(1).max(100_000).optional(),
    passphrase: z.string().max(500).optional(),
  })
  .refine((v) => !!v.privateKey || !!v.publicKey, { message: 'privateKey or publicKey required' });
export type KeypairImportInput = z.infer<typeof keypairImportSchema>;
export const keypairDeploySchema = z.object({ hostIds: z.array(idSchema).min(1).max(500) });
export const keypairVerifySchema = z.object({ hostIds: z.array(idSchema).max(500).optional() });
export const connectCommandQuerySchema = z.object({ hostId: idSchema.optional() });

/* ---------- tokens / users / audit / settings ---------- */
export const tokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(TOKEN_KINDS).default('user'),
  scopes: z.array(z.enum(SCOPES)).min(1),
  expiresDays: z.coerce.number().int().min(0).max(3650).optional(),
});
export const userInviteSchema = z.object({
  email: emailSchema,
  role: z.enum(ROLES).default('operator'),
});
export const userPatchSchema = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});
export const auditQuerySchema = paginationSchema.extend({
  category: z.string().optional(),
  actor: z.string().optional(),
  success: z.enum(['true', 'false']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export const settingsPatchSchema = z.record(z.string().max(80), z.unknown());

export const setupStatusSchema = z.object({
  installed: z.boolean(),
  locked: z.boolean(),
  version: z.string(),
});

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
