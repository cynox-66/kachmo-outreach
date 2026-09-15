import type { KachmoLead, SuppressionEntry } from '../leads/schema.js';
import { normalizeEmail } from '../contact/provenance.js';
import { outreachBlock, checkSuppression } from '../suppression/match.js';
import { EMAIL_SENT_STATUSES, type ScheduledEmail, type TrackerRow } from './tracker.js';

export interface EmailQueueIssue {
  target_number: string;
  kind: 'ALREADY_SENT' | 'SUPPRESSED' | 'DUPLICATE_ENTRY' | 'UNKNOWN_TARGET';
  blocking: boolean;
  message: string;
}

/**
 * Pre-dispatch safety review of the production scheduled queue: duplicate entries, already-sent recipients and
 * suppressed recipients. Pure: the caller supplies the queue, leads, suppression list and parsed tracker.
 */
export function findEmailQueueIssues(
  scheduled: ScheduledEmail[],
  leads: KachmoLead[],
  suppression: SuppressionEntry[],
  tracker: Map<string, TrackerRow>
): EmailQueueIssue[] {
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
  return issues;
}
