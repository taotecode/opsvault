import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import fastifyApiReference from '@scalar/fastify-api-reference';
import type { Kysely } from 'kysely';
import { APP_VERSION } from '@boerfen/shared';
import type { AppConfig } from './config.js';
import type { DatabaseSchema } from './db/types.js';
import { authPlugin } from './auth/plugin.js';
import { sendError } from './lib/errors.js';
import { repoRoot } from './routes/meta.js';
import { isInstalled } from './services/setup.js';
import { authRoutes } from './routes/auth.js';
import { setupRoutes } from './routes/setup.js';
import { hostRoutes } from './routes/hosts.js';
import { credentialRoutes } from './routes/credentials.js';
import { keypairRoutes } from './routes/keypairs.js';
import { tokenRoutes } from './routes/tokens.js';
import { userRoutes } from './routes/users.js';
import { auditRoutes } from './routes/audit.js';
import { settingsRoutes } from './routes/settings.js';
import { systemRoutes } from './routes/system.js';
import { metaRoutes } from './routes/meta.js';
import { terminalRoutes } from './routes/terminal.js';
import { mcpRoutes } from './mcp/routes.js';

export interface BuildAppOptions {
  config: AppConfig;
  db: Kysely<DatabaseSchema>;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, db } = options;
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.privateKey',
                'req.body.value',
                'req.body.token',
                '*.password',
                '*.privateKey',
                '*.value',
                '*.token',
                '*.secret',
              ],
              censor: '[REDACTED]',
            },
          },
    trustProxy: config.trustProxy,
    bodyLimit: 1_048_576,
  });

  app.decorate('config', config);
  app.decorate('dbState', { current: db });
  Object.defineProperty(app, 'db', {
    configurable: true,
    enumerable: false,
    get() {
      return (app as unknown as { dbState: { current: Kysely<DatabaseSchema> } }).dbState.current;
    },
  });

  await app.register(cookie, {});
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  });
  await app.register(websocket);
  await authPlugin(app);

  app.setErrorHandler((err, _req, reply) => {
    if ((err as { statusCode?: number }).statusCode === 429) {
      reply.status(429).send({
        error: { code: 'RATE_LIMITED', message: '请求过于频繁', hint: '稍后再试' },
      });
      return;
    }
    sendError(reply, err);
  });

  await app.register(authRoutes);
  await app.register(setupRoutes);
  await app.register(hostRoutes);
  await app.register(credentialRoutes);
  await app.register(keypairRoutes);
  await app.register(tokenRoutes);
  await app.register(userRoutes);
  await app.register(auditRoutes);
  await app.register(settingsRoutes);
  await app.register(systemRoutes);
  await app.register(metaRoutes);
  await app.register(terminalRoutes);
  await app.register(mcpRoutes);

  try {
    await app.register(fastifyApiReference, {
      routePrefix: '/api/docs',
      configuration: {
        sources: [{ url: '/api/v1/openapi.json', title: 'Boerfen Assets API' }],
      },
    });
  } catch (e) {
    app.log.warn({ err: e }, 'Scalar API reference registration failed');
  }

  const webDist = path.resolve(repoRoot, 'apps/web/dist');
  const hasWeb = fs.existsSync(path.join(webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: true });
  }

  app.setNotFoundHandler(async (req, reply) => {
    const url = req.raw.url || '';
    const pathname = url.split('?')[0] ?? '';
    if (url.startsWith('/api/') || url.startsWith('/mcp')) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
      return;
    }
    if (pathname === '/setup' || pathname.startsWith('/setup/')) {
      const state = await isInstalled(app.db, app.config);
      if (state.installed) {
        reply.status(404).type('text/plain').send('Not Found');
        return;
      }
    }
    if (req.method !== 'GET') {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: '资源不存在' } });
      return;
    }
    if (hasWeb) {
      reply.type('text/html; charset=utf-8').send(fs.readFileSync(path.join(webDist, 'index.html'), 'utf8'));
      return;
    }
    reply
      .type('text/plain')
      .send(`Boerfen Assets server v${APP_VERSION} is running. Web UI not built yet.`);
  });

  return app;
}
