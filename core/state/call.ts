import type { Actor, CallAttempt, CallOutcome, KachmoLead, ObjectionCategory, SuppressionEntry } from '../leads/schema.js';
import { normalizeDomain, normalizeEmail, phoneKey } from '../contact/provenance.js';
import { outreachBlock } from '../suppression/match.js';
import { callEligibility, MAX_UNANSWERED_ATTEMPTS } from '../queues/calls.js';
import { addDays } from '../geo/timezone.js';
import { appendNote, doNotContactPatch, eventSubject, refuse, type DomainEvent, type LeadDecision } from './decision.js';

/** Outcomes where nobody the caller could speak to was reached. */
export const CALL_NOT_CONNECTED: ReadonlySet<string> = new Set(['NO_ANSWER', 'VOICEMAIL', 'WRONG_NUMBER']);
/** Outcomes that count toward the MAX_UNANSWERED_ATTEMPTS stop-calling rule. */
export const CALL_UNANSWERED: ReadonlySet<string> = new Set(['NO_ANSWER', 'VOICEMAIL', 'GATEKEEPER']);

export const isCallConnected = (outcome: CallOutcome): boolean => !CALL_NOT_CONNECTED.has(outcome);

export interface CallLogInput {
  outcome: CallOutcome;
  by: Extract<Actor, 'AADI' | 'DEV'>;
  notes?: string | null;
  objection?: string | null;
  objectionCategory?: ObjectionCategory | null;
  callbackDate?: string | null;
  whatsappOk?: boolean;
  confirmedIdentity?: boolean;
}

export interface CallLogContext {
  /** IST calendar date (YYYY-MM-DD) the call is being logged on. */
  today: string;
  /** Wall-clock instant recorded on the attempt (ISO 8601). */
  now: string;
  suppression: SuppressionEntry[];
  /** Email-ledger status from OUTREACH_TRACKER.md, or null. */
  ledgerStatus: string | null;
}

/**
 * Pre-flight checks on the flags alone, before any lead is loaded. Returns a refusal reason or null.
 * Kept in core/ because "you cannot claim WhatsApp permission from a call nobody answered" is a methodology rule,
 * not an argument-parsing detail.
 */
export function callLogInputProblem(input: CallLogInput): string | null {
  if (input.callbackDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.callbackDate)) return '--callback-date must be YYYY-MM-DD';
  const connected = isCallConnected(input.outcome);
  if (input.whatsappOk && !connected) return '--whatsapp-ok needs a connected call where they agreed to WhatsApp.';
  if (input.confirmedIdentity && !connected) return '--confirmed-identity needs a connected call.';
  return null;
}

/**
 * The call state machine: what a logged call outcome does to a lead.
 *
 * Refuses when there is no phone on file (a call that cannot have happened). Suppressed leads are NOT refused —
 * the attempt is recorded for the audit trail with a warning, because hiding a call that did happen is worse than
 * recording one that should not have.
 */
