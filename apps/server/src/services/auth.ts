import type { Kysely } from 'kysely';
import { ulid } from 'ulid';
import type { AppConfig } from '../config.js';
import type { DatabaseSchema, SessionsTable, UsersTable } from '../db/types.js';
import {
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  getMasterKey,
  hashPassword,
  randomToken,
  sha256Hex,
  totpUri,
  verifyPassword,
  verifyTotpCode,
} from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import { findUserByEmail, findUserById, userDto, type UserDto } from './users.js';
import { writeAudit } from '../lib/audit.js';
import type { Actor } from '../lib/actor.js';
import type { RequestAuth } from '../lib/permissions.js';

const totpEnvelope = (usersRow: UsersTable, config: AppConfig): string | null => {
  if (!usersRow.totp_secret_enc) return null;
  try {
    const env = JSON.parse(usersRow.totp_secret_enc) as {
      encryptedDek: string;
      encryptedValue: string;
      dekIv: string;
      dekTag: string;
      valueIv: string;
      valueTag: string;
    };
    return decryptSecret(env, getMasterKey(config));
  } catch {
    return null;
  }
};

export interface LoginResult {
  user: UserDto;
  sessionToken: string;
  csrfToken: string;
  expiresAt: string;
}

export async function login(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  input: { email: string; password: string; totp?: string },
  meta: { ip: string | null; ua: string | null },
): Promise<LoginResult> {
  const user = await findUserByEmail(db, input.email);
  const fail = async (reason: string): Promise<never> => {
    await writeAudit(db, {
      actorId: user?.id ?? null,
      actorLabel: user?.username ?? input.email,
      actorKind: 'user',
      action: '登录失败',
      category: 'auth',
      detail: { reason },
      ip: meta.ip,
      ua: meta.ua,
      success: false,
    });
    throw errors.unauthorized('邮箱或密码不正确');
  };
  if (!user) return fail('user_not_found');
  if (user.status !== 'active') {
    throw errors.forbidden('账号已被禁用');
  }
  const ok = await verifyPassword(user.password_hash, input.password);
  if (!ok) return fail('bad_password');
  if (user.totp_enabled) {
    if (!input.totp) {
      throw errors.forbidden('该账号已启用二次验证', '需要 TOTP 动态口令');
    }
    const secret = totpEnvelope(user, config);
    if (!secret || !verifyTotpCode(secret, input.totp)) return fail('bad_totp');
  }
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + config.sessionDays * 24 * 3600 * 1000).toISOString();
  const sessionToken = randomToken(32);
  const csrfToken = randomToken(24);
  await db
    .insertInto('sessions')
    .values({
      id: ulid(),
      user_id: user.id,
      token_hash: sha256Hex(sessionToken),
      csrf_token: csrfToken,
      reveal_until: null,
      ip: meta.ip,
      ua: meta.ua,
      expires_at: expires,
      created_at: now,
    })
    .execute();
  await db
    .updateTable('users')
    .set({ last_login_at: now, last_login_ip: meta.ip })
    .where('id', '=', user.id)
    .execute();
  await writeAudit(db, {
    actorId: user.id,
    actorLabel: user.username,
    actorKind: 'user',
    action: '登录成功',
    category: 'auth',
    ip: meta.ip,
    ua: meta.ua,
  });
  return { user: userDto(user), sessionToken, csrfToken, expiresAt: expires };
}

export async function logout(
  db: Kysely<DatabaseSchema>,
  auth: RequestAuth,
  actor: Actor,
): Promise<void> {
  if (auth.sessionId) {
    await db.deleteFrom('sessions').where('id', '=', auth.sessionId).execute();
  }
  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '退出登录',
    category: 'auth',
    ip: actor.ip,
    ua: actor.ua,
  });
}

export async function me(
  db: Kysely<DatabaseSchema>,
  auth: RequestAuth,
): Promise<UserDto> {
  const user = await findUserById(db, auth.user.id);
  if (!user) throw errors.unauthorized('账号不存在');
  return userDto(user);
}

