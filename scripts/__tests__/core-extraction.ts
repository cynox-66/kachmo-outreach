/**
 * PHASE 1.5A — DOMAIN EXTRACTION TESTS.
 *
 * Two jobs:
 *   1. Prove each newly extracted rule directly, as a pure function, with no filesystem involved.
 *   2. Prove there is exactly ONE implementation of each rule: scripts/ and os/ must not hold a second copy.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import type { KachmoLead, SuppressionEntry } from '../lib/schema.js';
import { decideCallOutcome, callLogInputProblem, isCallConnected } from '../../core/state/call.js';
import { decideWhatsAppTransition } from '../../core/state/whatsapp.js';
import { decidePipelineTransition, pipelineLogInputProblem } from '../../core/state/pipeline.js';
import { decideResearchRecord } from '../../core/state/research-record.js';
import { planSuppression, scheduledQueueConflicts } from '../../core/state/suppression-propagation.js';
import { doNotContactPatch, appendNote } from '../../core/state/decision.js';
import { buildWarRoomSummary, leadBaseCounts } from '../../core/reports/war-room.js';
import { buildWeeklyReport, ratio, MIN_SAMPLE } from '../../core/reports/weekly.js';
import { CSV_COLUMNS, parseCsv, renderLeadsCsv, planCsvMigration, preserveHumanData } from '../../core/leads/csv.js';
import { ARCHETYPES_V1, ARCHETYPE_IDS, TAXONOMY_VERSION, defaultOwnerForArchetype, verticalFromLabel } from '../../core/config/taxonomy.js';

const REPO = process.cwd();
let passed = 0;
const failures: string[] = [];
function assert(cond: unknown, name: string, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ❌ ${name}${detail !== undefined ? `\n     ${JSON.stringify(detail)}` : ''}`);
  }
}
const section = (s: string) => console.log(`\n${s}`);

const NOW = '2026-09-15T06:00:00.000Z';
const TODAY = '2026-09-15';

/** A minimally complete lead. Every test derives its fixture from this, changing only what it is about. */
function lead(over: Partial<KachmoLead> = {}): KachmoLead {
  return {
    lead_id: '11111111-1111-4111-8111-111111111111',
    target_number: '900',
    company_name: 'Test Co',
    website_url: 'https://test-co.example',
    industry: 'x',
    archetype_id: '1',
    archetype_label: '1: White-Label Agency',
    location_city: 'London',
    location_country: 'United Kingdom',
    timezone: 'Europe/London',
    estimated_scale: 'small',
    decision_maker_name: 'Jane Roe',
    decision_maker_title: 'Founder',
    decision_maker_email: null,
    decision_maker_phone: '+44 20 7946 0000',
    decision_maker_whatsapp: null,
    decision_maker_linkedin: null,
    decision_maker_instagram: null,
    decision_maker_source: 'https://test-co.example/about',
    decision_maker_confidence: 'MEDIUM',
    email_status: 'UNKNOWN',
    email_source: null,
    phone_status: 'UNVERIFIED',
    phone_source: null,
    whatsapp_basis: null,
    whatsapp_basis_source: null,
    whatsapp_eligible: 'UNCLEAR',
    whatsapp_number: null,
    whatsapp_number_source: null,
    whatsapp_eligibility_reason: null,
    whatsapp_confidence: 'UNKNOWN',
    contact_confidence: 'LOW',
    commercial_validation_signal: 'x',
    commercial_signal_source: null,
    commercial_signal_confidence: 'LOW',
    budget_probability: 'UNKNOWN',
    budget_probability_reason: null,
    budget_probability_source: null,
    estimated_deal_value: null,
    expected_value_confidence: 'UNKNOWN',
    referral_potential: null,
    network_value: null,
    current_website_status: null,
    current_framework: null,
    cms: null,
    hosting: null,
    performance_signal: null,
    mobile_experience: null,
    technical_quality: null,
    ux_quality: null,
    visual_quality: null,
    technology_source: null,
    technology_confidence: 'NOT_RESEARCHED',
    frontend_team_status: 'NOT_RESEARCHED',
    frontend_team_evidence: null,
    observable_friction: 'x',
    pain_type: null,
    pain_score: null,
    website_friction_source: null,
    website_friction_confidence: 'LOW',
    intent_score: null,
    trigger_event: null,
    trigger_date: null,
    trigger_source: null,
    trigger_confidence: 'NOT_RESEARCHED',
    why_now: null,
    kachmo_solution_angle: 'x',
    personalized_outreach_hook: 'x',
    opportunity_description: null,
    recommended_scope: null,
    estimated_project_value: null,
    recommended_channel: null,
    secondary_channel: null,
    channel_reason: null,
    commercial_fit_score: null,
    budget_score: null,
    pain_score_normalized: null,
    decision_maker_quality_score: null,
    intent_trigger_score: null,
    kachmo_score: null,
    research_completeness_score: 0,
    lead_priority: null,
    priority_confidence: null,
    research_state: 'QUALIFIED',
    missing_intelligence: [],
    qualification_gates: null,
    lead_state: 'DISCOVERED',
    email_outreach_status: null,
    whatsapp_outreach_status: null,
    call_status: null,
    call_attempts: [],
    linkedin_status: null,
    instagram_status: null,
    last_contacted_at: null,
    next_action: null,
    next_action_date: null,
    owner: 'DEV',
    do_not_contact: false,
    suppression_reason: null,
    response_status: null,
    lead_temperature: null,
    call_outcome: null,
    objection: null,
    meeting_status: null,
    proposal_status: null,
    deal_stage: null,
    deal_value: null,
    lost_reason: null,
    notes: null,
    research_sources: [],
    overall_research_confidence: 'LOW',
    conversion_probability: 'UNKNOWN',
    expected_revenue: 'UNKNOWN',
    created_at: NOW,
    updated_at: NOW,
    migrated_from_csv: true,
    batch_history: [],
    ...over,
  } as KachmoLead;
}

