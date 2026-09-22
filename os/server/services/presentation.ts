/**
 * Pure presentation logic for Kachmo Outbound OS.
 *
 * Transforms already-loaded canonical records, enums, and field keys into clean,
 * human-readable UI strings and visual status tones.
 *
 * STRICT INVARIANTS:
 * - Pure functions only.
 * - No DB queries, writes, or mutations.
 * - No qualification, scoring, or eligibility logic.
 * - No authorization, suppression, or network calls.
 * - Neutral semantic translations (e.g. DISQUALIFIED -> "Disqualified").
 */

import { GATE_LABELS as OPERATOR_GATE_LABELS } from './operator';

export type StatusTone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

/** Human-readable status translations for research and outreach states */
export const STATUS_LABELS: Record<string, string> = {
  RESEARCH_REQUIRED: 'Needs research',
  OUTREACH_READY: 'Ready to contact',
  QUALIFIED: 'Qualified',
  DISQUALIFIED: 'Disqualified',
  SUPPRESSED: 'Do not contact',
  AWAITING_REVIEW: 'Awaiting review',
  DUPLICATE_SUSPECTED: 'Duplicate suspected',
  FLAGGED_CONTRADICTION: 'Contradiction flagged',
  INCOMPLETE: 'Incomplete',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  DEFERRED: 'Deferred',
  CALLABLE: 'Ready to call',
  NOT_CALLABLE: 'Not ready to call',
  OPEN: 'Open',
  CLOSED: 'Closed',
  SENT: 'Sent',
  PENDING: 'Pending',
  FOLLOW_UP_DUE: 'Follow-up due',
  SCHEDULED: 'Scheduled',
  WON: 'Won',
  LOST: 'Lost',
  CALL_BOOKED: 'Call booked',
  REPLIED_WARM: 'Replied (warm)',
  REPLIED_NO: 'Replied (declined)',
};

/** Visual status tones for consistent styling across the application */
export const STATUS_TONES: Record<string, StatusTone> = {
  OUTREACH_READY: 'ok',
  QUALIFIED: 'ok',
  ACCEPTED: 'ok',
  SENT: 'ok',
  WON: 'ok',
  CALL_BOOKED: 'ok',
  REPLIED_WARM: 'ok',
  PUBLICLY_LISTED: 'ok',
  VERIFIED: 'ok',
  HEALTHY: 'ok',

  RESEARCH_REQUIRED: 'warn',
  INCOMPLETE: 'warn',
  DUPLICATE_SUSPECTED: 'warn',
  AWAITING_REVIEW: 'info',
  PENDING: 'warn',
  FOLLOW_UP_DUE: 'warn',
  SCHEDULED: 'warn',
  LOW: 'warn',
  URL_SHAPED: 'warn',
  UNVERIFIED: 'warn',

  DISQUALIFIED: 'bad',
  SUPPRESSED: 'bad',
  FLAGGED_CONTRADICTION: 'bad',
  REJECTED: 'bad',
  REPLIED_NO: 'bad',
  CRITICAL: 'bad',
  INVALID: 'bad',
  FAIL: 'bad',
};

/** Human-readable field names for operator display */
export const FIELD_LABELS: Record<string, string> = {
  decision_maker_source: 'Decision-maker',
  decision_maker_name: 'Decision-maker name',
  decision_maker_title: 'Decision-maker title',
  decision_maker_phone: 'Direct phone',
  decision_maker_email: 'Direct email',
  decision_maker_confidence: 'Decision-maker confidence',
  direct_contact_route: 'Direct contact route',
  commercial_signal_source: 'Business signal',
  commercial_validation_signal: 'Commercial signal',
  website_friction_source: 'Website opportunity',
  observable_friction: 'Observable friction',
  kachmo_solution_angle: 'Solution angle',
  budget_probability: 'Budget signal',
  trigger_event: 'Why now',
  why_now: 'Why now',
  technology_stack: 'Current technology',
  PUBLICLY_LISTED: 'Publicly listed',
  VERIFIED: 'Verified',
  URL_SHAPED: 'Source recorded',
  UNVERIFIED: 'Unverified',
  INVALID: 'Invalid',
  website_url: 'Website',
  lead_id: 'Lead ID',
  target_number: 'Target number',
  company_name: 'Company name',
  location_city: 'City',
  location_country: 'Country',
  timezone: 'Timezone',
};

/**
 * Gate names for operator display. ONE table, keyed by core's own gate keys (tests/operator.ts pins that). The table
 * that used to live here was keyed by gate names core never emits (`gate_1_commercial_proof`, …), so six of eight
 * gates rendered as raw identifiers — and "fixing" it by position would have mislabelled them.
 */
export { GATE_LABELS } from './operator';

/** Maps a status key to a human-readable label */
export function presentStatus(status: string | null | undefined): string {
  if (!status) return '—';
  return STATUS_LABELS[status] ?? status.replace(/_/g, ' ').toLowerCase();
}

/** Maps a status key to a visual tone */
export function presentTone(status: string | null | undefined): StatusTone {
  if (!status) return 'neutral';
  return STATUS_TONES[status] ?? 'neutral';
}

/** Maps a technical field name to a human-friendly label */
export function presentField(field: string | null | undefined): string {
  if (!field) return '—';
  return FIELD_LABELS[field] ?? field.replace(/_/g, ' ').toLowerCase();
}

/** Maps a technical gate identifier to a human-friendly label */
export function presentGate(gate: string | null | undefined): string {
  if (!gate) return '—';
  return (OPERATOR_GATE_LABELS as Record<string, string>)[gate] ?? gate.replace(/_/g, ' ');
}

/** Formats an ISO date into a clean display string */
export function presentDate(iso: string | null | undefined, includeTime = false): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    if (includeTime) {
      return d.toISOString().slice(0, 16).replace('T', ' ');
    }
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
