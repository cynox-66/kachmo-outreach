import type { KachmoLead, SuppressionEntry, AnalyticsEvent } from '../../../../core/leads/schema.js';
import { canonicalSha256 } from './canonical';

/**
 * Pure mapping from canonical records to table rows. The lead row's typed columns are projections of `record`;
 * `leadProjection` is also used by reconciliation to prove the stored projections still equal the stored record.
 */
export function leadProjection(l: KachmoLead) {
  return {
    leadId: l.lead_id,
    targetNumber: l.target_number,
    companyName: l.company_name,
    websiteUrl: l.website_url,
    archetypeId: l.archetype_id,
    locationCountry: l.location_country,
    researchState: l.research_state,
    leadPriority: l.lead_priority ?? null,
    priorityConfidence: l.priority_confidence ?? null,
    researchCompletenessScore: l.research_completeness_score,
    kachmoScore: l.kachmo_score ?? null,
    phoneStatus: l.phone_status,
    emailStatus: l.email_status,
    doNotContact: l.do_not_contact === true,
    owner: l.owner ?? null,
    nextActionDate: l.next_action_date ?? null,
    recordCreatedAt: l.created_at,
    recordUpdatedAt: l.updated_at,
  };
}

export function leadRow(l: KachmoLead) {
  return { ...leadProjection(l), record: l, recordSha256: canonicalSha256(l), version: 1 };
}

export function suppressionRow(e: SuppressionEntry, index: number) {
  return {
    sequence: index + 1,
    leadId: e.lead_id ?? null,
    targetNumber: e.target_number ?? null,
    companyName: e.company_name ?? null,
    email: e.email ?? null,
    phone: e.phone ?? null,
    domain: e.domain ?? null,
    reason: e.reason,
    suppressedAt: e.suppressed_at,
    source: e.source,
  };
}

/** Inverse of suppressionRow, for reconciliation (optional keys that were absent stay absent). */
export function suppressionEntryFromRow(r: ReturnType<typeof suppressionRow>): SuppressionEntry {
  const out: SuppressionEntry = { reason: r.reason, suppressed_at: r.suppressedAt, source: r.source };
  if (r.leadId !== null) out.lead_id = r.leadId;
  if (r.targetNumber !== null) out.target_number = r.targetNumber;
  if (r.companyName !== null) out.company_name = r.companyName;
  if (r.email !== null) out.email = r.email;
  if (r.phone !== null) out.phone = r.phone;
  if (r.domain !== null) out.domain = r.domain;
  return out;
}

export function analyticsEventRow(e: AnalyticsEvent, index: number) {
  return {
    eventId: e.event_id,
    sequence: index + 1,
    leadId: e.lead_id ?? null,
    targetNumber: e.target_number ?? null,
    companyName: e.company_name ?? null,
    eventType: e.event_type,
    channel: e.channel,
    actor: e.actor,
    occurredAt: e.timestamp,
    payload: e.payload,
  };
}

/** A stored analytics_event row (the database returns plain strings, not the narrower event unions). */
export interface StoredAnalyticsEventRow {
  eventId: string;
  leadId: string | null;
  targetNumber: string | null;
  companyName: string | null;
  eventType: string;
  channel: string;
  actor: string;
  occurredAt: string;
  payload: unknown;
}

/** Inverse of analyticsEventRow, for reconciliation. */
export function analyticsEventFromRow(r: StoredAnalyticsEventRow): AnalyticsEvent {
  return {
    event_id: r.eventId,
    lead_id: r.leadId,
    target_number: r.targetNumber,
    company_name: r.companyName,
    event_type: r.eventType as AnalyticsEvent['event_type'],
    channel: r.channel as AnalyticsEvent['channel'],
    actor: r.actor as AnalyticsEvent['actor'],
    timestamp: r.occurredAt,
    payload: r.payload as Record<string, unknown>,
  };
}