const callCtx = (over: Partial<{ suppression: SuppressionEntry[]; ledgerStatus: string | null }> = {}) => ({
  today: TODAY,
  now: NOW,
  suppression: [] as SuppressionEntry[],
  ledgerStatus: null as string | null,
  ...over,
});

console.log('\n🧩 CORE EXTRACTION (Phase 1.5A)');

section('1. Call state machine');
{
  assert(isCallConnected('INTERESTED') && !isCallConnected('NO_ANSWER') && !isCallConnected('WRONG_NUMBER'), 'connectedness is decided by outcome, not by flags');
  assert(callLogInputProblem({ outcome: 'NO_ANSWER', by: 'AADI', whatsappOk: true })?.includes('--whatsapp-ok'), 'WhatsApp permission cannot be claimed from a call nobody answered');
  assert(callLogInputProblem({ outcome: 'NO_ANSWER', by: 'AADI', confirmedIdentity: true })?.includes('--confirmed-identity'), 'identity cannot be confirmed on a call nobody answered');
  assert(callLogInputProblem({ outcome: 'CALLBACK', by: 'AADI', callbackDate: '15/09/2026' })?.includes('YYYY-MM-DD'), 'a malformed callback date is refused');
  assert(callLogInputProblem({ outcome: 'CALLBACK', by: 'AADI', callbackDate: '2026-09-22' }) === null, 'a well-formed callback date is accepted');

  const noPhone = decideCallOutcome(lead({ decision_maker_phone: null }), { outcome: 'NO_ANSWER', by: 'AADI' }, callCtx());
  assert(noPhone.refusal?.includes('no phone on file'), 'a call cannot be logged against a lead with no phone');
  assert(!noPhone.events.length && !Object.keys(noPhone.patch).length, 'a refused call writes nothing at all');

  const dnc = decideCallOutcome(lead(), { outcome: 'DO_NOT_CONTACT', by: 'AADI' }, callCtx());
  assert(dnc.patch.do_not_contact === true && dnc.patch.research_state === 'DISQUALIFIED' && dnc.patch.lead_priority === 'DISQUALIFIED', 'DO_NOT_CONTACT disqualifies the lead');
  assert(dnc.patch.whatsapp_basis === null && dnc.patch.whatsapp_basis_source === null, 'DO_NOT_CONTACT revokes any WhatsApp basis');
  assert(dnc.suppression?.phone === '+44 20 7946 0000' && dnc.suppression?.domain === 'test-co.example', 'DO_NOT_CONTACT suppresses every identifier on the lead');
  assert(dnc.events.some(e => e.event_type === 'OPT_OUT'), 'DO_NOT_CONTACT emits OPT_OUT');
  assert(dnc.events.find(e => e.event_type === 'SUPPRESSION_ADDED')?.only_if_suppression_added === true, 'SUPPRESSION_ADDED is emitted only when the entry was actually inserted');

  const wrong = decideCallOutcome(lead({ whatsapp_basis: 'BUSINESS_LISTED_WHATSAPP' }), { outcome: 'WRONG_NUMBER', by: 'AADI' }, callCtx());
  assert(wrong.patch.phone_status === 'INVALID' && wrong.patch.whatsapp_basis === null, 'WRONG_NUMBER invalidates the phone and revokes the WhatsApp basis');

  const attempts = [1, 2].map(n => ({ at: `2026-09-1${n}T06:00:00.000Z`, by: 'AADI' as const, outcome: 'NO_ANSWER' as const, notes: null, objection: null, objection_category: null }));
  const third = decideCallOutcome(lead({ call_attempts: attempts }), { outcome: 'NO_ANSWER', by: 'AADI' }, callCtx());
  assert(String(third.patch.next_action).startsWith('Stop calling: 3'), 'the third unanswered attempt stops the calling sequence');
  const second = decideCallOutcome(lead({ call_attempts: attempts.slice(0, 1) }), { outcome: 'NO_ANSWER', by: 'AADI' }, callCtx());
  assert(second.patch.next_action === 'Retry call' && second.patch.next_action_date === '2026-09-17', 'earlier unanswered attempts schedule a retry in two days');

  const suppressed = decideCallOutcome(lead({ do_not_contact: true, research_state: 'DISQUALIFIED', lead_priority: 'DISQUALIFIED' }), { outcome: 'NO_ANSWER', by: 'AADI' }, callCtx());
  assert(suppressed.refusal === null && suppressed.warnings.some(w => w.includes('suppressed')), 'a call to a suppressed lead is recorded for the audit trail, with a warning');
}

