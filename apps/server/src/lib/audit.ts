import type { Kysely } from 'kysely';
import { ulid } from 'ulid';
import type { DatabaseSchema } from '../db/types.js';
import type { AuditCategory } from '@boerfen/shared';

export interface AuditInput {
  actorId?: string | null;
  actorLabel: string;
  actorKind?: 'user' | 'agent' | 'system';
  action: string;
  category?: AuditCategory;
  targetType?: string | null;
  targetId?: string | null;
  detail?: unknown;
  ip?: string | null;
  ua?: string | null;
  success?: boolean;
}

export async function writeAudit(
  db: Kysely<DatabaseSchema>,
  input: AuditInput,
): Promise<string> {
  const id = ulid();
  await db
    .insertInto('audit_logs')
    .values({
      id,
      actor_id: input.actorId ?? null,
      actor_label: input.actorLabel,
      actor_kind: input.actorKind ?? 'user',
      action: input.action,
      target_type: input.category ?? input.targetType ?? null,
      target_id: input.targetId ?? null,
      detail_json: input.detail === undefined ? null : JSON.stringify(input.detail),
      ip: input.ip ?? null,
      ua: input.ua ?? null,
      success: input.success === false ? 0 : 1,
      created_at: new Date().toISOString(),
    })
    .execute();
  return id;
}
