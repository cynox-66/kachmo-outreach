/**
 * File adapter for the direct Titan send guard (core/email-ledger/send-guard.ts). Everything here FAILS CLOSED:
 * a missing or malformed suppression list, email ledger, lead database or scheduled queue throws before any email
 * is sent or drafted, and so does a local repository known to be behind origin (the cron may have sent since).
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { loadLeads, loadSuppression, paths } from './store.js';
import { readScheduledQueue, commitsBehindUpstream } from './email-state.js';
import { effectiveCutoverPhase } from './cutover.js';
import { parseTrackerContent } from '../../core/email-ledger/tracker.js';
import { applyLedgerSendUpdate } from '../../core/email-ledger/ledger-update.js';
import type { SendGuardInput, OutboundEmailKind } from '../../core/email-ledger/send-guard.js';

export function loadSendGuardInput(): { input: SendGuardInput; warnings: string[] } {
  const p = paths();
  const warnings: string[] = [];

  const suppression = loadSuppression(); // throws when missing, unreadable or malformed
  // After cutover this file is a derived artifact and Postgres is canonical. Parsing it proves nothing about whether
  // it is current, so a send requires the ADR-010 verification (artifact vs Postgres, plus the queue preflight) to
  // pass first. There is no flag to skip it.
  if (effectiveCutoverPhase() === 'POST_CUTOVER') requireVerifiedSuppression();

  if (!existsSync(p.tracker)) throw new Error(`Email ledger missing: ${p.tracker}. Refusing to send without it.`);
  const ledger = parseTrackerContent(readFileSync(p.tracker, 'utf-8'));
  if (ledger.size === 0) throw new Error(`Email ledger ${p.tracker} contains no batch rows. Refusing to send: duplicates cannot be checked.`);

  const leads = loadLeads(); // throws when missing or malformed
  const scheduledQueue = readScheduledQueue(p.scheduledQueue); // throws when malformed

  const behind = commitsBehindUpstream();
  if (behind !== null && behind > 0) {
    throw new Error(`Local repository is ${behind} commit(s) behind origin (as of the last git fetch). The GitHub cron may have sent since; pull before sending.`);
  }
  if (behind === null) {
    warnings.push('Could not tell whether this checkout is behind origin (no git upstream). Make sure OUTREACH_TRACKER.md is current before sending.');
  }
  return { input: { suppression, leads, ledger, scheduledQueue }, warnings };
}

/** Runs `npm --prefix os run suppression:verify` in this workspace; anything but a clean exit refuses the send. */
function requireVerifiedSuppression(): void {
  const r = spawnSync('npm', ['--prefix', 'os', 'run', '--silent', 'suppression:verify'], { cwd: process.cwd(), stdio: 'inherit' });
  if (r.status !== 0) {
    throw new Error(
      'POST_CUTOVER: database/suppression.json could not be verified against Postgres (npm --prefix os run suppression:verify ' +
        `${r.error ? `could not run: ${r.error.message}` : `exited ${r.status}`}). Refusing to send.`
    );
  }
}

/** Writes the ledger transition for one successful send (atomic replace). Returns the number of rows updated. */
export function recordSuccessfulSend(targetNumber: string, kind: OutboundEmailKind, sentDate: string): number {
  const trackerPath = paths().tracker;
  const { content, updated } = applyLedgerSendUpdate(readFileSync(trackerPath, 'utf-8'), targetNumber, kind, sentDate);
  if (updated > 0) {
    const tmp = join(dirname(trackerPath), `.tmp_tracker_${process.pid}_${Date.now()}.md`);
    writeFileSync(tmp, content, 'utf-8');
    renameSync(tmp, trackerPath);
  }
  return updated;
}
