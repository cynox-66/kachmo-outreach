import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { safeWriteJson } from './lib/safe-io.js';
import { loadLeads, loadSuppression, paths } from './lib/store.js';
import { parseTracker, readScheduledQueue, commitsBehindUpstream, type ScheduledEmail } from './lib/email-state.js';
import { checkEmailQueue } from './email-queue-check.js';
import { findInvariantViolations } from './lib/invariants.js';
import { todayIst } from './lib/geo.js';
import { runCli } from './lib/cli.js';
import { generateCallingQueue } from './queue-calls.js';
import { generateWhatsAppQueue } from './queue-whatsapp.js';
import { generateResearchQueue } from './leads-research-queue.js';
import { buildWarRoomSummary, staleRepoAlert, type WarRoomSummary } from '../core/reports/war-room.js';

// The war-room derivation lives in core/reports/war-room.ts; this script gathers the inputs and renders the files.
export { buildWarRoomSummary, leadBaseCounts, staleRepoAlert } from '../core/reports/war-room.js';
export type { WarRoomSummary } from '../core/reports/war-room.js';

export function runWarRoom(): WarRoomSummary {
  const p = paths();
  const today = todayIst();
  const leads = loadLeads();
  const alerts: string[] = [];

  const behind = commitsBehindUpstream();
  if (behind && behind > 0) alerts.push(staleRepoAlert(behind));

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

  const summary = buildWarRoomSummary({
    today,
    generatedAt: new Date().toISOString(),
    leads,
    suppression: loadSuppression(),
    tracker: parseTracker(p.tracker),
    scheduled,
    callCards: calls.cards,
    whatsappItems: wa.items,
    researchItems: research.items,
    alerts,
  });
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
