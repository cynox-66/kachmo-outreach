import type { Actor, EventType, KachmoLead, ResearchSource } from '../leads/schema.js';
import { isUrl, normalizeEmail, phoneKey, OUTREACH_USABLE } from '../contact/provenance.js';
import { eventSubject, refuse, type DomainEvent, type LeadDecision } from './decision.js';

/** The research fields a human may record against a lead. */
export const RECORDABLE_FIELDS = [
  'email',
  'phone',
  'decision-maker',
  'whatsapp-basis',
  'commercial-source',
  'friction-source',
  'trigger',
  'budget',
  'tech',
  'frontend-team',
  'fit',
  'timezone',
] as const;
export type RecordableField = (typeof RECORDABLE_FIELDS)[number];

export const CONTACT_PROVENANCE_VALUES = ['UNKNOWN', 'INFERRED', 'UNVERIFIED', 'PUBLICLY_LISTED', 'VERIFIED', 'INVALID'] as const;
export const WHATSAPP_BASIS_VALUES = ['BUSINESS_LISTED_WHATSAPP', 'PERMISSION_GIVEN_ON_CALL', 'NONE'] as const;
export const BUDGET_VALUES = ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export const FRONTEND_TEAM_VALUES = ['NO_FRONTEND_TEAM', 'SMALL_INTERNAL_TEAM', 'LARGE_INTERNAL_TEAM', 'UNCLEAR'] as const;
export const FIT_VALUES = ['CONFIRMED', 'REJECTED'] as const;

export interface ResearchRecordInput {
  field: RecordableField;
  by: Extract<Actor, 'DEV' | 'AADI'>;
  /** True when --by was supplied explicitly (required for the named human judgement on `fit`). */
  byExplicit?: boolean;
  value?: string | null;
  status?: string | null;
  source?: string | null;
  sourceType?: string | null;
  basis?: string | null;
  title?: string | null;
  date?: string | null;
}

export interface ResearchRecordContext {
  today: string;
  now: string;
  /** Returns true when the string is a valid IANA timezone. Supplied by the caller because core/ does not assume Intl. */
  isKnownTimezone: (tz: string) => boolean;
}

/**
 * Enum inputs are matched case-insensitively and returned upper-cased, exactly as the CLI has always done.
 * A value that is present but not allowed is an error distinct from one that is absent, so "you typed something
 * invalid" is never reported as "you forgot to pass it".
 */
function pickEnum<T extends string>(value: string | null | undefined, allowed: readonly T[], name: string): { value: T | null; error: string | null } {
  if (value === null || value === undefined || value === '') return { value: null, error: null };
  const up = value.toUpperCase() as T;
  if (!(allowed as readonly string[]).includes(up)) return { value: null, error: `Invalid --${name}=${value}. Allowed: ${allowed.join(', ')}` };
  return { value: up, error: null };
}

/**
 * Provenance rules for recorded research — the write-side counterpart of the qualification gates.
 *
 * The central rule: a claim may only be recorded with the evidence its status requires. PUBLICLY_LISTED needs a
 * source URL; VERIFIED needs a human verification basis; a WhatsApp basis needs either the listing URL or the call
 * on which permission was given. Nothing here checks that a URL resolves or that it supports the claim — that
 * remains a known v1.0 limitation, and the Phase 2 evidence layer (core/research/evidence.ts) is where it is fixed.
 */
