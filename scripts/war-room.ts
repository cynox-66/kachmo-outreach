import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { safeWriteJson } from './lib/safe-io.js';
import type { KachmoLead } from './lib/schema.js';
import { loadLeads, loadSuppression, paths } from './lib/store.js';
import { outreachBlock } from './lib/contact.js';
import { parseTracker, readScheduledQueue, commitsBehindUpstream, type ScheduledEmail } from './lib/email-state.js';
import { priorityLabel } from './lib/text.js';
import { checkEmailQueue } from './email-queue-check.js';
import { findInvariantViolations } from './lib/invariants.js';
import { todayIst } from './lib/geo.js';
import { runCli } from './lib/cli.js';
import { generateCallingQueue } from './queue-calls.js';
import { generateWhatsAppQueue } from './queue-whatsapp.js';
import { generateResearchQueue } from './leads-research-queue.js';

export interface WarRoomSummary {
  date: string;
  generated_at: string;
  alerts: string[];
  aadi: { calls: string[]; follow_ups_due: string[]; whatsapp_to_send: string[]; whatsapp_to_approve: string[] };
  dev: { email_follow_ups_due: string[]; replies_to_answer: string[]; positive_without_meeting: string[]; scheduled_emails_local: string[]; next_email_candidates: string[]; follow_ups_due: string[] };
  pipeline: { meetings_booked: string[]; proposals_out: string[]; won: string[] };
  research_next: string[];
  lead_base: Record<string, number>;
}

const label = (l: Pick<KachmoLead, 'target_number' | 'company_name'>) => `${l.target_number} ${l.company_name}`;

