import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrackerContent, scheduledQueueFromJson, type TrackerRow, type ScheduledEmail } from '@kachmo/core/email-ledger/tracker.js';

/**
 * The Titan email ledger, READ ONLY, in every phase (ADR-009, ADR-015).
 *
 * Titan owns email send state. The Outbound OS reads OUTREACH_TRACKER.md and scheduled-queue.json to decide what it
 * may do (a lead that replied "no" is blocked; a follow-up is Titan's to record) and never writes either file.
 *
 * Deliberately free of `server-only`, so the operator CLIs (re-evaluation, revert) read the ledger through exactly
 * the same code the application does.
 */

/** Repository root — `Clients/mails`, two levels above `os/server/repo`. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const TITAN_FILES = { tracker: 'OUTREACH_TRACKER.md', scheduledQueue: 'scheduled-queue.json' } as const;

export interface TitanState {
  tracker: Map<string, TrackerRow>;
  scheduled: ScheduledEmail[];
  warnings: string[];
}

export function readTitanState(root: string = REPO_ROOT): TitanState {
  const warnings: string[] = [];
  const read = (rel: string): string | null => {
    const p = join(root, rel);
    return existsSync(p) ? readFileSync(p, 'utf-8') : null;
  };

  let tracker = new Map<string, TrackerRow>();
  const trackerRaw = read(TITAN_FILES.tracker);
  if (trackerRaw === null) warnings.push(`${TITAN_FILES.tracker} is not present; email ledger state is unavailable.`);
  else tracker = parseTrackerContent(trackerRaw);

  let scheduled: ScheduledEmail[] = [];
  const queueRaw = read(TITAN_FILES.scheduledQueue);
  if (queueRaw === null) warnings.push(`${TITAN_FILES.scheduledQueue} is not present; the production email queue is unavailable.`);
  else {
    try {
      scheduled = scheduledQueueFromJson(JSON.parse(queueRaw), TITAN_FILES.scheduledQueue);
    } catch (e) {
      warnings.push(`${TITAN_FILES.scheduledQueue} is unreadable: ${(e as Error).message}`);
    }
  }
  return { tracker, scheduled, warnings };
}

/** The ledger status of a target number, or null — the single accessor every write path uses. */
export const ledgerLookup = (tracker: Map<string, TrackerRow>) => (targetNumber: string): string | null => tracker.get(targetNumber)?.status ?? null;