section('2. WhatsApp state machine');
{
  const sourced = lead({ phone_status: 'PUBLICLY_LISTED', phone_source: 'https://test-co.example/contact', whatsapp_basis: 'BUSINESS_LISTED_WHATSAPP', whatsapp_basis_source: 'https://test-co.example/contact' });
  const wctx = callCtx();
  assert(decideWhatsAppTransition(sourced, { status: 'SENT', by: 'AADI' }, wctx).refusal?.includes('not APPROVED'), 'a send before approval is refused');
  assert(decideWhatsAppTransition(sourced, { status: 'APPROVED', by: 'DEV' }, wctx).patch.whatsapp_outreach_status === 'APPROVED', 'an eligible draft can be approved');
  assert(decideWhatsAppTransition(lead(), { status: 'APPROVED', by: 'DEV' }, wctx).refusal?.includes('not eligible'), 'an unsourced phone cannot be approved for WhatsApp');
  const approved = { ...sourced, whatsapp_outreach_status: 'APPROVED' };
  assert(decideWhatsAppTransition(approved, { status: 'SENT', by: 'AADI' }, wctx).patch.next_action_date === '2026-09-19', 'a send schedules a four-day wait, not a second message');
  const sent = { ...sourced, whatsapp_outreach_status: 'SENT' };
  assert(decideWhatsAppTransition(sent, { status: 'SENT', by: 'AADI' }, wctx).refusal?.includes('already SENT'), 'a duplicate send is refused');
  assert(decideWhatsAppTransition(sent, { status: 'APPROVED', by: 'DEV' }, wctx).refusal?.includes('already'), 'a sent message cannot be re-approved');
  assert(decideWhatsAppTransition(sourced, { status: 'REPLIED', by: 'AADI' }, wctx).refusal?.includes('requires a SENT'), 'a reply cannot be recorded without a send');
  const optOut = decideWhatsAppTransition(sourced, { status: 'OPT_OUT', by: 'AADI' }, wctx);
  assert(optOut.patch.do_not_contact === true && optOut.suppression !== null, 'a WhatsApp opt-out suppresses the contact');
  assert(decideWhatsAppTransition(sourced, { status: 'APPROVED', by: 'DEV' }, callCtx({ ledgerStatus: 'REPLIED_NO' })).refusal?.includes('suppressed'), 'a lead who said no by email cannot be approached on WhatsApp');
}

