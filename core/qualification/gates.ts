import type { KachmoLead, QualificationGates, GateOutcome, ResearchState, SuppressionEntry } from '../leads/schema.js';
import { isUrl, phoneEligibility, emailRoute } from '../contact/provenance.js';
import { outreachBlock } from '../suppression/match.js';
import { gateCredit, researchCompleteness } from './completeness.js';

const GENERIC_DM_NAMES = new Set([
  'studio principals', 'principals', 'founders', 'founder', 'founding director', 'team', 'management', 'owner',
  'owners', 'proprietor', 'ceo', 'director', 'directors', 'partner', 'partners', 'headquarters', 'unknown', 'n/a',
  'tbd', 'the team',
]);

export function isGenericDecisionMaker(name: string | null | undefined): boolean {
  const n = (name || '').trim();
  return !n || GENERIC_DM_NAMES.has(n.toLowerCase()) || !/[a-z]/i.test(n);
}

export interface GateEvaluation {
  gates: QualificationGates;
  missing: string[];
  completenessScore: number;
  state: ResearchState;
  reasons: string[];
}

/**
 * Deterministic 8-gate evaluation — Kachmo Methodology v1.0. Missing information never becomes FAIL — FAIL requires
 * evidence (a sourced LOW budget, a human fit rejection) or an outreach block (suppression / opt-out).
 */
