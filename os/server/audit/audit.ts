import { createHmac } from 'node:crypto';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema/index';
import { redact, AUDIT_ACTION } from './redact';

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface AuditInput {
  /** `userId` null only for system processes (migration, bootstrap); `label` is always required. */
  actor: { userId: string | null; label: string };
  action: string;
  target: { type: string; id?: string | null };
  metadata?: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
  ipHash?: string | null;
}

export class AuditInputError extends Error {}

/**
 * Appends one audit event. The table is append-only at the database level, so this is the only audit write path.
 * Metadata, before and after are redacted: contact values and secrets are never stored.
 */
export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  if (!AUDIT_ACTION.test(input.action)) throw new AuditInputError(`Invalid audit action "${input.action}" (expected e.g. lead.approve).`);
  if (!input.actor.label?.trim()) throw new AuditInputError('Audit events need an actor label.');
  if (!input.target.type?.trim()) throw new AuditInputError('Audit events need a target type.');
  await db.insert(schema.auditEvent).values({
    actorUserId: input.actor.userId,
    actorLabel: input.actor.label,
    action: input.action,
    targetType: input.target.type,
    targetId: input.target.id ?? null,
    requestId: input.requestId ?? null,
    ipHash: input.ipHash ?? null,
    metadata: redact(input.metadata ?? {}) as Record<string, unknown>,
    before: input.before === undefined ? null : redact(input.before),
    after: input.after === undefined ? null : redact(input.after),
  });
}

/** Keyed hash of an IP address, so abuse can be correlated without storing the address itself. */
export function hashIp(ip: string | null | undefined, secret: string): string | null {
  return ip ? createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32) : null;
}