export function runWarRoom(): WarRoomSummary {
  const p = paths();
  const today = todayIst();
  const leads = loadLeads();
  const suppression = loadSuppression();
  const tracker = parseTracker(p.tracker);
  const byTn = new Map(leads.map(l => [l.target_number, l]));
  const blocked = (l?: KachmoLead) => !!l && outreachBlock(l, suppression, tracker.get(l.target_number)?.status ?? null).blocked;
  const alerts: string[] = [];

  const behind = commitsBehindUpstream();
  if (behind && behind > 0) {
    alerts.push(
      `Local repo is ${behind} commit(s) behind origin (as of the last git fetch). The cron pushes queue/tracker updates, so local email state is stale. ` +
        `Pull before trusting email numbers. Do NOT run send:titan or dispatch:cron locally until you have.`
    );
  }

  let scheduled: ScheduledEmail[] = [];
  try {
    scheduled = readScheduledQueue(p.scheduledQueue);
    alerts.push(...checkEmailQueue().issues.filter(i => i.blocking).map(i => i.message));
  } catch (e) {
    alerts.push(`scheduled-queue.json is unreadable: ${(e as Error).message}`);
  }
  const violations = findInvariantViolations(leads);
  if (violations.length) alerts.push(`Lead database has ${violations.length} invariant violation(s): ${violations.slice(0, 3).join('; ')}`);

  const calls = generateCallingQueue();
  const wa = generateWhatsAppQueue();
  const research = generateResearchQueue();

  const due = (d?: string | null) => !!d && d <= today;
  const followUps = leads.filter(l => due(l.next_action_date) && !blocked(l) && l.research_state !== 'DISQUALIFIED');
  const trackerRows = [...tracker.values()];

  const summary: WarRoomSummary = {
    date: today,
    generated_at: new Date().toISOString(),
    alerts,
    aadi: {
      calls: calls.cards.map(c => `${c.target_number} ${c.company_name} (${c.decision_maker_name})`),
      follow_ups_due: followUps.filter(l => l.owner === 'AADI').map(l => `${label(l)}: ${l.next_action} (due ${l.next_action_date})`),
      whatsapp_to_send: wa.items.filter(i => i.status === 'APPROVED').map(i => `${i.target_number} ${i.company_name}`),
      whatsapp_to_approve: wa.items.filter(i => i.status === 'PENDING_HUMAN_REVIEW').map(i => `${i.target_number} ${i.company_name}`),
    },
    dev: {
      email_follow_ups_due: trackerRows
        .filter(r => r.status === 'SENT' && due(r.follow_up_due) && !blocked(byTn.get(r.target_number)) && !byTn.get(r.target_number)?.email_follow_up_sent_at)
        .map(r => `${r.target_number} ${byTn.get(r.target_number)?.company_name ?? ''} (due ${r.follow_up_due})`),
      replies_to_answer: trackerRows.filter(r => r.status === 'REPLIED_WARM' || r.status === 'REPLIED_NOT_NOW').map(r => `${r.target_number} ${byTn.get(r.target_number)?.company_name ?? ''} (${r.status})`),
      positive_without_meeting: leads.filter(l => l.response_status === 'REPLIED_POSITIVE' && !l.meeting_status && !l.deal_stage).map(label),
      scheduled_emails_local: scheduled.map(s => `${s.targetNumber} ${s.companyName}`),
      next_email_candidates: leads
        .filter(l => l.research_state === 'OUTREACH_READY' && l.recommended_channel === 'EMAIL')
        .sort((a, b) => (b.kachmo_score ?? -1) - (a.kachmo_score ?? -1))
        .slice(0, 5)
        .map(l => `${label(l)}: ${priorityLabel(l.lead_priority, l.priority_confidence)}`),
      follow_ups_due: followUps.filter(l => l.owner !== 'AADI').map(l => `${label(l)}: ${l.next_action} (due ${l.next_action_date})`),
    },
    pipeline: {
      meetings_booked: leads.filter(l => l.meeting_status === 'BOOKED').map(l => `${label(l)}${l.next_action_date ? ` on ${l.next_action_date}` : ''}`),
      proposals_out: leads.filter(l => l.proposal_status === 'SENT' && !l.deal_stage).map(l => `${label(l)}${l.deal_value ? ` (${l.deal_value})` : ''}`),
      won: leads.filter(l => l.deal_stage === 'WON').map(l => `${label(l)}${l.deal_value ? ` (${l.deal_value})` : ''}`),
    },
    research_next: research.items.slice(0, 5).map(i => `${i.target_number} ${i.company} [${i.priority}${i.priority_confidence === 'PROVISIONAL' ? ' prov.' : ''}]: ${i.specific_research_tasks[0].task}`),
    lead_base: {
      total: leads.length,
      outreach_ready: leads.filter(l => l.research_state === 'OUTREACH_READY').length,
      qualified: leads.filter(l => l.research_state === 'QUALIFIED').length,
      research_required: leads.filter(l => l.research_state === 'RESEARCH_REQUIRED').length,
      disqualified: leads.filter(l => l.research_state === 'DISQUALIFIED').length,
      a_or_a_plus: leads.filter(l => l.lead_priority === 'A+' || l.lead_priority === 'A').length,
      a_or_a_plus_provisional: leads.filter(l => (l.lead_priority === 'A+' || l.lead_priority === 'A') && l.priority_confidence === 'PROVISIONAL').length,
    },
  };
  safeWriteJson(p.warRoomJson, summary);

  const list = (items: string[], empty = 'None.') => (items.length ? items.map(i => `- ${i}`) : [`- ${empty}`]);
  const lb = summary.lead_base;
  const md = [
    `# War Room: ${today}`,
    '',
    `> Generated ${summary.generated_at}. Regenerate every morning: \`npm run war-room\`.`,
    '',
    '## ⚠️ Alerts',
    ...list(alerts),
    '',
    '## Aadi',
    `**Calls (${summary.aadi.calls.length}):** see AADI_DAILY_CALLS.md`,
    ...list(summary.aadi.calls.slice(0, 8), 'No callable leads (phones need a recorded source; see RESEARCH_QUEUE.md).'),
    '',
    '**Follow-ups due:**',
    ...list(summary.aadi.follow_ups_due),
    '',
    `**WhatsApp:** ${summary.aadi.whatsapp_to_send.length} approved to send by hand, ${summary.aadi.whatsapp_to_approve.length} awaiting approval (WHATSAPP_QUEUE.md)`,
    '',
    '## Dev',
    '**Email follow-ups due (OUTREACH_TRACKER.md).** After sending one: `npm run pipeline:log -- --lead=<n> --stage=FOLLOW_UP_SENT`',
    ...list(summary.dev.email_follow_ups_due),
    '',
    '**Replies to answer:**',
    ...list(summary.dev.replies_to_answer),
    '',
    '**Positive responses with no meeting yet:**',
    ...list(summary.dev.positive_without_meeting),
    '',
    '**Other follow-ups due:**',
    ...list(summary.dev.follow_ups_due),
    '',
    `**Production email queue (local copy of scheduled-queue.json):** ${scheduled.length} entries${behind ? ' (STALE: see alerts)' : ''}`,
    ...list(summary.dev.scheduled_emails_local),
    '',
    '**Next email candidates (OUTREACH_READY, direct email):**',
    ...list(summary.dev.next_email_candidates),
    '',
    '## Pipeline',
    `- Meetings booked: ${summary.pipeline.meetings_booked.join('; ') || 'none'}`,
    `- Proposals out: ${summary.pipeline.proposals_out.join('; ') || 'none'}`,
    `- Won: ${summary.pipeline.won.join('; ') || 'none'}`,
    '',
    '## Research next (RESEARCH_QUEUE.md)',
    ...summary.research_next.map((r, i) => `${i + 1}. ${r}`),
    '',
    '## Lead base',
    `${lb.total} leads · ${lb.outreach_ready} outreach-ready · ${lb.qualified} qualified · ${lb.research_required} research required · ${lb.disqualified} disqualified`,
    `${lb.a_or_a_plus} rated A/A+ by the heuristic score, ${lb.a_or_a_plus_provisional} of them provisional (research < 60%).`,
    '',
  ].join('\n');
  writeFileSync(resolve(process.cwd(), 'DAILY_WAR_ROOM.md'), md, 'utf-8');

  console.log(`\n⚔️  War room → DAILY_WAR_ROOM.md (${alerts.length} alert(s))`);
  for (const a of alerts) console.log(`   ⚠️  ${a}`);
  return summary;
}

if (process.argv[1]?.endsWith('war-room.ts')) {
  runCli(() => {
    runWarRoom();
  });
}
