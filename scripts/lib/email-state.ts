/**
 * READ-ONLY view of the production email subsystem (OUTREACH_TRACKER.md + scheduled-queue.json).
 * Nothing in V2 writes these files. The Titan/GitHub Actions pipeline stays authoritative for email.
 * Parsing lives in core/email-ledger/tracker.ts; this module only reads the files.
 */
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { parseTrackerContent, scheduledQueueFromJson, type TrackerRow, type ScheduledEmail } from '../../core/email-ledger/tracker.js';

export { EMAIL_SENT_STATUSES, EMAIL_REPLY_STATUSES, EMAIL_POSITIVE_STATUSES } from '../../core/email-ledger/tracker.js';
export type { TrackerRow, ScheduledEmail };

/** Header-driven parse of every "### Batch N" table. Later sections override earlier ones for the same target. */
export function parseTracker(trackerPath: string): Map<string, TrackerRow> {
  if (!existsSync(trackerPath)) return new Map();
  return parseTrackerContent(readFileSync(trackerPath, 'utf-8'));
}

export function readScheduledQueue(queuePath: string): ScheduledEmail[] {
  if (!existsSync(queuePath)) return [];
  return scheduledQueueFromJson(JSON.parse(readFileSync(queuePath, 'utf-8')), queuePath);
}

/** Commits on the upstream branch not in HEAD, as of the last `git fetch`. null when unknown. */
export function commitsBehindUpstream(cwd: string = process.cwd()): number | null {
  try {
    const out = execSync('git rev-list --count HEAD..@{u}', { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    return Number(out.toString().trim());
  } catch {
    return null;
  }
}