section('3. Pipeline state machine');
{
  assert(pipelineLogInputProblem({ stage: 'REPLIED_POSITIVE', by: 'DEV' })?.includes('--channel'), 'a recorded response requires channel attribution');
  assert(pipelineLogInputProblem({ stage: 'MEETING_DONE', by: 'DEV' }) === null, 'stages that are not responses need no channel');
  const p = callCtx();
  assert(decidePipelineTransition(lead(), { stage: 'PROPOSAL_SENT', by: 'DEV' }, p).refusal?.includes('no meeting recorded'), 'a proposal requires a meeting first');
  assert(decidePipelineTransition(lead(), { stage: 'WON', by: 'DEV' }, p).refusal?.includes('no proposal recorded'), 'a win requires a proposal first');
  assert(decidePipelineTransition(lead(), { stage: 'MEETING_DONE', by: 'DEV' }, p).refusal?.includes('no booked meeting'), 'a completed meeting requires a booked one');
  assert(decidePipelineTransition(lead({ deal_stage: 'WON' }), { stage: 'LOST', by: 'DEV', reason: 'BUDGET' }, p).refusal?.includes('already closed'), 'a closed deal is terminal');
  assert(decidePipelineTransition(lead({ proposal_status: 'SENT' }), { stage: 'LOST', by: 'DEV' }, p).refusal?.includes('--reason'), 'a lost deal must record why');
  assert(decidePipelineTransition(lead(), { stage: 'FOLLOW_UP_SENT', by: 'DEV' }, p).refusal?.includes('does not show a sent email'), 'a follow-up requires a sent email in the production ledger');
  assert(decidePipelineTransition(lead(), { stage: 'FOLLOW_UP_SENT', by: 'DEV' }, callCtx({ ledgerStatus: 'FOLLOWED_UP' })).refusal?.includes('single-bump'), 'the ledger enforces the single-bump protocol');
  assert(
    decidePipelineTransition(lead({ email_follow_up_sent_at: '2026-09-01' }), { stage: 'FOLLOW_UP_SENT', by: 'DEV' }, callCtx({ ledgerStatus: 'SENT' })).refusal?.includes('single-bump'),
    'the lead record also enforces the single-bump protocol'
  );
  assert(
    decidePipelineTransition(lead({ do_not_contact: true, research_state: 'DISQUALIFIED', lead_priority: 'DISQUALIFIED' }), { stage: 'MEETING_BOOKED', by: 'DEV', channel: 'EMAIL' }, p).refusal?.includes('suppressed'),
    'a suppressed lead cannot be advanced through an engaging stage'
  );
  const won = decidePipelineTransition(lead({ meeting_status: 'DONE', proposal_status: 'SENT' }), { stage: 'WON', by: 'DEV', value: '$6,000' }, p);
  assert(won.patch.deal_stage === 'WON' && won.patch.deal_value === '$6,000' && won.events[0].event_type === 'DEAL_WON', 'a legitimate win records the deal and emits DEAL_WON');
}

