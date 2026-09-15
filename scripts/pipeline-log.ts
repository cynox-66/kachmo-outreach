import { LOST_REASONS } from './lib/schema.js';
import type { EventType } from './lib/schema.js';
import { loadLeads, saveLeads, loadSuppression, logEvent, findLead, paths } from './lib/store.js';
import { outreachBlock } from './lib/contact.js';
import { parseTracker, EMAIL_SENT_STATUSES } from './lib/email-state.js';
import { todayIst, addDays } from './lib/geo.js';
import { parseArgs, str, oneOf, fail, runCli } from './lib/cli.js';

const STAGES = ['FOLLOW_UP_SENT', 'REPLIED_POSITIVE', 'REPLIED_NOT_NOW', 'NOT_INTERESTED', 'MEETING_BOOKED', 'MEETING_DONE', 'PROPOSAL_SENT', 'WON', 'LOST'] as const;
const CHANNELS = ['EMAIL', 'CALL', 'WHATSAPP', 'LINKEDIN', 'OTHER'] as const;
const NEEDS_CHANNEL = new Set(['REPLIED_POSITIVE', 'REPLIED_NOT_NOW', 'NOT_INTERESTED', 'MEETING_BOOKED']);
const ENGAGING = new Set(['FOLLOW_UP_SENT', 'REPLIED_POSITIVE', 'MEETING_BOOKED', 'MEETING_DONE', 'PROPOSAL_SENT', 'WON']);

const USAGE =
  `Usage: npm run pipeline:log -- --lead=<target|lead_id> --stage=<${STAGES.join('|')}> ` +
  `[--channel=${CHANNELS.join('|')}] [--value="$4,000"] [--reason=${LOST_REASONS.join('|')}] [--date=YYYY-MM-DD] [--by=DEV|AADI] [--notes="..."]`;

