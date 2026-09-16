import type { AnalyticsEvent, KachmoLead, SuppressionEntry } from '../leads/schema.js';

/**
 * The shape every write-path decision in core/ returns.
 *
 * A decision is a PURE description of an intended change. It performs no I/O: the caller (a CLI script, a server
 * action) is responsible for loading the lead, applying the patch, persisting and appending the events. This keeps
 * one implementation of each rule while leaving filesystem/database concerns entirely outside core/.
 *
 * `refusal` is fail-closed: when it is set, nothing else in the decision may be applied.
 */
export interface LeadDecision {
  /** Non-null means the transition is refused. The caller must not apply patch, suppression or events. */
  refusal: string | null;
  /** Non-blocking operator warnings (e.g. "this call was not in today's queue"). */
  warnings: string[];
  /** Shallow merge onto the lead record. */
  patch: Partial<KachmoLead>;
  /** A suppression entry the caller must add (deduplicated by the caller's store). */
  suppression: SuppressionEntry | null;
  /** Events to append, in order. */
  events: DomainEvent[];
  /** One-line operator summary of what happened. */
  summary: string;
}

/**
 * An analytics event without the identifiers only a persistence layer can mint (event_id, timestamp).
 * `only_if_suppression_added` marks an event that must be appended only when the caller's store actually inserted
 * the suppression entry (i.e. an equivalent one did not already exist).
 */
export type DomainEvent = Omit<AnalyticsEvent, 'event_id' | 'timestamp'> & { only_if_suppression_added?: true };

export const refuse = (reason: string): LeadDecision => ({
  refusal: reason,
  warnings: [],
  patch: {},
  suppression: null,
  events: [],
  summary: reason,
});

/** Identity fields every event for a lead carries. */
export const eventSubject = (lead: KachmoLead) => ({
  lead_id: lead.lead_id,
  target_number: lead.target_number,
  company_name: lead.company_name,
});

/** Appends a dated operator note to the existing notes, preserving the existing one-note-per-line format. */
export function appendNote(existing: string | null | undefined, today: string, tag: string, note: string): string {
  return `${existing ? `${existing}\n` : ''}[${today} ${tag}] ${note}`;
}

/**
 * The full opt-out patch applied wherever a contact asks not to be contacted again (call, WhatsApp, manual
 * suppression). One definition so a lead can never be half-suppressed through one channel but not another.
 */
export function doNotContactPatch(reason: string): Partial<KachmoLead> {
  return {
    do_not_contact: true,
    suppression_reason: reason,
    research_state: 'DISQUALIFIED',
    lead_priority: 'DISQUALIFIED',
    whatsapp_basis: null,
    whatsapp_basis_source: null,
    next_action: 'None — do not contact',
    next_action_date: null,
  };
}