section('4. Research recording provenance');
{
  const ctx = { today: TODAY, now: NOW, isKnownTimezone: (tz: string) => tz === 'Europe/London' };
  const d = (over: Parameters<typeof decideResearchRecord>[1], l = lead()) => decideResearchRecord(l, over, ctx);
  assert(d({ field: 'phone', by: 'DEV', status: 'PUBLICLY_LISTED' }).refusal?.includes('requires --source'), 'PUBLICLY_LISTED requires a source URL');
  assert(d({ field: 'phone', by: 'DEV', status: 'VERIFIED' }).refusal?.includes('requires --basis'), 'VERIFIED requires a verification basis');
  assert(d({ field: 'phone', by: 'DEV', status: 'PUBLICLY_LISTED', source: 'their-site-dot-com' }).refusal?.includes('full http(s) URL'), 'a URL-shaped-but-not-a-URL source is refused');
  assert(d({ field: 'phone', by: 'DEV', status: 'NONSENSE' }).refusal?.includes('Invalid --status=NONSENSE'), 'an unsupported provenance value is named, not silently treated as missing');
  assert(d({ field: 'phone', by: 'DEV', status: 'publicly_listed', source: 'https://x.example/c' }).patch.phone_status === 'PUBLICLY_LISTED', 'provenance values are matched case-insensitively');
  assert(d({ field: 'phone', by: 'DEV' }).refusal?.includes('requires --status'), 'contact research always states its provenance');
  assert(d({ field: 'email', by: 'DEV', status: 'PUBLICLY_LISTED', value: 'not-an-email', source: 'https://x.example/c' }).refusal?.includes('Not a valid email'), 'a malformed email is refused');
  assert(d({ field: 'phone', by: 'DEV', status: 'PUBLICLY_LISTED', value: '123', source: 'https://x.example/c' }).refusal?.includes('Not a valid phone'), 'a too-short phone number is refused');

  const downgrade = d({ field: 'phone', by: 'DEV', status: 'INVALID' }, lead({ whatsapp_basis: 'BUSINESS_LISTED_WHATSAPP', whatsapp_basis_source: 'https://x.example' }));
  assert(downgrade.patch.whatsapp_basis === null, 'downgrading the phone below outreach-usable revokes the WhatsApp basis');

  assert(d({ field: 'whatsapp-basis', by: 'DEV', value: 'BUSINESS_LISTED_WHATSAPP' }).refusal?.includes('requires --source'), 'a listed-WhatsApp basis requires the listing URL');
  assert(d({ field: 'whatsapp-basis', by: 'DEV', value: 'PERMISSION_GIVEN_ON_CALL' }).refusal?.includes('requires --basis'), 'a permission basis requires when and how it was given');
  assert(d({ field: 'whatsapp-basis', by: 'DEV', value: 'BUSINESS_LISTED_WHATSAPP', source: 'https://x.example/c' }, lead({ decision_maker_phone: null })).refusal?.includes('no phone on file'), 'a WhatsApp basis needs a phone to attach to');
  assert(d({ field: 'decision-maker', by: 'DEV', value: 'X' }).refusal?.includes('requires --source'), 'a decision maker must be evidenced');
  assert(d({ field: 'fit', by: 'DEV', value: 'CONFIRMED' }).refusal?.includes('named human judgement'), 'confirming fit must be attributed to a named human');
  assert(d({ field: 'fit', by: 'DEV', byExplicit: true, value: 'REJECTED' }).refusal?.includes('requires --basis'), 'rejecting fit must say why');
  assert(d({ field: 'budget', by: 'DEV', byExplicit: true, value: 'HIGH' }).refusal?.includes('requires --basis'), 'a budget claim requires evidence');
  assert(d({ field: 'budget', by: 'DEV', value: 'UNKNOWN' }).patch.budget_probability === 'UNKNOWN', 'UNKNOWN budget needs no evidence — it claims nothing');
  assert(d({ field: 'timezone', by: 'DEV', value: 'Mars/Olympus' }).refusal?.includes('Unknown IANA timezone'), 'an invented timezone is refused');

  const ok = d({ field: 'phone', by: 'AADI', status: 'PUBLICLY_LISTED', source: 'https://x.example/contact' });
  assert(ok.patch.research_sources?.length === 1 && ok.patch.research_sources[0].source_url === 'https://x.example/contact', 'every recorded fact appends its provenance');
  assert(ok.patch.research_sources?.[0].recorded_by === 'AADI', 'provenance records who recorded it');
  assert(ok.events[0].event_type === 'CONTACT_PROVENANCE_UPDATED', 'contact changes are auditable as provenance events');
  const noSource = d({ field: 'trigger', by: 'DEV', value: 'raised a seed round' });
  assert(noSource.patch.trigger_confidence === 'LOW' && noSource.patch.research_sources?.[0].confidence === 'LOW', 'an unsourced claim is recorded at LOW confidence, never MEDIUM');
}

