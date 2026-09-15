import type { KachmoLead } from './lib/schema.js';
import { loadLeads, loadSuppression, paths } from './lib/store.js';
import { outreachBlock, checkSuppression, normalizeEmail } from './lib/contact.js';
import { parseTracker, readScheduledQueue, EMAIL_SENT_STATUSES } from './lib/email-state.js';
import { fail, runCli } from './lib/cli.js';

export interface EmailQueueIssue {
  target_number: string;
  kind: 'ALREADY_SENT' | 'SUPPRESSED' | 'DUPLICATE_ENTRY' | 'UNKNOWN_TARGET';
  blocking: boolean;
  message: string;
}

/**
 * READ-ONLY pre-push guard for scheduled-queue.json. The GitHub cron does not run this, so it only
 * protects a queue if someone runs it before pushing a newly staged batch.
 */
export function checkEmailQueue(): { entries: number; issues: EmailQueueIssue[] } {
  const p = paths();
  const scheduled = readScheduledQueue(p.scheduledQueue);
  const leads = loadLeads();
  const suppression = loadSuppression();
  const tracker = parseTracker(p.tracker);
  const byTn = new Map(leads.map(l => [l.target_number, l]));
  const issues: EmailQueueIssue[] = [];
  const seenTn = new Set<string>();
  const seenTo = new Set<string>();

  for (const s of scheduled) {
    const name = `${s.targetNumber} ${s.companyName}`;
    const to = normalizeEmail(s.to) ?? s.to;
    if (seenTn.has(s.targetNumber) || seenTo.has(to)) {
      issues.push({ target_number: s.targetNumber, kind: 'DUPLICATE_ENTRY', blocking: true, message: `Duplicate entry in scheduled-queue.json: ${name} (${to}) appears more than once.` });
    }
    seenTn.add(s.targetNumber);
    seenTo.add(to);

    const row = tracker.get(s.targetNumber);
    if (row && EMAIL_SENT_STATUSES.has(row.status)) {
      issues.push({ target_number: s.targetNumber, kind: 'ALREADY_SENT', blocking: true, message: `Duplicate-send risk: scheduled-queue.json still holds ${name}, but OUTREACH_TRACKER.md marks it ${row.status}.` });
    }

    const lead = byTn.get(s.targetNumber);
    let block: { blocked: boolean; reason: string | null };
    if (lead) {
      block = outreachBlock({ ...lead, decision_maker_email: s.to }, suppression, row?.status ?? null);
    } else {
      const probe = { target_number: s.targetNumber, lead_id: '', website_url: '', decision_maker_email: s.to } as unknown as KachmoLead;
      const r = checkSuppression(probe, suppression);
      block = { blocked: r.suppressed, reason: r.reason };
      issues.push({ target_number: s.targetNumber, kind: 'UNKNOWN_TARGET', blocking: false, message: `${name} is not in the lead database (suppression still checked by email/domain).` });
    }
    if (block.blocked) {
      issues.push({ target_number: s.targetNumber, kind: 'SUPPRESSED', blocking: true, message: `Suppressed recipient in the production email queue: ${name} (${block.reason}). The cron does not read V2 suppression. Remove it from scheduled-queue.json and push before the next run.` });
    }
  }
  return { entries: scheduled.length, issues };
}

if (process.argv[1]?.endsWith('email-queue-check.ts')) {
  runCli(() => {
    const { entries, issues } = checkEmailQueue();
    console.log(`📬 scheduled-queue.json: ${entries} entr${entries === 1 ? 'y' : 'ies'} checked`);
    for (const i of issues) console.log(`   ${i.blocking ? '⛔' : 'ℹ️ '} ${i.message}`);
    const blocking = issues.filter(i => i.blocking);
    if (blocking.length) fail(`${blocking.length} blocking issue(s). Fix scheduled-queue.json before pushing.`);
    console.log('✅ No blocking issues.');
  });
}
