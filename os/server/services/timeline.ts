import 'server-only';
import { and, asc, eq, or } from 'drizzle-orm';
import type { KachmoLead } from '@kachmo/core/leads/schema.js';
import * as schema from '../db/schema/index';
import { getServer } from '../auth/instance';
import { redact } from '../audit/redact';

/**
 * LEAD HISTORY (Phase C, ADR-029) — "what happened with this lead?", answered from the logs that already exist.
 *
 * A read model, never a store: domain events (`analytics_event`), security/audit events (`audit_event`, which names
 * the real person) and the call attempts on the record, merged into one timeline, newest first. Nothing is inferred
 * and nothing is written. Contact values never appear: audit metadata is redacted when it is written, and event
 * payloads carry no contact values by construction — the view redacts again, so an old row can't leak one either.
 */

export interface TimelineEntry {
  at: string;
  source: 'EVENT' | 'AUDIT' | 'CALL';
  /** A short machine name, e.g. CALL_ATTEMPTED or lead.research_recorded. */
  kind: string;
  /** Who: the engine actor for domain events, the named person for audit events. */
  actor: string;
  /** Plain facts from the entry, as `key: value` strings. */
  details: string[];
}

const flat = (value: unknown, depth = 0): string[] => {
  if (value === null || value === undefined || depth > 2) return [];
  if (typeof value !== 'object') return [String(value)];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 160) : String(v).slice(0, 160)}`);
};

export async function getLeadTimeline(lead: KachmoLead, limit = 200): Promise<TimelineEntry[]> {
  const { db } = getServer();
  const events = await db
    .select()
    .from(schema.analyticsEvent)
    .where(or(eq(schema.analyticsEvent.leadId, lead.lead_id), eq(schema.analyticsEvent.targetNumber, lead.target_number)))
    .orderBy(asc(schema.analyticsEvent.sequence));
  const audits = await db
    .select()
    .from(schema.auditEvent)
    .where(and(eq(schema.auditEvent.targetType, 'lead'), eq(schema.auditEvent.targetId, lead.lead_id)))
    .orderBy(asc(schema.auditEvent.occurredAt));

  const entries: TimelineEntry[] = [
    ...events.map(e => ({ at: e.occurredAt, source: 'EVENT' as const, kind: e.eventType, actor: e.actor, details: flat(redact(e.payload)) })),
    ...audits.map(a => ({ at: a.occurredAt.toISOString(), source: 'AUDIT' as const, kind: a.action, actor: a.actorLabel, details: flat(redact(a.metadata)) })),
    // A call logged through the write path is also a CALL_ATTEMPTED / CALL_CONNECTED event at the same instant;
    // the record's own call history is shown only for attempts no event describes (e.g. from before cutover).
    ...(lead.call_attempts ?? []).filter(c => !events.some(e => e.occurredAt === c.at && /^CALL_/.test(e.eventType))).map(c => ({
      at: c.at,
      source: 'CALL' as const,
      kind: `CALL ${c.outcome}`,
      actor: c.by,
      details: flat(redact({ outcome: c.outcome, objection_category: c.objection_category ?? null })),
    })),
  ];
  return entries.sort((a, b) => b.at.localeCompare(a.at) || a.source.localeCompare(b.source)).slice(0, limit);
}