section('5. Suppression propagation');
{
  const leads = [lead({ target_number: '900' }), lead({ target_number: '901', lead_id: '22222222-2222-4222-8222-222222222222', website_url: 'https://other.example', decision_maker_phone: '+1 415 555 0000' })];
  const plan = planSuppression(leads, { reason: 'asked to be removed', by: 'DEV', lead: leads[0] }, NOW);
  assert(plan.refusal === null && plan.entry?.target_number === '900', 'suppressing a known lead captures its identifiers');
  assert(plan.affected.length === 1 && plan.affected[0].lead.target_number === '900', 'only matching leads are flagged');
  assert(plan.affected[0].patch.do_not_contact === true && plan.affected[0].patch.research_state === 'DISQUALIFIED', 'a suppressed lead is disqualified in the same operation');
  assert(planSuppression(leads, { reason: 'x', by: 'DEV', domain: 'gmail.com' }, NOW).refusal?.includes('freemail'), 'a freemail domain cannot be suppressed (it would block unrelated people)');
  assert(planSuppression(leads, { reason: 'x', by: 'DEV' }, NOW).refusal?.includes('needs --lead'), 'a suppression with no identifier is refused');
  assert(planSuppression(leads, { reason: '', by: 'DEV', email: 'a@b.com' }, NOW).refusal?.includes('--reason'), 'a suppression must record a reason');
  assert(planSuppression(leads, { reason: 'x', by: 'DEV', phone: '123' }, NOW).refusal?.includes('Not a valid phone'), 'a malformed phone cannot be suppressed');

  const domainPlan = planSuppression(leads, { reason: 'x', by: 'DEV', domain: 'test-co.example' }, NOW);
  assert(domainPlan.affected.length === 1, 'a domain suppression reaches every lead on that domain');

  const queued = [{ targetNumber: '900', to: 'jane@test-co.example' }, { targetNumber: '905', to: 'someone@elsewhere.example' }];
  const conflicts = scheduledQueueConflicts(queued, domainPlan.entry!, new Set(['900']));
  assert(conflicts.length === 1 && conflicts[0] === '900', 'a suppression still queued for production email is reported as a conflict');
  assert(scheduledQueueConflicts([], domainPlan.entry!, new Set(['900'])).length === 0, 'an empty production queue produces no conflicts');

  const patch = doNotContactPatch('because');
  assert(patch.next_action === 'None — do not contact' && patch.next_action_date === null, 'a suppressed lead is never left with pending work');
  assert(appendNote('first', TODAY, 'call/AADI', 'second') === `first\n[${TODAY} call/AADI] second`, 'notes are appended, never replaced');
  assert(appendNote(null, TODAY, 'call/AADI', 'only') === `[${TODAY} call/AADI] only`, 'the first note needs no leading newline');
}

section('6. Report derivations');
{
  const leads = [
    lead({ target_number: '900', research_state: 'OUTREACH_READY', lead_priority: 'A', priority_confidence: 'PROVISIONAL', recommended_channel: 'EMAIL', kachmo_score: 70 }),
    lead({ target_number: '901', research_state: 'RESEARCH_REQUIRED', lead_priority: 'B' }),
    lead({ target_number: '902', research_state: 'DISQUALIFIED', lead_priority: 'DISQUALIFIED', do_not_contact: true, next_action_date: TODAY, next_action: 'nope' }),
  ];
  const counts = leadBaseCounts(leads);
  assert(counts.total === 3 && counts.outreach_ready === 1 && counts.research_required === 1 && counts.disqualified === 1, 'the lead base counts every state');
  assert(counts.a_or_a_plus === 1 && counts.a_or_a_plus_provisional === 1, 'provisional A-grades are counted separately from confirmed ones');

  const wr = buildWarRoomSummary({
    today: TODAY,
    generatedAt: NOW,
    leads,
    suppression: [],
    tracker: new Map(),
    scheduled: [],
    callCards: [],
    whatsappItems: [],
    researchItems: [],
    alerts: ['an alert'],
  });
  assert(wr.alerts[0] === 'an alert', 'environment alerts are carried through untouched');
  assert(wr.dev.follow_ups_due.length === 0, 'a disqualified lead never appears in a work list, even with work due');
  assert(wr.dev.next_email_candidates.length === 1, 'only outreach-ready email leads are proposed for the next send');

  assert(ratio('a', 'b', 3, 5).display.includes(`n<${MIN_SAMPLE}`), 'a ratio below the sample floor is never shown as a percentage');
  assert(ratio('a', 'b', 10, 40).display === '10/40 (25%)', 'a ratio above the floor shows the percentage alongside the counts');
  assert(ratio('a', 'b', 0, 0).display === '—', 'a ratio with no denominator shows nothing rather than zero');
  const weekly = buildWeeklyReport({ today: TODAY, generatedAt: NOW, leads, events: [], tracker: new Map() });
  assert(weekly.conversion_probability === 'UNKNOWN', 'the weekly report never estimates a conversion probability');
  assert(weekly.week.start === '2026-09-09' && weekly.week.end === TODAY, 'the reporting week is the seven days ending today');
  assert(weekly.funnel[0].count === 3 && weekly.funnel.every(f => typeof f.count === 'number'), 'the funnel is counted, not estimated');
}

