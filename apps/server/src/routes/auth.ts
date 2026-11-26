import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  changePasswordSchema,
  loginSchema,
  revealSchema,
  totpEnableSchema,
} from '@opsvault/shared';
import {
  beginTotpSetup,
  changePassword,
  confirmTotp,
  disableTotp,
  login,
  logout,
  me,
  requireReveal,
  startReveal,
} from '../services/auth.js';
import { actorFromRequest, systemActor } from '../lib/actor.js';
import { getAuth } from '../lib/permissions.js';
import { parseBody } from '../lib/validate.js';
import type { LoginResult } from '../services/auth.js';
import type { AppConfig } from '../config.js';

function setAuthCookies(reply: FastifyReply, config: AppConfig, result: LoginResult): void {
  const secure = config.baseUrl.startsWith('https');
  const maxAge = Math.round(config.sessionDays * 24 * 3600);
  reply.setCookie('ov_session', result.sessionToken, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge,
  });
  reply.setCookie('ov_csrf', result.csrfToken, {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure,
    maxAge,
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/auth/login', {
    config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(loginSchema, req.body);
    const result = await login(app.db, app.config, body, {
      ip: req.ip ?? null,
      ua: (req.headers['user-agent'] as string | undefined) ?? null,
    });
    setAuthCookies(reply, app.config, result);
    return { data: { user: result.user, csrfToken: result.csrfToken, expiresAt: result.expiresAt } };
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const auth = getAuth(req);
    await logout(app.db, auth, actorFromRequest(req));
    reply.clearCookie('ov_session', { path: '/' });
    reply.clearCookie('ov_csrf', { path: '/' });
    return { data: { ok: true } };
  });

  app.get('/api/v1/auth/me', async (req) => {
    const auth = getAuth(req);
    const user = await me(app.db, auth);
    return { data: { user, via: auth.via, revealUntil: auth.revealUntil ?? null } };
  });

  app.post('/api/v1/auth/reveal', async (req) => {
    const auth = getAuth(req);
    const body = parseBody(revealSchema, req.body);
    const result = await startReveal(app.db, app.config, auth, body.password);
    return { data: result };
  });

  app.post('/api/v1/auth/password', async (req) => {
    const auth = getAuth(req);
    const body = parseBody(changePasswordSchema, req.body);
    await changePassword(app.db, auth, body);
    return { data: { ok: true } };
  });

  app.post('/api/v1/auth/totp/setup', async (req) => {
    const auth = getAuth(req);
    const result = await beginTotpSetup(app.db, app.config, auth);
    return { data: result };
  });

  app.post('/api/v1/auth/totp/enable', async (req) => {
    const auth = getAuth(req);
    const body = parseBody(totpEnableSchema, req.body);
    await confirmTotp(app.db, app.config, auth, body.code);
    return { data: { ok: true } };
  });

  app.post('/api/v1/auth/totp/disable', async (req) => {
    const auth = getAuth(req);
    await disableTotp(app.db, auth);
    return { data: { ok: true } };
  });

  app.get('/api/v1/auth/reveal-window', async (req) => {
    const auth = getAuth(req);
    requireReveal(auth);
    return { data: { revealUntil: auth.revealUntil } };
  });

  app.post('/api/v1/auth/system-reset', async () => {
    // 仅占位：禁止 Web 端重置安装
    throw (await import('../lib/errors.js')).errors.forbidden('该操作仅支持 CLI');
  });

  void systemActor;
}
