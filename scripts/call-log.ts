import { CALL_OUTCOMES, OBJECTION_CATEGORIES } from './lib/schema.js';
import { loadLeads, saveLeads, loadSuppression, addSuppression, logEvent, findLead, paths } from './lib/store.js';
import { phoneKey, outreachBlock, normalizeDomain, normalizeEmail } from './lib/contact.js';
import { parseTracker } from './lib/email-state.js';
import { todayIst, addDays } from './lib/geo.js';
import { parseArgs, str, oneOf, fail, runCli } from './lib/cli.js';
import { generateCallingQueue, callEligibility, MAX_UNANSWERED_ATTEMPTS } from './queue-calls.js';

const USAGE =
  'Usage: npm run calls:log -- --lead=<target|lead_id> --outcome=<' + CALL_OUTCOMES.join('|') + '> ' +
  '[--notes="..."] [--objection="..."] [--objection-category=' + OBJECTION_CATEGORIES.join('|') + '] ' +
  '[--callback-date=YYYY-MM-DD] [--by=AADI|DEV] [--whatsapp-ok] [--confirmed-identity]';

const NOT_CONNECTED = new Set(['NO_ANSWER', 'VOICEMAIL', 'WRONG_NUMBER']);
const UNANSWERED = new Set(['NO_ANSWER', 'VOICEMAIL', 'GATEKEEPER']);