section('7. CSV contract');
{
  assert(CSV_COLUMNS.length === 15, 'the interchange shape is the legacy 15 columns');
  assert(parseCsv('a,b\n"x,1","he said ""hi"""\n')[1][1] === 'he said "hi"', 'quoted commas and escaped quotes round-trip');
  assert(parseCsv('a,b\n\n\nc,d\n').length === 2, 'blank lines are ignored');
  const rendered = renderLeadsCsv([lead({ raw_contact_route: 'jane@test-co.example', raw_archetype_id: '1: White-Label Agency' })]);
  assert(rendered.split('\n')[0] === CSV_COLUMNS.join(','), 'the export writes the canonical header');
  assert(parseCsv(rendered).length === 2 && parseCsv(rendered)[1].length === 15, 'the export round-trips through the parser');

  const bad = planCsvMigration('wrong,header\n1,2\n', [], new Map(), { now: NOW, newLeadId: () => 'id' });
  assert(bad.errors[0].startsWith('Unexpected CSV header'), 'an unexpected header aborts the whole import');
  const header = CSV_COLUMNS.join(',');
  const row = (tn: string, name: string) => `${tn},1,1: White-Label Agency,${name},https://x.example,London,United Kingdom,small,Jane,Founder,jane@x.example,sig,fric,angle,hook`;
  const dup = planCsvMigration(`${header}\n${row('001', 'A')}\n${row('001', 'B')}\n`, [], new Map(), { now: NOW, newLeadId: () => 'id' });
  assert(dup.errors.some(e => e.includes('duplicate target_number')), 'duplicate target numbers abort the import');
  assert(dup.leads.length === 0, 'an aborted import produces no leads at all');
  const badTn = planCsvMigration(`${header}\n${row('1', 'A')}\n`, [], new Map(), { now: NOW, newLeadId: () => 'id' });
  assert(badTn.errors.some(e => e.includes('invalid target_number')), 'a malformed target number aborts the import');

  let n = 0;
  const ok = planCsvMigration(`${header}\n${row('001', 'A')}\n${row('002', 'B')}\n`, [], new Map(), { now: NOW, newLeadId: () => `id-${++n}` });
  assert(ok.errors.length === 0 && ok.created === 2 && ok.leads.length === 2, 'a clean CSV imports every row');
  assert(ok.leads[0].phone_status === 'UNKNOWN' && ok.leads[0].email_status === 'UNVERIFIED', 'imported contacts start unverified — a spreadsheet is not a source');
  assert(ok.leads[0].research_state === 'QUALIFICATION_PENDING', 'imported leads are never qualified by the import itself');

  const stored = lead({ target_number: '001', company_name: 'A', phone_status: 'VERIFIED', phone_verification_basis: 'spoke to her', decision_maker_phone: '+44 20 7946 0001', notes: 'keep me' });
  const rerun = planCsvMigration(`${header}\n${row('001', 'A')}\n`, [stored], new Map(), { now: NOW, newLeadId: () => 'new-id' });
  assert(rerun.leads[0].lead_id === stored.lead_id, 'a re-import preserves lead identity');
  assert(rerun.leads[0].phone_status === 'VERIFIED' && rerun.leads[0].notes === 'keep me', 'a re-import never overwrites verified contact data or human notes');
  assert(rerun.created === 0, 'a re-import of known leads creates nothing');
  const renamed = planCsvMigration(`${header}\n${row('001', 'Different Co')}\n`, [stored], new Map(), { now: NOW, newLeadId: () => 'new-id' });
  assert(renamed.errors.some(e => e.includes('in the database but')), 'a company name that disagrees with the stored lead aborts the import');
  const extra = planCsvMigration(`${header}\n${row('002', 'B')}\n`, [stored], new Map(), { now: NOW, newLeadId: () => 'new-id' });
  assert(extra.leads.some(l => l.target_number === '001'), 'leads absent from the CSV are kept, never deleted');
  assert(preserveHumanData(ok.leads[0], stored).lead_id === stored.lead_id, 'preserveHumanData keeps the stored identity');
}

section('8. Taxonomy boundary');
{
  assert(TAXONOMY_VERSION === '1.0', 'the taxonomy is versioned');
  assert(ARCHETYPE_IDS.length === 6, 'there are exactly six archetypes — none invented, none revived');
  assert(!ARCHETYPES_V1.some(a => /companies house|micro-trade/i.test(a.name)), 'the paused UK micro-trades archetype is not present');
  assert(defaultOwnerForArchetype('6') === 'AADI' && defaultOwnerForArchetype('1') === 'DEV', 'the archetype→owner rule has one definition');
  assert(verticalFromLabel('6', '6: Dental Clinics & Chains') === 'Dental Clinics & Chains', 'a vertical is recoverable where the label carries one');
  assert(verticalFromLabel('1', '1: White-Label Agency') === null, 'no vertical is invented where the label is an archetype name');
  const leadsAtBaseline: KachmoLead[] = JSON.parse(readFileSync(join(REPO, 'database/kachmo_leads.json'), 'utf-8'));
  const unknown = [...new Set(leadsAtBaseline.map(l => l.archetype_id))].filter(id => !ARCHETYPE_IDS.includes(id));
  assert(unknown.length === 0, 'every archetype in the live database is declared in the taxonomy', unknown);
  const undeclared = leadsAtBaseline.filter(l => !ARCHETYPES_V1.find(a => a.id === l.archetype_id)?.observedLabels.includes(l.archetype_label)).map(l => l.archetype_label);
  assert(undeclared.length === 0, 'every archetype label in the live database is declared (including the overloaded ones)', [...new Set(undeclared)]);
}

