import type { FastifyRequest } from 'fastify';
import type { RequestAuth } from './permissions.js';

export interface Actor {
  id: string | null;
  label: string;
  kind: 'user' | 'agent' | 'system';
  ip: string | null;
  ua: string | null;
}

export function actorFromRequest(req: FastifyRequest): Actor {
  const auth: RequestAuth | null = req.auth;
  return {
    id: auth?.user.id ?? null,
    label: auth?.actorLabel ?? 'system',
    kind: auth?.actorKind ?? 'system',
    ip: req.ip ?? null,
    ua: (req.headers['user-agent'] as string | undefined) ?? null,
  };
}

export const systemActor = (label = 'system'): Actor => ({
  id: null,
  label,
  kind: 'system',
  ip: null,
  ua: null,
});
