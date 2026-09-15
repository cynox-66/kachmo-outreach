import type { KachmoLead, QualificationGates, GateOutcome, ResearchState, SuppressionEntry } from './lib/schema.js';
import { loadLeads, saveLeads, loadSuppression, paths, logEvent } from './lib/store.js';
import { isUrl, phoneEligibility, emailRoute, outreachBlock } from './lib/contact.js';
import { parseTracker } from './lib/email-state.js';
import { runCli } from './lib/cli.js';

const GENERIC_DM_NAMES = new Set([
  'studio principals', 'principals', 'founders', 'founder', 'founding director', 'team', 'management', 'owner',
  'owners', 'proprietor', 'ceo', 'director', 'directors', 'partner', 'partners', 'headquarters', 'unknown', 'n/a',
  'tbd', 'the team',
]);

export function isGenericDecisionMaker(name: string | null | undefined): boolean {
  const n = (name || '').trim();
  return !n || GENERIC_DM_NAMES.has(n.toLowerCase()) || !/[a-z]/i.test(n);
}

const credit = (g: GateOutcome) => (g === 'PASS' ? 1 : g === 'UNVERIFIED' ? 0.5 : 0);

/**
 * Deterministic 8-gate evaluation. Missing information never becomes FAIL — FAIL requires evidence
 * (a sourced LOW budget, a human fit rejection) or an outreach block (suppression / opt-out).
 */
export function evaluateLeadGates(
  lead: KachmoLead,
  suppression: SuppressionEntry[] = [],
  emailLedgerStatus: string | null = null
): { gates: QualificationGates; missing: string[]; completenessScore: number; state: ResearchState; reasons: string[] } {
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
    triggerCredit = credit(gate7);
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
  const hasTech = !!(lead.current_framework || lead.cms);
  const techCredit = hasTech ? (isUrl(lead.technology_source) ? 1 : 0.5) : 0;
  if (techCredit === 0) missing.push('technology_stack');
  if (techCredit === 0.5) missing.push('technology_source');

  let frontendCredit: number | null = null; // only relevant for white-label agency partners
  if (lead.archetype_id === '1') {
    const known = lead.frontend_team_status && lead.frontend_team_status !== 'NOT_RESEARCHED';
    frontendCredit = known ? (isUrl(lead.frontend_team_evidence) ? 1 : 0.5) : 0;
    if (!known) missing.push('frontend_team_status');
  }
  const budgetCredit = gate6 === 'PASS' || gate6 === 'FAIL' ? 1 : gate6 === 'UNVERIFIED' ? 0.5 : 0;

  const dims: Array<[number, number | null]> = [
    [15, credit(gate1)],
    [15, credit(gate2)],
    [15, credit(gate3)],
    [15, credit(gate4)],
    [5, credit(gate5)],
    [10, budgetCredit],
    [10, triggerCredit],
    [10, techCredit],
    [5, frontendCredit],
    [5, credit(gate8)],
  ];
  const applicable = dims.filter(([, c]) => c !== null) as Array<[number, number]>;
  const completenessScore = Math.round(
    (applicable.reduce((s, [w, c]) => s + w * c, 0) / applicable.reduce((s, [w]) => s + w, 0)) * 100
  );

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

export function qualifyLeads(): Record<string, number> {
  const leads = loadLeads();
  const suppression = loadSuppression();
  const tracker = parseTracker(paths().tracker);
  const counts: Record<string, number> = { QUALIFIED: 0, RESEARCH_REQUIRED: 0, DISQUALIFIED: 0 };
  const now = new Date().toISOString();

  for (const lead of leads) {
    const r = evaluateLeadGates(lead, suppression, tracker.get(lead.target_number)?.status ?? null);
    const prev = lead.research_state;
    lead.qualification_gates = r.gates;
    lead.missing_intelligence = r.missing;
    lead.research_completeness_score = r.completenessScore;
    lead.research_state = r.state;
    lead.disqualification_reasons = r.reasons;
    if (r.state === 'DISQUALIFIED') lead.lead_priority = 'DISQUALIFIED';
    // OUTREACH_READY is re-derived by leads:opportunity, so that demotion is not a real change.
    if (prev !== r.state && !(prev === 'OUTREACH_READY' && r.state === 'QUALIFIED')) {
      lead.updated_at = now;
      logEvent({
        lead_id: lead.lead_id, target_number: lead.target_number, company_name: lead.company_name,
        event_type: 'QUALIFICATION_CHANGED', channel: 'SYSTEM', actor: 'SYSTEM',
        payload: { from: prev, to: r.state, reasons: r.reasons },
      });
    }
    counts[r.state]++;
  }

  saveLeads(leads);

  console.log(`\n⚖️  8-Gate Qualification:`);
  console.log(`- Leads evaluated: ${leads.length}`);
  console.log(`- QUALIFIED (no blocking gate; UNVERIFIED claims allowed): ${counts.QUALIFIED}`);
  console.log(`- RESEARCH_REQUIRED (a required fact is missing): ${counts.RESEARCH_REQUIRED}`);
  console.log(`- DISQUALIFIED (evidence-based FAIL or outreach blocked): ${counts.DISQUALIFIED}`);
  return counts;
}

if (process.argv[1]?.endsWith('leads-qualify.ts')) {
  runCli(() => {
    qualifyLeads();
  });
}
