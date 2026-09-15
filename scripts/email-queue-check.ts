import { loadLeads, loadSuppression, paths } from './lib/store.js';
import { parseTracker, readScheduledQueue } from './lib/email-state.js';
import { fail, runCli } from './lib/cli.js';
import { findEmailQueueIssues, type EmailQueueIssue } from '../core/email-ledger/queue-check.js';

export type { EmailQueueIssue };

/**
 * READ-ONLY pre-push guard for scheduled-queue.json. The GitHub cron does not run this, so it only
 * protects a queue if someone runs it before pushing a newly staged batch. Rules: core/email-ledger/queue-check.ts.
 */
export function checkEmailQueue(): { entries: number; issues: EmailQueueIssue[] } {
  const p = paths();
  const scheduled = readScheduledQueue(p.scheduledQueue);
  const issues = findEmailQueueIssues(scheduled, loadLeads(), loadSuppression(), parseTracker(p.tracker));
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
