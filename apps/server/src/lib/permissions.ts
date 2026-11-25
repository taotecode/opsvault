import type { FastifyRequest } from 'fastify';
import { SCOPES, type Scope } from '@boerfen/shared';
import { errors } from './errors.js';

export interface AuthedUser {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'operator' | 'viewer';
  status: string;
}

export interface RequestAuth {
  via: 'session' | 'token';
  user: AuthedUser;
  sessionId?: string;
  tokenId?: string;
  tokenKind?: 'user' | 'agent';
  scopes: Scope[];
  revealUntil?: string | null;
  actorLabel: string;
  actorKind: 'user' | 'agent';
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: RequestAuth | null;
  }
  interface FastifyInstance {
    db: import('kysely').Kysely<import('../db/types.js').DatabaseSchema>;
    config: import('../config.js').AppConfig;
    masterKey: Buffer;
  }
}

export function getAuth(req: FastifyRequest): RequestAuth {
  if (req.auth) return req.auth;
  throw errors.unauthorized();
}

export function requireRole(
  req: FastifyRequest,
  roles: Array<'admin' | 'operator' | 'viewer'>,
): RequestAuth {
  const auth = getAuth(req);
  if (!roles.includes(auth.user.role)) throw errors.forbidden(`需要角色：${roles.join(' / ')}`);
  return auth;
}

export function requireAdmin(req: FastifyRequest): RequestAuth {
  return requireRole(req, ['admin']);
}

export function scopeCheck(scope: Scope): (req: FastifyRequest) => RequestAuth {
  return (req) => {
    const auth = getAuth(req);
    if (auth.via === 'token') {
      if (!auth.scopes.includes(scope)) throw errors.forbidden(`令牌缺少 scope：${scope}`);
      return auth;
    }
    if (auth.user.role === 'viewer' && scope.endsWith(':write')) {
      throw errors.forbidden('只读用户不可执行写操作');
    }
    if ((scope.startsWith('users:') || scope.startsWith('settings:')) && scope.endsWith(':write')) {
      if (auth.user.role !== 'admin') throw errors.forbidden('仅管理员可修改用户与设置');
    }
    return auth;
  };
}

export const requireScope = scopeCheck;

export function denyAgent(req: FastifyRequest): void {
  const auth = req.auth;
  if (auth?.via === 'token' && auth.tokenKind === 'agent') {
    throw errors.forbidden('Agent 令牌不可访问该能力');
  }
}

export const ALL_SCOPES = SCOPES;