section('9. Single implementation (no rule lives in two places)');
{
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(f => {
      const p = join(dir, f);
      if (f === 'node_modules' || f === '.next' || f === 'out') return [];
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
    });
  const scriptSrc = walk(join(REPO, 'scripts')).filter(f => !f.includes('__tests__'));
  const osSrc = walk(join(REPO, 'os')).filter(f => !f.includes('/tests/'));
  const read = (f: string) => readFileSync(f, 'utf-8');
  const offenders = (files: string[], re: RegExp) => files.filter(f => re.test(read(f))).map(f => relative(REPO, f));

  // Each pattern is a fragment that exists exactly once, inside core/. Finding it elsewhere means a second copy.
  const duplicated: Array<[string, RegExp]> = [
    ['the call outcome switch', /case 'WRONG_NUMBER':[\s\S]{0,200}phone_status = 'INVALID'|MAX_UNANSWERED_ATTEMPTS\)\s*\{/],
    ['the WhatsApp approval gate', /is not APPROVED \(status:|not logging a duplicate send/],
    ['the pipeline stage ordering', /WON requires PROPOSAL_SENT first|A proposal requires MEETING_BOOKED/],
    ['the research provenance rules', /PUBLICLY_LISTED requires --source|VERIFIED requires --basis/],
    ['the do-not-contact patch', /next_action = 'None — do not contact'|next_action: 'None — do not contact'/],
    ['the weekly funnel derivation', /Qualified \(no blocking gate\)|Researched \(completeness/],
    ['the war-room work lists', /positive_without_meeting:|next_email_candidates:/],
    ['the CSV column list', /'target_number',\s+'archetype_id',\s+'archetype_label'|target_number,archetype_id,archetype_label/],
    ['the human-data preservation list', /PRESERVE_IF_SET:|const isSet = \(v: unknown\)/],
  ];
  const coreSrc = walk(join(REPO, 'core'));
  for (const [what, re] of duplicated) {
    // The pattern must match inside core/, or it is a dead detector that would pass no matter what.
    assert(offenders(coreSrc, re).length > 0, `the detector for ${what} actually matches core/ (not a vacuous test)`);
    const bad = [...offenders(scriptSrc, re), ...offenders(osSrc, re)];
    assert(bad.length === 0, `${what} exists only in core/`, bad);
  }

  // Thin wrappers: a CLI that owns a write path should be small once its rules live in core/.
  const wrappers = ['call-log.ts', 'whatsapp-log.ts', 'pipeline-log.ts', 'leads-record.ts', 'suppress-add.ts', 'leads-export-csv.ts', 'migrate-csv-to-leads.ts'];
  for (const w of wrappers) {
    const lines = read(join(REPO, 'scripts', w)).split('\n').length;
    assert(lines <= 80, `scripts/${w} is a thin wrapper (${lines} lines)`);
  }

  // Core stays pure: the boundary test in golden-v1 covers imports; this covers the new modules specifically.
  const coreNew = walk(join(REPO, 'core', 'state')).concat(walk(join(REPO, 'core', 'reports')), walk(join(REPO, 'core', 'config')));
  assert(coreNew.length >= 9, `the extracted modules are present (${coreNew.length} files)`);
  assert(offenders(coreNew, /\bprocess\.|require\(|from ['"](node:)?(fs|path|crypto|child_process)['"]/).length === 0, 'the extracted modules read no environment and touch no filesystem');
  assert(offenders(coreNew, /new Date\(\)|Date\.now\(\)/).length === 0, 'the extracted modules never read the clock — every timestamp is passed in');
}

console.log(`\n${'='.repeat(60)}\nCORE EXTRACTION SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
