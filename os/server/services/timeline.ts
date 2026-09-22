import 'server-only';
import { and, asc, eq, or } from 'drizzle-orm';
import type { KachmoLead } from '@kachmo/core/leads/schema.js';
import type { TrackerRow } from '@kachmo/core/email-ledger/tracker.js';
import * as schema from '../db/schema/index';
import { getServer } from '../auth/instance';
import { redact } from '../audit/redact';
import { CALL_OUTCOME_CHOICES, RESEARCH_CHOICES, RESEARCH_STATE_LABELS, STAGE_CHOICES, WHATSAPP_CHOICES, emailDates, eventLabel, isSystemEvent } from './operator';

/**
 * LEAD HISTORY (Phase C, ADR-029) — "what happened with this lead?", answered from the logs that already exist.
 *
 * A read model, never a store: domain events (`analytics_event`), security/audit events (`audit_event`, which names
 * the real person), the call attempts on the record, and — since the operator redesign (ADR-035) — the company's row in
 * Titan's email records, which is where the most important history (the email that was sent) actually lives. Merged
 * into one timeline, newest first. Nothing is inferred and nothing is written.
 *
 * Contact values never appear: audit metadata is redacted when it is written, and event payloads carry no contact
 * values by construction — the view redacts again, so an old row can't leak one either.
 */

export interface TimelineEntry {
  at: string;
  source: 'EVENT' | 'AUDIT' | 'CALL' | 'EMAIL';
  /** A short machine name, e.g. CALL_ATTEMPTED or lead.research_recorded. */
  kind: string;
  /** Who: the engine actor for domain events (DEV/AADI/SYSTEM — render with `actorName`), the named person for audit events. */
  actor: string;
  /** Plain facts from the entry, as `key: value` strings (the technical view). */
  details: string[];
  /** What happened, in operator words. */
  title: string;
  /** One sentence of detail in operator words, when there is something useful to say. */
  summary: string | null;
  /** Engine re-scoring and audit echoes: shown only on request. */
  system: boolean;
}