/** Sales-stage transitions with enforced ordering: meeting → proposal → won. */
export function logPipeline(argv: string[]): void {
  const args = parseArgs(argv, ['lead', 'stage', 'channel', 'value', 'reason', 'date', 'by', 'notes']);
  const ident = str(args, 'lead');
  const stage = oneOf(str(args, 'stage'), STAGES, 'stage');
  if (!ident || !stage) fail(USAGE);
  const channel = oneOf(str(args, 'channel'), CHANNELS, 'channel');
  const reason = oneOf(str(args, 'reason'), LOST_REASONS, 'reason');
  const by = oneOf(str(args, 'by') ?? 'DEV', ['DEV', 'AADI'] as const, 'by')!;
  const date = str(args, 'date');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('--date must be YYYY-MM-DD');
  if (NEEDS_CHANNEL.has(stage) && !channel) fail(`--stage=${stage} requires --channel (for channel attribution).`);

  const leads = loadLeads();
  const lead = findLead(leads, ident);
  if (!lead) fail(`No lead matches --lead=${ident}.`);
  const tn = lead.target_number;

  if (lead.deal_stage === 'WON' || lead.deal_stage === 'LOST') fail(`${tn} deal is already closed (${lead.deal_stage}).`);
  const ledgerStatus = parseTracker(paths().tracker).get(tn)?.status ?? null;
  const block = outreachBlock(lead, loadSuppression(), ledgerStatus);
  if (block.blocked && ENGAGING.has(stage)) {
    fail(`${tn} is suppressed (${block.reason}). If they re-engaged on their own, remove the suppression deliberately first.`);
  }

  const today = todayIst();
  const value = str(args, 'value');
  let eventType: EventType;
  switch (stage) {
    case 'FOLLOW_UP_SENT':
      if (!EMAIL_SENT_STATUSES.has(ledgerStatus ?? '')) fail(`${tn}: OUTREACH_TRACKER.md does not show a sent email (status: ${ledgerStatus ?? 'none'}).`);
      if (ledgerStatus === 'FOLLOWED_UP') fail(`${tn}: OUTREACH_TRACKER.md already shows FOLLOWED_UP (single-bump protocol).`);
      if (lead.email_follow_up_sent_at) fail(`${tn}: follow-up already sent on ${lead.email_follow_up_sent_at} (single-bump protocol).`);
      lead.email_follow_up_sent_at = today;
      lead.next_action = 'Wait for a reply (no further bumps)';
      lead.next_action_date = null;
      eventType = 'FOLLOW_UP_SENT';
      break;
    case 'REPLIED_POSITIVE':
      lead.response_status = 'REPLIED_POSITIVE';
      lead.lead_temperature = 'HOT';
      lead.next_action = 'Reply and propose a 15-minute call';
      lead.next_action_date = today;
      eventType = 'REPLY_RECEIVED';
      break;
    case 'REPLIED_NOT_NOW':
      lead.response_status = 'REPLIED_NOT_NOW';
      lead.lead_temperature = 'WARM';
      lead.next_action = 'Check in again';
      lead.next_action_date = date ?? addDays(today, 60);
      eventType = 'REPLY_RECEIVED';
      break;
    case 'NOT_INTERESTED':
      lead.response_status = 'NOT_INTERESTED';
      lead.lead_temperature = 'COLD';
      lead.next_action = 'None (not interested)';
      lead.next_action_date = null;
      eventType = 'REPLY_RECEIVED';
      break;
    case 'MEETING_BOOKED':
      lead.meeting_status = 'BOOKED';
      lead.lead_temperature = 'HOT';
      lead.next_action = 'Prepare for the meeting';
      lead.next_action_date = date ?? null;
      eventType = 'MEETING_BOOKED';
      break;
    case 'MEETING_DONE':
      if (lead.meeting_status !== 'BOOKED') fail(`${tn}: no booked meeting recorded. Log MEETING_BOOKED first.`);
      lead.meeting_status = 'DONE';
      lead.next_action = 'Send proposal or follow-up';
      lead.next_action_date = addDays(today, 2);
      eventType = 'MEETING_DONE';
      break;
    case 'PROPOSAL_SENT':
      if (lead.meeting_status !== 'BOOKED' && lead.meeting_status !== 'DONE') fail(`${tn}: no meeting recorded. A proposal requires MEETING_BOOKED or MEETING_DONE first.`);
      lead.proposal_status = 'SENT';
      if (value) lead.deal_value = value;
      lead.next_action = 'Follow up on the proposal';
      lead.next_action_date = addDays(today, 5);
      eventType = 'PROPOSAL_SENT';
      break;
    case 'WON':
      if (lead.proposal_status !== 'SENT') fail(`${tn}: no proposal recorded. WON requires PROPOSAL_SENT first.`);
      lead.deal_stage = 'WON';
      if (value) lead.deal_value = value;
      lead.next_action = 'Kick off the project';
      lead.next_action_date = null;
      eventType = 'DEAL_WON';
      break;
    case 'LOST':
      if (!reason) fail(`--stage=LOST requires --reason=${LOST_REASONS.join('|')}`);
      lead.deal_stage = 'LOST';
      lead.lost_reason = reason;
      lead.next_action = 'None (lost)';
      lead.next_action_date = null;
      eventType = 'DEAL_LOST';
      break;
  }
  if (channel === 'EMAIL' || channel === 'CALL' || channel === 'WHATSAPP') lead.last_contacted_at = lead.last_contacted_at ?? new Date().toISOString();
  const notes = str(args, 'notes');
  if (notes) lead.notes = `${lead.notes ? `${lead.notes}\n` : ''}[${today} ${stage}/${by}] ${notes}`;
  lead.updated_at = new Date().toISOString();
  saveLeads(leads);

  logEvent({
    lead_id: lead.lead_id, target_number: tn, company_name: lead.company_name, event_type: eventType,
    channel: channel ?? (stage === 'FOLLOW_UP_SENT' ? 'EMAIL' : 'OTHER'), actor: by,
    payload: { stage, channel: channel ?? null, value: value ?? null, lost_reason: reason ?? null, archetype_id: lead.archetype_id },
  });
  console.log(`✅ ${tn} ${lead.company_name}: ${stage}. Next: ${lead.next_action}`);
}

if (process.argv[1]?.endsWith('pipeline-log.ts')) {
  runCli(() => logPipeline(process.argv.slice(2)));
}
