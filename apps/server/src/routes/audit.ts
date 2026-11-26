import type { FastifyInstance } from 'fastify';
import { auditQuerySchema } from '@opsvault/shared';
import { denyAgent, getAuth, requireAdmin, requireSession, scopeCheck } from '../lib/permissions.js';
import { parseQuery } from '../lib/validate.js';
import { requireReveal } from '../services/auth.js';
import { writeAudit } from '../lib/audit.js';
import { actorFromRequest } from '../lib/actor.js';

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/audit', async (req) => {
    scopeCheck('audit:read')(req);
    const query = parseQuery(auditQuerySchema, req.query);
    let qb = app.db.selectFrom('audit_logs').selectAll();
    if (query.category) qb = qb.where('target_type', '=', query.category);
    const actorFilter = query.actor;
    if (actorFilter) {
      qb = qb.where((eb) =>
        eb.or([eb('actor_label', 'like', `%${actorFilter}%`), eb('actor_id', '=', actorFilter)]),
      );
    }
    if (query.success) qb = qb.where('success', '=', query.success === 'true' ? 1 : 0);
    if (query.from) qb = qb.where('created_at', '>=', query.from);
    if (query.to) qb = qb.where('created_at', '<=', query.to);
    if (query.q) {
      const like = `%${query.q}%`;
      qb = qb.where((eb) => eb.or([eb('action', 'like', like), eb('target_id', 'like', like), eb('actor_label', 'like', like)]));
    }
    const offset = query.cursor ? Math.max(0, Number(query.cursor) || 0) : 0;
    qb = qb.orderBy('created_at', 'desc').limit(query.limit + 1).offset(offset);
    const rows = await qb.execute();
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit).map((r) => ({
      id: r.id,
      time: r.created_at,
      actor: r.actor_label,
      actorKind: r.actor_kind,
      action: r.action,
      category: r.target_type,
      target: r.target_id,
      detail: r.detail_json ? safeJson(r.detail_json) : null,
      ip: r.ip,
      success: !!r.success,
    }));
    return { data: items, page: { cursor: hasMore ? String(offset + query.limit) : null, hasMore } };
  });

  app.delete('/api/v1/audit', async (req) => {
    denyAgent(req);
    requireSession(req);
    requireAdmin(req);
    requireReveal(getAuth(req));
    const count = await app.db.selectFrom('audit_logs').select('id').execute();
    await app.db.deleteFrom('audit_logs').execute();
    await writeAudit(app.db, {
      ...actorFromRequest(req),
      actorId: req.auth?.user.id ?? null,
      actorLabel: req.auth?.actorLabel ?? 'system',
      actorKind: req.auth?.actorKind ?? 'system',
      action: '清空审计日志',
      category: 'system',
      detail: { deleted: count.length },
    });
    return { data: { ok: true, deleted: count.length } };
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
