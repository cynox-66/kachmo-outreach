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

/**
 * What a queued email will say, for DISPLAY ONLY (ADR-036): the subject and the plain-text body. The HTML part is never
 * read into the application, so it can never be rendered. Nothing here can change what the dispatcher sends.
 */
export interface QueuedEmailPreview {
  targetNumber: string;
  to: string;
  subject: string;
  plainText: string;
  city: string | null;
  country: string | null;
}

export interface TitanState {
  tracker: Map<string, TrackerRow>;
  scheduled: ScheduledEmail[];
  /** Subject and plain text of each queued email, in queue order. */
  previews: QueuedEmailPreview[];
  /** The exact bytes read, so the pure dispatch preflight can judge the same input CI does. */
  raw: { tracker: string | null; queue: string | null };
  warnings: string[];
}

const MAX_PREVIEW_CHARS = 20_000;
const text = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** Reads display fields defensively: the file is Titan's, and anything unexpected is left out rather than trusted. */
export function queuePreviewsFromJson(parsed: unknown): QueuedEmailPreview[] {
  if (!Array.isArray(parsed)) return [];
  return parsed.map((p: Record<string, unknown>) => ({
    targetNumber: String(p?.targetNumber ?? ''),
    to: text(p?.to, 254),
    subject: text(p?.subject, 300),
    plainText: text(p?.plainText, MAX_PREVIEW_CHARS),
    city: text(p?.locationCity, 80) || null,
    country: text(p?.locationCountry, 80) || null,
  }));
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
  let previews: QueuedEmailPreview[] = [];
  const queueRaw = read(TITAN_FILES.scheduledQueue);
  if (queueRaw === null) warnings.push(`${TITAN_FILES.scheduledQueue} is not present; the production email queue is unavailable.`);
  else {
    try {
      const parsed = JSON.parse(queueRaw);
      scheduled = scheduledQueueFromJson(parsed, TITAN_FILES.scheduledQueue);
      previews = queuePreviewsFromJson(parsed);
    } catch (e) {
      warnings.push(`${TITAN_FILES.scheduledQueue} is unreadable: ${(e as Error).message}`);
    }
  }
  return { tracker, scheduled, previews, raw: { tracker: trackerRaw, queue: queueRaw }, warnings };
}

/**
 * When the email records this process can see were captured. In a deployment the ledger and queue files are traced
 * into the build, so they are exactly as fresh as the build (audit A5); `KACHMO_BUILT_AT` is stamped by next.config.
 * Null when unknown (tests, CLIs).
 */
export function ledgerAsOf(env?: Record<string, string | undefined>): string | null {
  // The literal `process.env.KACHMO_BUILT_AT` is what next.config's `env` inlines at build time; keep it literal.
  const v = (env ? env.KACHMO_BUILT_AT : process.env.KACHMO_BUILT_AT)?.trim();
  return v && !Number.isNaN(Date.parse(v)) ? v : null;
}

/** The ledger status of a target number, or null — the single accessor every write path uses. */
export const ledgerLookup = (tracker: Map<string, TrackerRow>) => (targetNumber: string): string | null => tracker.get(targetNumber)?.status ?? null;
