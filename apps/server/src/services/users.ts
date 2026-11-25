import type { Kysely } from 'kysely';
import { ulid } from 'ulid';
import type { DatabaseSchema, UsersTable } from '../db/types.js';
import { generatePassword, hashPassword } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';

export interface UserDto {
  id: string;
  username: string;
  email: string;
  role: string;
  status: string;
  totpEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export function userDto(u: UsersTable): UserDto {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    status: u.status,
    totpEnabled: !!u.totp_enabled,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

export async function findUserByEmail(
  db: Kysely<DatabaseSchema>,
  email: string,
): Promise<UsersTable | undefined> {
  return db
    .selectFrom('users')
    .selectAll()
    .where('email', '=', email.toLowerCase())
    .executeTakeFirst();
}

export async function findUserById(
  db: Kysely<DatabaseSchema>,
  id: string,
): Promise<UsersTable | undefined> {
  return db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
}

export async function countUsers(db: Kysely<DatabaseSchema>): Promise<number> {
  const row = await db.selectFrom('users').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
  return Number(row?.n ?? 0);
}

export async function createUser(
  db: Kysely<DatabaseSchema>,
  input: { email: string; password: string; role: string; username?: string },
): Promise<UsersTable> {
  const email = input.email.toLowerCase();
  if (await findUserByEmail(db, email)) throw errors.conflict('该邮箱已存在');
  const now = new Date().toISOString();
  const id = ulid();
  const username = input.username || email.split('@')[0] || 'user';
  const hash = await hashPassword(input.password);
  await db
    .insertInto('users')
    .values({
      id,
      username,
      email,
      password_hash: hash,
      role: input.role,
      totp_secret_enc: null,
      totp_enabled: 0,
      status: 'active',
      created_at: now,
      last_login_at: null,
      last_login_ip: null,
    })
    .execute();
  return findUserById(db, id) as Promise<UsersTable>;
}

export async function listUsers(db: Kysely<DatabaseSchema>): Promise<UserDto[]> {
  const rows = await db.selectFrom('users').selectAll().orderBy('created_at', 'asc').execute();
  return rows.map(userDto);
}

export async function inviteUser(
  db: Kysely<DatabaseSchema>,
  input: { email: string; role: string },
  actor: Actor,
): Promise<{ user: UserDto; temporaryPassword: string }> {
  const temporaryPassword = generatePassword({
    length: 16,
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: true,
  });
  const user = await createUser(db, {
    email: input.email,
    password: temporaryPassword,
    role: input.role,
  });
  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '邀请用户',
    category: 'user',
    targetId: user.id,
    detail: { email: user.email, role: user.role },
    ip: actor.ip,
    ua: actor.ua,
  });
  return { user: userDto(user), temporaryPassword };
}

export async function patchUser(
  db: Kysely<DatabaseSchema>,
  id: string,
  input: { role?: string; status?: 'active' | 'disabled' },
  actor: Actor,
): Promise<UserDto> {
  const user = await findUserById(db, id);
  if (!user) throw errors.notFound('用户');
  const demoting = user.role === 'admin' && (input.role !== undefined && input.role !== 'admin');
  const disabling = user.role === 'admin' && input.status === 'disabled';
  if (demoting || disabling) {
    if (actor.id === id) throw errors.forbidden('不能禁用或降级当前登录账号');
    const otherAdmins = await db
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'admin')
      .where('status', '=', 'active')
      .where('id', '!=', id)
      .execute();
    if (!otherAdmins.length) throw errors.conflict('至少需要保留一名可用的管理员');
  }
  const updates: Record<string, unknown> = {};
  if (input.role) updates.role = input.role;
  if (input.status) updates.status = input.status;
  await db.updateTable('users').set(updates as never).where('id', '=', id).execute();
  if (input.status === 'disabled') {
    await db.deleteFrom('sessions').where('user_id', '=', id).execute();
    await db.deleteFrom('api_tokens').where('user_id', '=', id).execute();
  }
  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '更新用户',
    category: 'user',
    targetId: id,
    detail: { email: user.email, changes: input },
    ip: actor.ip,
    ua: actor.ua,
  });
  return userDto((await findUserById(db, id))!);
}