export async function startReveal(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  auth: RequestAuth,
  password: string,
): Promise<{ revealUntil: string }> {
  if (auth.via !== 'session' || !auth.sessionId) {
    throw errors.forbidden('敏感操作仅支持登录会话，不支持 API/Agent 令牌');
  }
  const user = await findUserById(db, auth.user.id);
  if (!user) throw errors.unauthorized();
  const ok = await verifyPassword(user.password_hash, password);
  if (!ok) throw errors.forbidden('密码不正确');
  const revealUntil = new Date(Date.now() + config.revealWindowMinutes * 60_000).toISOString();
  await db
    .updateTable('sessions')
    .set({ reveal_until: revealUntil })
    .where('id', '=', auth.sessionId)
    .execute();
  await writeAudit(db, {
    actorId: user.id,
    actorLabel: user.username,
    actorKind: 'user',
    action: '二次验证成功',
    category: 'auth',
    ip: auth.sessionId ? null : null,
  });
  return { revealUntil };
}

export function requireReveal(auth: RequestAuth): void {
  if (auth.via !== 'session') throw errors.forbidden('敏感操作仅支持登录会话');
  if (!auth.revealUntil || new Date(auth.revealUntil) <= new Date()) {
    throw errors.forbidden('需要先完成二次验证', '请在 5 分钟内通过 /api/v1/auth/reveal 验证密码');
  }
}

export async function beginTotpSetup(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  auth: RequestAuth,
): Promise<{ secret: string; uri: string }> {
  if (auth.via !== 'session') throw errors.forbidden('仅登录会话可绑定 TOTP');
  const secret = generateTotpSecret();
  const envelope = JSON.stringify(encryptSecret(secret, getMasterKey(config)));
  await db
    .updateTable('users')
    .set({ totp_secret_enc: envelope, totp_enabled: 0 })
    .where('id', '=', auth.user.id)
    .execute();
  return { secret, uri: totpUri(secret, auth.user.email) };
}

export async function confirmTotp(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  auth: RequestAuth,
  code: string,
): Promise<void> {
  const user = await findUserById(db, auth.user.id);
  if (!user || !user.totp_secret_enc) throw errors.conflict('尚未开始 TOTP 绑定');
  const secret = totpEnvelope(user, config);
  if (!secret || !verifyTotpCode(secret, code)) throw errors.forbidden('动态口令不正确');
  await db.updateTable('users').set({ totp_enabled: 1 }).where('id', '=', user.id).execute();
  await writeAudit(db, {
    actorId: user.id,
    actorLabel: user.username,
    actorKind: 'user',
    action: '启用 TOTP',
    category: 'auth',
    ip: null,
  });
}

export async function disableTotp(
  db: Kysely<DatabaseSchema>,
  auth: RequestAuth,
): Promise<void> {
  await db
    .updateTable('users')
    .set({ totp_enabled: 0, totp_secret_enc: null })
    .where('id', '=', auth.user.id)
    .execute();
}

export async function changePassword(
  db: Kysely<DatabaseSchema>,
  auth: RequestAuth,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const user = await findUserById(db, auth.user.id);
  if (!user) throw errors.unauthorized();
  const ok = await verifyPassword(user.password_hash, input.currentPassword);
  if (!ok) throw errors.forbidden('当前密码不正确');
  await db
    .updateTable('users')
    .set({ password_hash: await hashPassword(input.newPassword) })
    .where('id', '=', user.id)
    .execute();
  await writeAudit(db, {
    actorId: user.id,
    actorLabel: user.username,
    actorKind: 'user',
    action: '修改密码',
    category: 'auth',
    ip: null,
  });
}

export async function sessionCookieValue(sessionToken: string): Promise<string> {
  return sessionToken;
}

export type SessionRow = SessionsTable;