const flat = (value: unknown, depth = 0): string[] => {
  if (value === null || value === undefined || depth > 2) return [];
  if (typeof value !== 'object') return [String(value)];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 160) : String(v).slice(0, 160)}`);
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** One sentence for an entry, from its (already redacted) payload or metadata. Null when the title says it all. */
function summarize(kind: string, data: Record<string, unknown>): string | null {
  switch (kind) {
    case 'QUALIFICATION_CHANGED': {
      const from = str(data.from) as keyof typeof RESEARCH_STATE_LABELS | null;
      const to = str(data.to) as keyof typeof RESEARCH_STATE_LABELS | null;
      return from && to ? `${RESEARCH_STATE_LABELS[from] ?? from} → ${RESEARCH_STATE_LABELS[to] ?? to}` : null;
    }
    case 'CALL_ATTEMPTED':
    case 'lead.call_logged': {
      const o = str(data.outcome);
      return o ? (CALL_OUTCOME_CHOICES[o]?.label ?? o.toLowerCase().replace(/_/g, ' ')) : null;
    }
    case 'lead.whatsapp_transitioned':
    case 'WHATSAPP_APPROVED':
    case 'WHATSAPP_REJECTED':
    case 'WHATSAPP_SENT': {
      const s = str(data.status);
      return s ? (WHATSAPP_CHOICES[s]?.label ?? null) : null;
    }
    case 'lead.pipeline_transitioned': {
      const s = str(data.stage);
      const c = str(data.channel);
      return s ? `${STAGE_CHOICES[s]?.label ?? s.toLowerCase().replace(/_/g, ' ')}${c ? ` (${c.toLowerCase()})` : ''}` : null;
    }
    case 'lead.research_recorded':
    case 'RESEARCH_RECORDED': {
      const f = str(data.field);
      const sourced = data.hasSource === true || data.has_source === true;
      return f ? `${RESEARCH_CHOICES[f]?.label ?? f}${sourced ? ', with a source' : ''}` : null;
    }
    case 'suppression.created':
      return str(data.reason);
    case 'FOLLOW_UP_SCHEDULED':
      return str(data.action) ? `${data.action}${str(data.date) ? ` on ${data.date}` : ''}` : null;
    case 'ledger.historical_send_reconciled':
    case 'ledger.external_send_recorded':
      return 'Sent by hand from the studio webmail; the email records were corrected afterwards.';
    default:
      return null;
  }
}

/** The company's row in the email records, as history. The ledger holds dates, not times. */
function ledgerEntries(row: TrackerRow | null | undefined, lead: KachmoLead, today: string): TimelineEntry[] {
  if (!row) return [];
  const d = emailDates(row, today);
  const base = { source: 'EMAIL' as const, actor: 'Studio inbox', details: [`email records: ${row.status}`, ...(row.batch ? [`batch: ${row.batch}`] : [])], system: false };
  const out: TimelineEntry[] = [];
  if (d.kind === 'SENT' && d.date) {
    out.push({ ...base, at: d.date, kind: 'EMAIL_SENT', title: eventLabel('EMAIL_SENT'), summary: d.followUpDue ? `One follow-up allowed, due ${d.followUpDue}.` : null });
  }
  if (row.status === 'FOLLOWED_UP' || lead.email_follow_up_sent_at) {
    const at = lead.email_follow_up_sent_at ?? d.followUpDue ?? d.date;
    if (at) out.push({ ...base, at, kind: 'EMAIL_FOLLOWED_UP', title: eventLabel('EMAIL_FOLLOWED_UP'), summary: 'The one follow-up. No more emails.' });
  }
  if (d.kind === 'PLANNED' && d.date) {
    const kind = row.status === 'DRAFTED' ? 'EMAIL_DRAFTED' : 'EMAIL_SCHEDULED';
    out.push({ ...base, at: d.date, kind, title: eventLabel(kind), summary: d.late ? `Planned for this day — not sent yet (${d.lateDays} day${d.lateDays === 1 ? '' : 's'} late).` : 'Planned for this day.' });
  }
  return out;
}

export async function getLeadTimeline(lead: KachmoLead, limit = 200, opts: { ledger?: TrackerRow | null; today?: string } = {}): Promise<TimelineEntry[]> {
  const { db } = getServer();
  const today = opts.today ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
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
    ...events.map(e => {
      const payload = redact(e.payload) as Record<string, unknown>;
      return { at: e.occurredAt, source: 'EVENT' as const, kind: e.eventType, actor: e.actor, details: flat(payload), title: eventLabel(e.eventType), summary: summarize(e.eventType, payload ?? {}), system: isSystemEvent(e.eventType) };
    }),
    ...audits.map(a => {
      const meta = redact(a.metadata) as Record<string, unknown>;
      return { at: a.occurredAt.toISOString(), source: 'AUDIT' as const, kind: a.action, actor: a.actorLabel, details: flat(meta), title: eventLabel(a.action), summary: summarize(a.action, meta ?? {}), system: isSystemEvent(a.action) };
    }),
    // A call logged through the write path is also a CALL_ATTEMPTED / CALL_CONNECTED event at the same instant;
    // the record's own call history is shown only for attempts no event describes (e.g. from before cutover).
    ...(lead.call_attempts ?? []).filter(c => !events.some(e => e.occurredAt === c.at && /^CALL_/.test(e.eventType))).map(c => ({
      at: c.at,
      source: 'CALL' as const,
      kind: `CALL ${c.outcome}`,
      actor: c.by,
      details: flat(redact({ outcome: c.outcome, objection_category: c.objection_category ?? null })),
      title: 'Call',
      summary: CALL_OUTCOME_CHOICES[c.outcome]?.label ?? null,
      system: false,
    })),
    ...ledgerEntries(opts.ledger, lead, today),
  ];
  return entries.sort((a, b) => b.at.localeCompare(a.at) || a.source.localeCompare(b.source)).slice(0, limit);
}