export function decideResearchRecord(lead: KachmoLead, input: ResearchRecordInput, ctx: ResearchRecordContext): LeadDecision {
  const { field, by } = input;
  const value = input.value ?? null;
  const source = input.source ?? null;
  const basis = input.basis ?? null;
  const tn = lead.target_number;
  if (source && !isUrl(source)) return refuse(`--source must be a full http(s) URL, got "${source}"`);

  const patch: Partial<KachmoLead> = {};
  let eventType: EventType = 'RESEARCH_RECORDED';
  const payload: Record<string, unknown> = { field, has_source: !!source };

  const contact = (kind: 'email' | 'phone'): string | null => {
    const picked = pickEnum(input.status, CONTACT_PROVENANCE_VALUES, 'status');
    if (picked.error) return picked.error;
    const status = picked.value;
    if (!status) return `--field=${kind} requires --status=${CONTACT_PROVENANCE_VALUES.join('|')}`;
    if (value && kind === 'email' && !normalizeEmail(value)) return `Not a valid email: ${value}`;
    if (value && kind === 'phone' && !phoneKey(value)) return `Not a valid phone number (needs at least 10 digits): ${value}`;
    const current = kind === 'email' ? lead.decision_maker_email : lead.decision_maker_phone;
    if (!value && !current) return `${tn} has no ${kind} on file; pass --value.`;
    if (status === 'PUBLICLY_LISTED' && !source) return 'PUBLICLY_LISTED requires --source=<the https source URL where it is published>';
    if (status === 'VERIFIED' && !basis) return 'VERIFIED requires --basis="how it was verified"';
    if (kind === 'email') {
      if (value) patch.decision_maker_email = normalizeEmail(value);
      patch.email_status = status;
      patch.email_source = source ?? basis ?? lead.email_source;
      patch.email_verification_basis = status === 'VERIFIED' ? basis! : null;
      patch.email_verified_at = status === 'VERIFIED' ? ctx.now : null;
    } else {
      if (value) patch.decision_maker_phone = value;
      patch.phone_status = status;
      patch.phone_source = source ?? basis ?? lead.phone_source;
      patch.phone_verification_basis = status === 'VERIFIED' ? basis! : null;
      patch.phone_verified_at = status === 'VERIFIED' ? ctx.now : null;
      if (!OUTREACH_USABLE.has(status)) {
        patch.whatsapp_basis = null;
        patch.whatsapp_basis_source = null;
      }
    }
    eventType = 'CONTACT_PROVENANCE_UPDATED';
    payload.status = status;
    return null;
  };

  switch (field) {
    case 'email': {
      const problem = contact('email');
      if (problem) return refuse(problem);
      break;
    }
    case 'phone': {
      const problem = contact('phone');
      if (problem) return refuse(problem);
      break;
    }
    case 'decision-maker': {
      if (!source) return refuse('--field=decision-maker requires --source=<url showing the person and role>');
      if (value) patch.decision_maker_name = value;
      if (input.title) patch.decision_maker_title = input.title;
      patch.decision_maker_source = source;
      patch.decision_maker_confidence = 'MEDIUM';
      break;
    }
    case 'whatsapp-basis': {
      const picked = pickEnum(value, WHATSAPP_BASIS_VALUES, 'value');
      if (picked.error) return refuse(picked.error);
      const v = picked.value;
      if (!v) return refuse('--field=whatsapp-basis requires --value=BUSINESS_LISTED_WHATSAPP|PERMISSION_GIVEN_ON_CALL|NONE');
      if (v === 'NONE') {
        patch.whatsapp_basis = null;
        patch.whatsapp_basis_source = null;
      } else {
        if (!phoneKey(lead.decision_maker_phone)) return refuse(`${tn} has no phone on file; record the phone first.`);
        if (v === 'BUSINESS_LISTED_WHATSAPP' && !source) {
          return refuse('BUSINESS_LISTED_WHATSAPP requires --source=<url where the business advertises WhatsApp on this number>');
        }
        if (v === 'PERMISSION_GIVEN_ON_CALL' && !basis) return refuse('PERMISSION_GIVEN_ON_CALL requires --basis="when/how permission was given"');
        patch.whatsapp_basis = v;
        patch.whatsapp_basis_source = v === 'BUSINESS_LISTED_WHATSAPP' ? source! : basis!;
      }
      break;
    }
    case 'commercial-source':
      if (!source) return refuse('--field=commercial-source requires --source=<url>');
      if (value) patch.commercial_validation_signal = value;
      patch.commercial_signal_source = source;
      patch.commercial_signal_confidence = 'MEDIUM';
      break;
    case 'friction-source':
      if (!source) return refuse('--field=friction-source requires --source=<page url you checked>');
      if (value) patch.observable_friction = value;
      patch.website_friction_source = source;
      patch.website_friction_confidence = 'MEDIUM';
      break;
    case 'trigger':
      if (!value) return refuse('--field=trigger requires --value="<what happened>" or --value=NO_CLEAR_TRIGGER');
      if (value.toUpperCase() === 'NO_CLEAR_TRIGGER') {
        patch.trigger_event = 'NO_CLEAR_TRIGGER';
        patch.trigger_source = source ?? null;
        patch.trigger_date = null;
        patch.trigger_confidence = 'MEDIUM';
        patch.why_now = null;
      } else {
        patch.trigger_event = value;
        patch.trigger_source = source ?? null;
        patch.trigger_date = input.date ?? null;
        patch.trigger_confidence = source ? 'MEDIUM' : 'LOW';
        patch.why_now = value;
      }
      break;
    case 'budget': {
      const picked = pickEnum(value, BUDGET_VALUES, 'value');
      if (picked.error) return refuse(picked.error);
      const v = picked.value;
      if (!v) return refuse('--field=budget requires --value=VERY_HIGH|HIGH|MEDIUM|LOW|UNKNOWN');
      if (v !== 'UNKNOWN' && !basis) return refuse('--field=budget requires --basis="<the evidence>"');
      patch.budget_probability = v;
      patch.budget_probability_reason = v === 'UNKNOWN' ? null : basis!;
      patch.budget_probability_source = v === 'UNKNOWN' ? null : source ?? null;
      break;
    }
    case 'tech':
      if (!value) return refuse('--field=tech requires --value="<CMS / framework>"');
      patch.current_framework = value;
      patch.technology_source = source ?? null;
      patch.technology_confidence = source ? 'MEDIUM' : 'LOW';
      break;
    case 'frontend-team': {
      const picked = pickEnum(value, FRONTEND_TEAM_VALUES, 'value');
      if (picked.error) return refuse(picked.error);
      const v = picked.value;
      if (!v) return refuse('--field=frontend-team requires --value=NO_FRONTEND_TEAM|SMALL_INTERNAL_TEAM|LARGE_INTERNAL_TEAM|UNCLEAR');
      patch.frontend_team_status = v;
      patch.frontend_team_evidence = source ?? basis ?? null;
      break;
    }
    case 'fit': {
      const picked = pickEnum(value, FIT_VALUES, 'value');
      if (picked.error) return refuse(picked.error);
      const v = picked.value;
      if (!v) return refuse('--field=fit requires --value=CONFIRMED|REJECTED');
      if (!input.byExplicit) return refuse('--field=fit requires --by=DEV|AADI (fit is a named human judgement)');
      if (v === 'CONFIRMED') {
        patch.kachmo_fit_confirmed_by = by;
        patch.kachmo_fit_rejected_reason = null;
        if (basis && (lead.kachmo_solution_angle || '').trim().length < 10) patch.kachmo_solution_angle = basis;
      } else {
        if (!basis) return refuse('--value=REJECTED requires --basis="why it is not a fit"');
        patch.kachmo_fit_rejected_reason = basis;
        patch.kachmo_fit_confirmed_by = null;
      }
      break;
    }
    case 'timezone':
      if (!value) return refuse('--field=timezone requires --value=<IANA timezone>');
      if (!ctx.isKnownTimezone(value)) return refuse(`Unknown IANA timezone: ${value}`);
      patch.timezone = value;
      patch.timezone_basis = `recorded by ${by} ${ctx.today}${source ? ` (${source})` : ''}`;
      break;
  }

  const researchSource: ResearchSource = {
    source_url: source ?? null,
    source_type: input.sourceType ?? (source ? 'web' : 'human_note'),
    source_date: ctx.today,
    field_covered: field,
    confidence: source ? 'MEDIUM' : 'LOW',
    recorded_by: by,
  };
  patch.research_sources = [...(lead.research_sources ?? []), researchSource];
  patch.research_last_verified_at = ctx.now;
  patch.updated_at = ctx.now;

  const events: DomainEvent[] = [{ ...eventSubject(lead), event_type: eventType, channel: 'SYSTEM', actor: by, payload }];

  return {
    refusal: null,
    warnings: [],
    patch,
    suppression: null,
    events,
    summary: `Recorded ${field} for ${tn} ${lead.company_name}. Run "npm run leads:refresh" to re-qualify and re-score.`,
  };
}