export function logCallOutcome(argv: string[]): void {
  const args = parseArgs(argv, ['lead', 'outcome', 'notes', 'objection', 'objection-category', 'callback-date', 'by', 'whatsapp-ok', 'confirmed-identity']);
  const ident = str(args, 'lead');
  const outcomeRaw = str(args, 'outcome');
  if (!ident || !outcomeRaw) fail(USAGE);
  const outcome = oneOf(outcomeRaw, CALL_OUTCOMES, 'outcome')!;
  const by = oneOf(str(args, 'by') ?? 'AADI', ['AADI', 'DEV'] as const, 'by')!;
  const objectionCategory = oneOf(str(args, 'objection-category'), OBJECTION_CATEGORIES, 'objection-category') ?? null;
  const callbackDate = str(args, 'callback-date');
  if (callbackDate && !/^\d{4}-\d{2}-\d{2}$/.test(callbackDate)) fail('--callback-date must be YYYY-MM-DD');
  const connected = !NOT_CONNECTED.has(outcome);
  if (args['whatsapp-ok'] && !connected) fail('--whatsapp-ok needs a connected call where they agreed to WhatsApp.');
  if (args['confirmed-identity'] && !connected) fail('--confirmed-identity needs a connected call.');

  const leads = loadLeads();
  const lead = findLead(leads, ident);
  if (!lead) fail(`No lead matches --lead=${ident}. Use a target number (e.g. 111) or a lead_id.`);
  if (!phoneKey(lead.decision_maker_phone)) {
    fail(`Lead ${lead.target_number} (${lead.company_name}) has no phone on file, so a call cannot be logged. Record the number first with leads:record.`);
  }

  const suppression = loadSuppression();
  const ledger = parseTracker(paths().tracker).get(lead.target_number)?.status ?? null;
  const block = outreachBlock(lead, suppression, ledger);
  if (block.blocked && outcome !== 'DO_NOT_CONTACT') {
    console.warn(`⚠️  ${lead.target_number} is suppressed (${block.reason}). This call should not have happened; recording it for the audit trail.`);
  }
  if (outcome !== 'DO_NOT_CONTACT') {
    const pre = callEligibility(lead, suppression, ledger, todayIst());
    if (!pre.ok) {
      console.warn(`⚠️  ${lead.target_number} was not in today's call queue (${pre.reason}). If you dialled from an old AADI_DAILY_CALLS.md, regenerate it before the next call.`);
    }
  }

  const now = new Date().toISOString();
  const today = todayIst();
  const notes = str(args, 'notes') ?? null;
  const objection = str(args, 'objection') ?? null;

  lead.call_attempts = [...(lead.call_attempts ?? []), { at: now, by, outcome, notes, objection, objection_category: objectionCategory }];
  lead.call_status = outcome;
  lead.call_outcome = outcome;
  lead.last_contacted_at = now;
  lead.updated_at = now;
  if (objection) lead.objection = objection;
  if (notes) lead.notes = `${lead.notes ? `${lead.notes}\n` : ''}[${today} call/${by}] ${notes}`;

  let suppressionAdded = false;
  switch (outcome) {
    case 'NO_ANSWER':
    case 'VOICEMAIL':
    case 'GATEKEEPER': {
      const unanswered = lead.call_attempts.filter(a => UNANSWERED.has(a.outcome)).length;
      if (unanswered >= MAX_UNANSWERED_ATTEMPTS) {
        lead.next_action = `Stop calling: ${unanswered} unanswered attempts. Try another channel or drop.`;
        lead.next_action_date = null;
      } else {
        lead.next_action = 'Retry call';
        lead.next_action_date = addDays(today, 2);
      }
      break;
    }
    case 'WRONG_NUMBER':
      lead.phone_status = 'INVALID';
      lead.phone_verification_basis = null;
      lead.phone_verified_at = null;
      lead.whatsapp_basis = null;
      lead.whatsapp_basis_source = null;
      lead.next_action = 'Find the correct number (research queue)';
      lead.next_action_date = null;
      break;
    case 'CALLBACK':
      lead.lead_temperature = 'WARM';
      lead.next_action = 'Call back';
      lead.next_action_date = callbackDate ?? addDays(today, 1);
      break;
    case 'INTERESTED':
      lead.lead_temperature = 'HOT';
      lead.response_status = 'REPLIED_POSITIVE';
      lead.next_action = 'Send the promised follow-up today';
      lead.next_action_date = today;
      break;
    case 'NOT_NOW':
      lead.lead_temperature = 'WARM';
      lead.response_status = 'REPLIED_NOT_NOW';
      lead.next_action = 'Check in again';
      lead.next_action_date = callbackDate ?? addDays(today, 60);
      break;
    case 'NOT_INTERESTED':
      lead.lead_temperature = 'COLD';
      lead.response_status = 'NOT_INTERESTED';
      lead.next_action = 'None (not interested)';
      lead.next_action_date = null;
      break;
    case 'MEETING_BOOKED':
      lead.lead_temperature = 'HOT';
      lead.response_status = 'REPLIED_POSITIVE';
      lead.meeting_status = 'BOOKED';
      lead.next_action = 'Prepare for the meeting';
      lead.next_action_date = callbackDate ?? null;
      break;
    case 'DO_NOT_CONTACT':
      lead.lead_temperature = 'DEAD';
      lead.do_not_contact = true;
      lead.suppression_reason = `Asked not to be contacted on a call ${today} (${by})`;
      lead.research_state = 'DISQUALIFIED';
      lead.lead_priority = 'DISQUALIFIED';
      lead.whatsapp_basis = null;
      lead.whatsapp_basis_source = null;
      lead.next_action = 'None — do not contact';
      lead.next_action_date = null;
      suppressionAdded = addSuppression({
        lead_id: lead.lead_id,
        target_number: lead.target_number,
        company_name: lead.company_name,
        phone: lead.decision_maker_phone ?? undefined,
        email: normalizeEmail(lead.decision_maker_email) ?? undefined,
        domain: normalizeDomain(lead.website_url) ?? undefined,
        reason: lead.suppression_reason,
        suppressed_at: now,
        source: `calls:log (${by})`,
      });
      break;
  }

  if (args['whatsapp-ok'] && outcome !== 'DO_NOT_CONTACT' && outcome !== 'NOT_INTERESTED') {
    lead.whatsapp_basis = 'PERMISSION_GIVEN_ON_CALL';
    lead.whatsapp_basis_source = `Permission given on a call ${today} (${by})`;
  }
  if (args['confirmed-identity'] && outcome !== 'WRONG_NUMBER') {
    lead.phone_status = 'VERIFIED';
    lead.phone_verification_basis = `${lead.decision_maker_name} answered and confirmed identity on a call ${today} (${by})`;
    lead.phone_verified_at = now;
  }

  saveLeads(leads);

  const base = { lead_id: lead.lead_id, target_number: lead.target_number, company_name: lead.company_name, channel: 'CALL' as const, actor: by };
  logEvent({ ...base, event_type: 'CALL_ATTEMPTED', payload: { outcome, objection_category: objectionCategory } });
  if (connected) logEvent({ ...base, event_type: 'CALL_CONNECTED', payload: { outcome } });
  if (outcome === 'MEETING_BOOKED') logEvent({ ...base, event_type: 'MEETING_BOOKED', payload: { channel: 'CALL', archetype_id: lead.archetype_id } });
  if (outcome === 'DO_NOT_CONTACT') {
    logEvent({ ...base, event_type: 'OPT_OUT', payload: {} });
    if (suppressionAdded) logEvent({ ...base, event_type: 'SUPPRESSION_ADDED', payload: { source: 'call' } });
  }
  if (args['confirmed-identity']) logEvent({ ...base, event_type: 'CONTACT_PROVENANCE_UPDATED', payload: { field: 'phone', status: 'VERIFIED' } });
  if (lead.next_action_date) logEvent({ ...base, event_type: 'FOLLOW_UP_SCHEDULED', payload: { date: lead.next_action_date, action: lead.next_action } });

  console.log(`✅ ${lead.target_number} ${lead.company_name}: ${outcome}. Next: ${lead.next_action}${lead.next_action_date ? ` (${lead.next_action_date})` : ''}`);
  generateCallingQueue();
}

if (process.argv[1]?.endsWith('call-log.ts')) {
  runCli(() => logCallOutcome(process.argv.slice(2)));
}
