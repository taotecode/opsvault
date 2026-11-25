import type { FastifyInstance } from 'fastify';
import { sha256Hex } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import type { RequestAuth } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';
import type { Scope } from '@boerfen/shared';

/**
 * 认证插件：
 * - Bearer wfv_… → API 令牌（哈希校验、scope、last_used）
 * - bf_session Cookie → 浏览器会话（写请求要求 x-csrf-token 与 bf_csrf Cookie 一致）
 * - 安装完成前 /setup 相关路径由 setup 路由自行处理
 */
export async function authPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      const token = header.slice('Bearer '.length).trim();
      if (!token.startsWith('wfv_')) throw errors.unauthorized('无效令牌');
      const row = await app.db
        .selectFrom('api_tokens')
        .innerJoin('users', 'users.id', 'api_tokens.user_id')
        .select([
          'api_tokens.id as token_id',
          'api_tokens.token_hash',
          'api_tokens.scopes_json',
          'api_tokens.kind',
          'api_tokens.expires_at',
          'users.id as user_id',
          'users.username',
          'users.email',
          'users.role',
          'users.status',
          'api_tokens.name as token_name',
        ])
        .where('api_tokens.token_hash', '=', sha256Hex(token))
        .executeTakeFirst();
      if (!row) throw errors.unauthorized('令牌不存在或已吊销');
      if (row.expires_at && new Date(row.expires_at) < new Date()) throw errors.unauthorized('令牌已过期');
      if (row.status !== 'active') throw errors.unauthorized('账号已被禁用');
      let scopes: Scope[];
      try {
        scopes = JSON.parse(row.scopes_json) as Scope[];
      } catch {
        scopes = [];
      }
      await app.db
        .updateTable('api_tokens')
        .set({ last_used_at: new Date().toISOString() })
        .where('id', '=', row.token_id)
        .execute();
      const auth: RequestAuth = {
        via: 'token',
        user: {
          id: row.user_id,
          username: row.username,
          email: row.email,
          role: row.role as RequestAuth['user']['role'],
          status: row.status,
        },
        tokenId: row.token_id,
        tokenKind: row.kind as 'user' | 'agent',
        scopes,
        actorLabel:
          row.kind === 'agent' ? `${row.token_name}（Agent）` : `${row.username}（API）`,
        actorKind: row.kind === 'agent' ? 'agent' : 'user',
      };
      req.auth = auth;
      return;
    }

    const cookieToken = req.cookies?.bf_session;
    if (cookieToken) {
      const row = await app.db
        .selectFrom('sessions')
        .innerJoin('users', 'users.id', 'sessions.user_id')
        .select([
          'sessions.id as session_id',
          'sessions.csrf_token',
          'sessions.reveal_until',
          'sessions.expires_at',
          'users.id as user_id',
          'users.username',
          'users.email',
          'users.role',
          'users.status',
        ])
        .where('sessions.token_hash', '=', sha256Hex(cookieToken))
        .executeTakeFirst();
      if (!row) return;
      if (new Date(row.expires_at) < new Date()) return;
      if (row.status !== 'active') return;
      const auth: RequestAuth = {
        via: 'session',
        user: {
          id: row.user_id,
          username: row.username,
          email: row.email,
          role: row.role as RequestAuth['user']['role'],
          status: row.status,
        },
        sessionId: row.session_id,
        scopes: [],
        revealUntil: row.reveal_until,
        actorLabel: row.username,
        actorKind: 'user',
      };
      req.auth = auth;

      const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (unsafe) {
        const csrfHeader = req.headers['x-csrf-token'];
        const csrfCookie = req.cookies?.bf_csrf;
        if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie || csrfHeader !== row.csrf_token) {
          throw errors.csrf();
        }
      }
    }
  });
  app.addHook('onResponse', async (req, reply) => {
    const auth = req.auth;
    if (auth?.via !== 'token' || auth.tokenKind !== 'agent') return;
    try {
      await writeAudit(app.db, {
        actorId: auth.user.id,
        actorLabel: auth.actorLabel,
        actorKind: 'agent',
        action: 'Agent 调用',
        category: 'api',
        detail: {
          method: req.method,
          path: (req.raw.url ?? '').split('?')[0],
          status: reply.statusCode,
        },
        ip: req.ip ?? null,
        ua: (req.headers['user-agent'] as string | undefined) ?? null,
        success: reply.statusCode < 400,
      });
    } catch {
      req.log.warn({ url: req.raw.url }, 'agent audit write failed');
    }
  });
}