export function decideCallOutcome(lead: KachmoLead, input: CallLogInput, ctx: CallLogContext): LeadDecision {
  const problem = callLogInputProblem(input);
  if (problem) return refuse(problem);
  if (!phoneKey(lead.decision_maker_phone)) {
    return refuse(
      `Lead ${lead.target_number} (${lead.company_name}) has no phone on file, so a call cannot be logged. Record the number first with leads:record.`
    );
  }

  const { outcome, by } = input;
  const notes = input.notes ?? null;
  const objection = input.objection ?? null;
  const objectionCategory = input.objectionCategory ?? null;
  const callbackDate = input.callbackDate ?? null;
  const warnings: string[] = [];

  const block = outreachBlock(lead, ctx.suppression, ctx.ledgerStatus);
  if (block.blocked && outcome !== 'DO_NOT_CONTACT') {
    warnings.push(`${lead.target_number} is suppressed (${block.reason}). This call should not have happened; recording it for the audit trail.`);
  }
  if (outcome !== 'DO_NOT_CONTACT') {
    const pre = callEligibility(lead, ctx.suppression, ctx.ledgerStatus, ctx.today, Date.parse(ctx.now));
    if (!pre.ok) {
      warnings.push(
        `${lead.target_number} was not in today's call queue (${pre.reason}). If you dialled from an old AADI_DAILY_CALLS.md, regenerate it before the next call.`
      );
    }
  }

  const attempt: CallAttempt = { at: ctx.now, by, outcome, notes, objection, objection_category: objectionCategory };
  const callAttempts = [...(lead.call_attempts ?? []), attempt];

  const patch: Partial<KachmoLead> = {
    call_attempts: callAttempts,
    call_status: outcome,
    call_outcome: outcome,
    last_contacted_at: ctx.now,
    updated_at: ctx.now,
  };
  if (objection) patch.objection = objection;
  if (notes) patch.notes = appendNote(lead.notes, ctx.today, `call/${by}`, notes);

  let suppression: SuppressionEntry | null = null;
  switch (outcome) {
    case 'NO_ANSWER':
    case 'VOICEMAIL':
    case 'GATEKEEPER': {
      const unanswered = callAttempts.filter(a => CALL_UNANSWERED.has(a.outcome)).length;
      if (unanswered >= MAX_UNANSWERED_ATTEMPTS) {
        patch.next_action = `Stop calling: ${unanswered} unanswered attempts. Try another channel or drop.`;
        patch.next_action_date = null;
      } else {
        patch.next_action = 'Retry call';
        patch.next_action_date = addDays(ctx.today, 2);
      }
      break;
    }
    case 'WRONG_NUMBER':
      patch.phone_status = 'INVALID';
      patch.phone_verification_basis = null;
      patch.phone_verified_at = null;
      patch.whatsapp_basis = null;
      patch.whatsapp_basis_source = null;
      patch.next_action = 'Find the correct number (research queue)';
      patch.next_action_date = null;
      break;
    case 'CALLBACK':
      patch.lead_temperature = 'WARM';
      patch.next_action = 'Call back';
      patch.next_action_date = callbackDate ?? addDays(ctx.today, 1);
      break;
    case 'INTERESTED':
      patch.lead_temperature = 'HOT';
      patch.response_status = 'REPLIED_POSITIVE';
      patch.next_action = 'Send the promised follow-up today';
      patch.next_action_date = ctx.today;
      break;
    case 'NOT_NOW':
      patch.lead_temperature = 'WARM';
      patch.response_status = 'REPLIED_NOT_NOW';
      patch.next_action = 'Check in again';
      patch.next_action_date = callbackDate ?? addDays(ctx.today, 60);
      break;
    case 'NOT_INTERESTED':
      patch.lead_temperature = 'COLD';
      patch.response_status = 'NOT_INTERESTED';
      patch.next_action = 'None (not interested)';
      patch.next_action_date = null;
      break;
    case 'MEETING_BOOKED':
      patch.lead_temperature = 'HOT';
      patch.response_status = 'REPLIED_POSITIVE';
      patch.meeting_status = 'BOOKED';
      patch.next_action = 'Prepare for the meeting';
      patch.next_action_date = callbackDate ?? null;
      break;
    case 'DO_NOT_CONTACT': {
      const reason = `Asked not to be contacted on a call ${ctx.today} (${by})`;
      Object.assign(patch, { lead_temperature: 'DEAD' as const }, doNotContactPatch(reason));
      suppression = {
        lead_id: lead.lead_id,
        target_number: lead.target_number,
        company_name: lead.company_name,
        phone: lead.decision_maker_phone ?? undefined,
        email: normalizeEmail(lead.decision_maker_email) ?? undefined,
        domain: normalizeDomain(lead.website_url) ?? undefined,
        reason,
        suppressed_at: ctx.now,
        source: `calls:log (${by})`,
      };
      break;
    }
  }

  if (input.whatsappOk && outcome !== 'DO_NOT_CONTACT' && outcome !== 'NOT_INTERESTED') {
    patch.whatsapp_basis = 'PERMISSION_GIVEN_ON_CALL';
    patch.whatsapp_basis_source = `Permission given on a call ${ctx.today} (${by})`;
  }
  if (input.confirmedIdentity && outcome !== 'WRONG_NUMBER') {
    patch.phone_status = 'VERIFIED';
    patch.phone_verification_basis = `${lead.decision_maker_name} answered and confirmed identity on a call ${ctx.today} (${by})`;
    patch.phone_verified_at = ctx.now;
  }

  const base = { ...eventSubject(lead), channel: 'CALL' as const, actor: by };
  const events: DomainEvent[] = [{ ...base, event_type: 'CALL_ATTEMPTED', payload: { outcome, objection_category: objectionCategory } }];
  if (isCallConnected(outcome)) events.push({ ...base, event_type: 'CALL_CONNECTED', payload: { outcome } });
  if (outcome === 'MEETING_BOOKED') events.push({ ...base, event_type: 'MEETING_BOOKED', payload: { channel: 'CALL', archetype_id: lead.archetype_id } });
  if (outcome === 'DO_NOT_CONTACT') {
    events.push({ ...base, event_type: 'OPT_OUT', payload: {} });
    events.push({ ...base, event_type: 'SUPPRESSION_ADDED', payload: { source: 'call' }, only_if_suppression_added: true });
  }
  if (input.confirmedIdentity) events.push({ ...base, event_type: 'CONTACT_PROVENANCE_UPDATED', payload: { field: 'phone', status: 'VERIFIED' } });
  if (patch.next_action_date) events.push({ ...base, event_type: 'FOLLOW_UP_SCHEDULED', payload: { date: patch.next_action_date, action: patch.next_action } });

  return {
    refusal: null,
    warnings,
    patch,
    suppression,
    events,
    summary: `${lead.target_number} ${lead.company_name}: ${outcome}. Next: ${patch.next_action}${patch.next_action_date ? ` (${patch.next_action_date})` : ''}`,
  };
}
