import type { Kysely } from 'kysely';
import { ulid } from 'ulid';
import type { Scope } from '@boerfen/shared';
import type { DatabaseSchema } from '../db/types.js';
import { newApiToken } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import type { Actor } from '../lib/actor.js';

export interface TokenDto {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  kind: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

const AGENT_ALLOWED_SCOPES: Scope[] = [
  'hosts:read',
  'hosts:write',
  'credentials:read',
  'keypairs:read',
  'audit:read',
  'system:read',
];

function tokenDto(row: {
  id: string;
  name: string;
  prefix: string;
  scopes_json: string;
  kind: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}): TokenDto {
  let scopes: Scope[];
  try {
    scopes = JSON.parse(row.scopes_json) as Scope[];
  } catch {
    scopes = [];
  }
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes,
    kind: row.kind,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

export async function listTokens(db: Kysely<DatabaseSchema>): Promise<TokenDto[]> {
  const rows = await db.selectFrom('api_tokens').selectAll().orderBy('created_at', 'desc').execute();
  return rows.map(tokenDto);
}

export async function createToken(
  db: Kysely<DatabaseSchema>,
  actor: Actor,
  input: { name: string; kind: 'user' | 'agent'; scopes: Scope[]; expiresDays?: number },
): Promise<{ token: string; dto: TokenDto }> {
  if (input.kind === 'agent') {
    const allowed = input.scopes.filter((s) => AGENT_ALLOWED_SCOPES.includes(s));
    if (allowed.length !== input.scopes.length) {
      throw errors.validation(
        input.scopes.filter((s) => !AGENT_ALLOWED_SCOPES.includes(s)),
        'Agent 令牌不允许 users/settings/credentials:write 等权限',
      );
    }
  }
  const generated = newApiToken();
  const now = new Date().toISOString();
  const expiresAt = input.expiresDays
    ? new Date(Date.now() + input.expiresDays * 86400_000).toISOString()
    : null;
  const id = ulid();
  await db
    .insertInto('api_tokens')
    .values({
      id,
      user_id: actor.id ?? '',
      name: input.name,
      prefix: generated.prefix,
      token_hash: generated.hash,
      scopes_json: JSON.stringify(input.scopes),
      kind: input.kind,
      expires_at: expiresAt,
      last_used_at: null,
      created_at: now,
    })
    .execute();
  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '创建 API 令牌',
    category: 'api',
    targetId: id,
    detail: { name: input.name, kind: input.kind, scopes: input.scopes },
    ip: actor.ip,
    ua: actor.ua,
  });
  const row = await db.selectFrom('api_tokens').selectAll().where('id', '=', id).executeTakeFirst();
  return { token: generated.token, dto: tokenDto(row!) };
}

export async function deleteToken(
  db: Kysely<DatabaseSchema>,
  id: string,
  actor: Actor,
): Promise<void> {
  const row = await db.selectFrom('api_tokens').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw errors.notFound('令牌');
  await db.deleteFrom('api_tokens').where('id', '=', id).execute();
  await writeAudit(db, {
    actorId: actor.id,
    actorLabel: actor.label,
    actorKind: actor.kind,
    action: '吊销 API 令牌',
    category: 'api',
    targetId: id,
    detail: { name: row.name },
    ip: actor.ip,
    ua: actor.ua,
  });
}
