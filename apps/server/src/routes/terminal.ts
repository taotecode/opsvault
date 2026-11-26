import type { FastifyInstance } from 'fastify';
import { getHostRow } from '../services/hosts.js';
import { decryptKeypairPrivate, persistHostFingerprint } from '../lib/ssh.js';
import { collectAuthCandidates, openWithFallback } from '../lib/authCandidates.js';
import { writeAudit } from '../lib/audit.js';
import { actorFromRequest } from '../lib/actor.js';
import { denyAgent, getAuth, requireRole } from '../lib/permissions.js';
import { errors } from '../lib/errors.js';

export async function terminalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/hosts/:id/terminal', { websocket: true }, async (socket, req) => {
    try {
      const origin = req.headers.origin;
      if (origin) {
        const expected = new URL(app.config.baseUrl).origin;
        const hostHeader = req.headers.host;
        const hostOrigin = hostHeader ? `${req.protocol}://${hostHeader}` : null;
        if (origin !== expected && origin !== hostOrigin) throw errors.forbidden('WebSocket Origin 不匹配');
      }
      const auth = getAuth(req);
      denyAgent(req);
      requireRole(req, ['admin', 'operator']);
      const { id } = req.params as { id: string };
      const url = new URL(req.raw.url ?? '/', 'http://localhost');
      const credentialId = url.searchParams.get('credentialId') ?? undefined;
      const keypairId = url.searchParams.get('keypairId') ?? undefined;
      const host = await getHostRow(app.db, id);
      const candidates = await collectAuthCandidates(app.db, app.config, host, credentialId);
      if (keypairId) {
        const kp = await app.db.selectFrom('keypairs').selectAll().where('id', '=', keypairId).executeTakeFirst();
        if (kp?.has_private) {
          candidates.unshift({
            ref: `keypair:${kp.id}`,
            kind: 'keypair',
            label: kp.name,
            role: 'explicit',
            auth: { username: host.ssh_user, privateKey: decryptKeypairPrivate(kp, app.config) },
          });
        }
      }
      const opened = await openWithFallback(app.db, host, candidates, host.host_key_fp, async (_current, observed) => {
        await persistHostFingerprint(app.db, host.id, null, observed);
      });
      await writeAudit(app.db, {
        actorId: auth.user.id,
        actorLabel: auth.actorLabel,
        actorKind: auth.actorKind,
        action: '打开终端',
        category: 'asset',
        targetId: host.id,
        detail: { host: host.name, authUsed: opened.candidate.label },
        ip: actorFromRequest(req).ip,
        ua: actorFromRequest(req).ua,
      });
      const client = opened.client;
      let closed = false;
      const finish = async (): Promise<void> => {
        if (closed) return;
        closed = true;
        try {
          client.end();
        } catch {
          /* ignore */
        }
        await writeAudit(app.db, {
          actorId: auth.user.id,
          actorLabel: auth.actorLabel,
          actorKind: auth.actorKind,
          action: '关闭终端',
          category: 'asset',
          targetId: host.id,
          detail: { host: host.name },
          ip: null,
          ua: null,
        });
      };
      client.shell({ term: 'xterm-256color', cols: 100, rows: 30 }, (err, stream) => {
        if (err) {
          socket.send(`\r\n[terminal error] ${err.message}\r\n`);
          socket.close();
          void finish();
          return;
        }
        stream.on('data', (data: Buffer) => {
          if (socket.readyState === 1) socket.send(data.toString('utf8'));
        });
        stream.stderr.on('data', (data: Buffer) => {
          if (socket.readyState === 1) socket.send(data.toString('utf8'));
        });
        stream.on('close', () => {
          if (socket.readyState === 1) socket.close();
          void finish();
        });
        socket.on('message', (raw: Buffer) => {
          const text = raw.toString();
          if (text.startsWith('{')) {
            try {
              const msg = JSON.parse(text) as { type?: string; cols?: number; rows?: number };
              if (msg.type === 'resize' && msg.cols && msg.rows) {
                stream.setWindow(msg.rows, msg.cols, 0, 0);
                return;
              }
            } catch {
              /* treat as input */
            }
          }
          stream.write(text);
        });
        socket.on('close', () => {
          try {
            stream.end();
          } catch {
            /* ignore */
          }
          void finish();
        });
      });
    } catch (err) {
      try {
        socket.send(`\r\n[terminal error] ${(err as Error).message}\r\n`);
      } catch {
        /* ignore */
      }
      socket.close();
    }
  });

  app.get('/api/v1/terminal/health', async (req) => {
    if (!getAuth(req)) throw errors.unauthorized();
    return { data: { ok: true } };
  });
}