export function evaluateLeadGates(
  lead: KachmoLead,
  suppression: SuppressionEntry[] = [],
  emailLedgerStatus: string | null = null
): GateEvaluation {
  const missing: string[] = [];
  const reasons: string[] = [];

  // Gate 1 — named decision maker
  const gate1: GateOutcome = isGenericDecisionMaker(lead.decision_maker_name)
    ? 'PENDING'
    : isUrl(lead.decision_maker_source) ? 'PASS' : 'UNVERIFIED';
  if (gate1 === 'PENDING') missing.push('decision_maker_name');
  if (gate1 === 'UNVERIFIED') missing.push('decision_maker_source');

  // Gate 2 — direct, non-inferred contact route. Shared mailboxes (info@, hello@) do not count.
  const phone = phoneEligibility(lead);
  const email = emailRoute(lead);
  const emailSourced = lead.email_status === 'PUBLICLY_LISTED' || lead.email_status === 'VERIFIED';
  let gate2: GateOutcome;
  if (phone.ok || (email.quality === 'DIRECT' && emailSourced)) gate2 = 'PASS';
  else if (email.quality === 'DIRECT') gate2 = 'UNVERIFIED';
  else gate2 = 'PENDING';
  if (gate2 === 'PENDING') {
    const detail = [email.detail, lead.decision_maker_phone ? phone.reason : null].filter(Boolean).join('; ');
    missing.push(`direct_contact_route (${detail})`);
  }
  if (gate2 !== 'PASS' && lead.decision_maker_phone && !phone.ok) missing.push('phone_source');
  if (gate2 === 'UNVERIFIED') missing.push('email_source');

  // Gate 3 — commercial proof
  const gate3: GateOutcome = (lead.commercial_validation_signal || '').trim().length < 15
    ? 'PENDING'
    : isUrl(lead.commercial_signal_source) ? 'PASS' : 'UNVERIFIED';
  if (gate3 === 'PENDING') missing.push('commercial_validation_signal');
  if (gate3 === 'UNVERIFIED') missing.push('commercial_signal_source');

  // Gate 4 — observable digital friction
  const gate4: GateOutcome = (lead.observable_friction || '').trim().length < 15
    ? 'PENDING'
    : isUrl(lead.website_friction_source) ? 'PASS' : 'UNVERIFIED';
  if (gate4 === 'PENDING') missing.push('observable_friction');
  if (gate4 === 'UNVERIFIED') missing.push('website_friction_source');

  // Gate 5 — location / timezone (never guessed for multi-timezone countries)
  const gate5: GateOutcome = lead.timezone && lead.timezone !== 'UTC' ? 'PASS' : 'PENDING';
  if (gate5 === 'PENDING') missing.push('location_timezone');

  // Gate 6 — budget probability: UNKNOWN is legitimate and never blocks
  let gate6: GateOutcome = 'UNKNOWN';
  if (lead.budget_probability && lead.budget_probability !== 'UNKNOWN') {
    if (isUrl(lead.budget_probability_source)) gate6 = lead.budget_probability === 'LOW' ? 'FAIL' : 'PASS';
    else gate6 = 'UNVERIFIED';
  }
  if (gate6 === 'UNKNOWN') missing.push('budget_probability');
  if (gate6 === 'UNVERIFIED') missing.push('budget_probability_source');
  if (gate6 === 'FAIL') reasons.push('Gate 6: sourced evidence of LOW budget');

  // Gate 7 — buying trigger: informational only. NO_CLEAR_TRIGGER is a valid researched result.
  const trig = lead.trigger_event?.trim();
  let gate7: GateOutcome = 'UNKNOWN';
  let triggerCredit = 0;
  if (trig === 'NO_CLEAR_TRIGGER') triggerCredit = 1;
  else if (trig && trig !== 'UNKNOWN') {
    gate7 = isUrl(lead.trigger_source) ? 'PASS' : 'UNVERIFIED';
    triggerCredit = gateCredit(gate7);
  }
  if (triggerCredit === 0) missing.push('trigger_event');
  if (triggerCredit === 0.5) missing.push('trigger_source');

  // Gate 8 — Kachmo fit: a human judgement, not a property of text length
  let gate8: GateOutcome;
  if (lead.kachmo_fit_rejected_reason) {
    gate8 = 'FAIL';
    reasons.push(`Gate 8: fit rejected — ${lead.kachmo_fit_rejected_reason}`);
  } else if ((lead.kachmo_solution_angle || '').trim().length < 10) {
    gate8 = 'PENDING';
    missing.push('kachmo_solution_angle');
  } else if (lead.kachmo_fit_confirmed_by) {
    gate8 = 'PASS';
  } else {
    gate8 = 'UNVERIFIED';
    missing.push('kachmo_fit_review');
  }

  // Research completeness: share of required intelligence on file AND sourced (unsourced claims earn half).
  const completeness = researchCompleteness(lead, { gate1, gate2, gate3, gate4, gate5, gate6, gate8 }, triggerCredit);
  missing.push(...completeness.missing);
  const completenessScore = completeness.score;

  const gates: QualificationGates = {
    gate_1_decision_maker: gate1,
    gate_2_contactability: gate2,
    gate_3_commercial_proof: gate3,
    gate_4_digital_friction: gate4,
    gate_5_location_timezone: gate5,
    gate_6_budget_probability: gate6,
    gate_7_buying_intent: gate7,
    gate_8_kachmo_fit: gate8,
  };

  const block = outreachBlock(lead, suppression, emailLedgerStatus);
  let state: ResearchState;
  if (block.blocked) {
    state = 'DISQUALIFIED';
    reasons.push(`Outreach blocked: ${block.reason}`);
  } else if (Object.values(gates).includes('FAIL')) {
    state = 'DISQUALIFIED';
  } else if ([gate1, gate2, gate3, gate4, gate5, gate8].includes('PENDING')) {
    state = 'RESEARCH_REQUIRED';
  } else {
    state = 'QUALIFIED';
  }

  return { gates, missing, completenessScore, state, reasons };
}

/**
 * Writes a gate evaluation onto a lead exactly as the engine always has. Returns whether the research state
 * really changed (OUTREACH_READY → QUALIFIED is not a change: readiness is re-derived by the opportunity step).
 * No I/O: callers decide whether to persist and which event to record.
 */
export function applyQualification(lead: KachmoLead, r: GateEvaluation, now: string): { previousState: ResearchState; changed: boolean } {
  const previousState = lead.research_state;
  lead.qualification_gates = r.gates;
  lead.missing_intelligence = r.missing;
  lead.research_completeness_score = r.completenessScore;
  lead.research_state = r.state;
  lead.disqualification_reasons = r.reasons;
  if (r.state === 'DISQUALIFIED') lead.lead_priority = 'DISQUALIFIED';
  const changed = previousState !== r.state && !(previousState === 'OUTREACH_READY' && r.state === 'QUALIFIED');
  if (changed) lead.updated_at = now;
  return { previousState, changed };
}
