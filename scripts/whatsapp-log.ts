import { loadLeads, saveLeads, loadSuppression, addSuppression, logEvent, findLead, paths } from './lib/store.js';
import { whatsappEligibility, outreachBlock, normalizeEmail } from './lib/contact.js';
import { parseTracker } from './lib/email-state.js';
import { todayIst, addDays } from './lib/geo.js';
import { parseArgs, str, oneOf, fail, runCli } from './lib/cli.js';
import { generateWhatsAppQueue } from './queue-whatsapp.js';

const STATUSES = ['APPROVED', 'REJECTED', 'SENT', 'REPLIED', 'OPT_OUT'] as const;
const USAGE = `Usage: npm run whatsapp:log -- --lead=<target|lead_id> --status=<${STATUSES.join('|')}> [--by=DEV|AADI] [--notes="..."]`;

/** Records human review and human sends. This never sends anything. */
export function logWhatsApp(argv: string[]): void {
  const args = parseArgs(argv, ['lead', 'status', 'by', 'notes']);
  const ident = str(args, 'lead');
  const status = oneOf(str(args, 'status'), STATUSES, 'status');
  if (!ident || !status) fail(USAGE);
  const by = oneOf(str(args, 'by') ?? 'AADI', ['DEV', 'AADI'] as const, 'by')!;

  const leads = loadLeads();
  const lead = findLead(leads, ident);
  if (!lead) fail(`No lead matches --lead=${ident}.`);
  const tn = lead.target_number;
  const block = outreachBlock(lead, loadSuppression(), parseTracker(paths().tracker).get(tn)?.status ?? null);
  const current = lead.whatsapp_outreach_status;
  const now = new Date().toISOString();
  const today = todayIst();
  const done = current === 'SENT' || current === 'REPLIED';

  switch (status) {
    case 'APPROVED': {
      if (block.blocked) fail(`${tn} is suppressed (${block.reason}).`);
      if (done) fail(`${tn} WhatsApp is already ${current}.`);
      const e = whatsappEligibility(lead);
      if (!e.ok) fail(`${tn} is not eligible for WhatsApp: ${e.reason}`);
      lead.whatsapp_outreach_status = 'APPROVED';
      break;
    }
    case 'REJECTED':
      if (done) fail(`${tn} WhatsApp is already ${current}.`);
      lead.whatsapp_outreach_status = 'REJECTED';
      break;
    case 'SENT': {
      if (done) fail(`${tn} is already SENT; not logging a duplicate send.`);
      if (current !== 'APPROVED') fail(`${tn} is not APPROVED (status: ${current ?? 'none'}). A draft must be approved before it is sent.`);
      if (block.blocked) fail(`${tn} is suppressed (${block.reason}). Do not send.`);
      const e = whatsappEligibility(lead);
      if (!e.ok) fail(`${tn} is no longer eligible for WhatsApp: ${e.reason}`);
      lead.whatsapp_outreach_status = 'SENT';
      lead.last_contacted_at = now;
      lead.next_action = 'Wait for a WhatsApp reply (no second unsolicited message)';
      lead.next_action_date = addDays(today, 4);
      break;
    }
    case 'REPLIED':
      if (current !== 'SENT') fail(`${tn}: REPLIED requires a SENT message (status: ${current ?? 'none'}).`);
      lead.whatsapp_outreach_status = 'REPLIED';
      lead.response_status = lead.response_status ?? 'REPLIED';
      lead.next_action = 'Reply personally on WhatsApp';
      lead.next_action_date = today;
      break;
    case 'OPT_OUT':
      lead.whatsapp_outreach_status = 'OPT_OUT';
      lead.do_not_contact = true;
      lead.suppression_reason = `Opted out on WhatsApp ${today}`;
      lead.research_state = 'DISQUALIFIED';
      lead.lead_priority = 'DISQUALIFIED';
      lead.whatsapp_basis = null;
      lead.whatsapp_basis_source = null;
      lead.next_action = 'None — do not contact';
      lead.next_action_date = null;
      addSuppression({
        lead_id: lead.lead_id, target_number: tn, company_name: lead.company_name,
        phone: lead.decision_maker_phone ?? undefined, email: normalizeEmail(lead.decision_maker_email) ?? undefined,
        reason: lead.suppression_reason, suppressed_at: now, source: `whatsapp:log (${by})`,
      });
      break;
  }
  const notes = str(args, 'notes');
  if (notes) lead.notes = `${lead.notes ? `${lead.notes}\n` : ''}[${today} whatsapp/${by}] ${notes}`;
  lead.updated_at = now;
  saveLeads(leads);

  const eventType = ({ APPROVED: 'WHATSAPP_APPROVED', REJECTED: 'WHATSAPP_REJECTED', SENT: 'WHATSAPP_SENT', REPLIED: 'REPLY_RECEIVED', OPT_OUT: 'OPT_OUT' } as const)[status];
  logEvent({ lead_id: lead.lead_id, target_number: tn, company_name: lead.company_name, event_type: eventType, channel: 'WHATSAPP', actor: by, payload: { status } });
  console.log(`✅ ${tn} ${lead.company_name}: WhatsApp ${status}`);
  generateWhatsAppQueue();
}

if (process.argv[1]?.endsWith('whatsapp-log.ts')) {
  runCli(() => logWhatsApp(process.argv.slice(2)));
}
