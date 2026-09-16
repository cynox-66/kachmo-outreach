import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc } from 'drizzle-orm';
import type { KachmoLead, SuppressionEntry, AnalyticsEvent } from '@kachmo/core/leads/schema.js';
import { parseTrackerContent, scheduledQueueFromJson, type TrackerRow, type ScheduledEmail } from '@kachmo/core/email-ledger/tracker.js';
import { validateLeadDatabase } from '@kachmo/core/leads/validation.js';
import * as schema from '../db/schema/index';
import { getServer } from '../auth/instance';
import { resolveCutoverPhase, type CutoverPhase } from './phase';
import { suppressionEntryFromRow, analyticsEventFromRow } from '../db/migration/transform';

/**
 * THE CANONICAL READ LAYER.
 *
 * One interface, two backends, chosen by the declared cutover phase (ADR-009):
 *
 *   PRE_CUTOVER / CUTOVER_WINDOW  →  the committed JSON store, READ ONLY
 *   POST_CUTOVER                  →  hosted Postgres
 *
 * The application above this line never knows which it is talking to, so cutover is a configuration change rather
 * than a rewrite. Nothing here writes: in PRE_CUTOVER the CLI owns every lead write, and this layer physically
 * cannot modify the JSON files.
 *
 * The Titan email ledger is read from its files in EVERY phase, because Titan owns email send state in every phase.
 */

/** Repository root — `Clients/mails`, two levels above `os/server/repo`. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const CANONICAL_FILES = {
  leads: 'database/kachmo_leads.json',
  suppression: 'database/suppression.json',
  events: 'analytics/events.jsonl',
  tracker: 'OUTREACH_TRACKER.md',
  scheduledQueue: 'scheduled-queue.json',
} as const;

export interface CanonicalSnapshot {
  phase: CutoverPhase;
  /** Which store the leads actually came from, so the UI can state it rather than imply it. */
  source: 'GIT_JSON' | 'POSTGRES';
  leads: KachmoLead[];
  suppression: SuppressionEntry[];
  events: AnalyticsEvent[];
  /** Titan's email ledger, read-only, in every phase. */
  tracker: Map<string, TrackerRow>;
  scheduled: ScheduledEmail[];
  /** Non-fatal problems worth showing the operator (a missing optional file, an unreadable ledger). */
  warnings: string[];
}

const readIfPresent = (rel: string): string | null => {
  const p = join(REPO_ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf-8') : null;
};

/** The Titan ledger and production queue, read from disk. Never written, in any phase. */
function readTitanState(): { tracker: Map<string, TrackerRow>; scheduled: ScheduledEmail[]; warnings: string[] } {
  const warnings: string[] = [];
  let tracker = new Map<string, TrackerRow>();
  const trackerRaw = readIfPresent(CANONICAL_FILES.tracker);
  if (trackerRaw === null) warnings.push(`${CANONICAL_FILES.tracker} is not present; email ledger state is unavailable.`);
  else tracker = parseTrackerContent(trackerRaw);

  let scheduled: ScheduledEmail[] = [];
  const queueRaw = readIfPresent(CANONICAL_FILES.scheduledQueue);
  if (queueRaw === null) warnings.push(`${CANONICAL_FILES.scheduledQueue} is not present; the production email queue is unavailable.`);
  else {
    try {
      scheduled = scheduledQueueFromJson(JSON.parse(queueRaw), CANONICAL_FILES.scheduledQueue);
    } catch (e) {
      warnings.push(`${CANONICAL_FILES.scheduledQueue} is unreadable: ${(e as Error).message}`);
    }
  }
  return { tracker, scheduled, warnings };
}

/**
 * Reads the committed JSON store with the engine's own validation. Fails closed: a malformed lead database throws
 * rather than rendering a partial list, because a page showing 80 of 120 leads is worse than a page showing an error.
 */
function readJsonStore(): Pick<CanonicalSnapshot, 'leads' | 'suppression' | 'events'> {
  const leadsRaw = readIfPresent(CANONICAL_FILES.leads);
  if (leadsRaw === null) throw new Error(`Canonical lead store missing at ${CANONICAL_FILES.leads}.`);
  const validated = validateLeadDatabase(JSON.parse(leadsRaw));
  if (!validated.ok) {
    throw new Error(`Canonical lead store is malformed; refusing to display a partial database:\n  - ${validated.problems.slice(0, 10).join('\n  - ')}`);
  }

  const suppressionRaw = readIfPresent(CANONICAL_FILES.suppression);
  if (suppressionRaw === null) throw new Error(`Suppression list missing at ${CANONICAL_FILES.suppression}; refusing to show outreach state without it.`);
  const suppression = JSON.parse(suppressionRaw) as SuppressionEntry[];
  if (!Array.isArray(suppression)) throw new Error(`${CANONICAL_FILES.suppression} is not a JSON array.`);

  const eventsRaw = readIfPresent(CANONICAL_FILES.events) ?? '';
  const events: AnalyticsEvent[] = eventsRaw
    .split('\n')
    .filter(l => l.trim())
    .flatMap(l => {
      try {
        return [JSON.parse(l) as AnalyticsEvent];
      } catch {
        return [];
      }
    });

  return { leads: validated.leads, suppression, events };
}

async function readPostgres(): Promise<Pick<CanonicalSnapshot, 'leads' | 'suppression' | 'events'>> {
  const { db } = getServer();
  const leadRows = await db.select().from(schema.lead).orderBy(asc(schema.lead.targetNumber));
  const supRows = await db.select().from(schema.suppressionEntry).orderBy(asc(schema.suppressionEntry.sequence));
  const evRows = await db.select().from(schema.analyticsEvent).orderBy(asc(schema.analyticsEvent.sequence));
  return {
    leads: leadRows.map(r => r.record as KachmoLead),
    suppression: supRows.map(suppressionEntryFromRow),
    events: evRows.map(analyticsEventFromRow),
  };
}

/**
 * The whole canonical picture for one request.
 *
 * 120 leads is small enough that reading the lot and deriving in memory is both correct and fast; the repository
 * boundary is what matters, so that swapping in indexed, paginated Postgres queries later changes only this file.
 */
export async function loadCanonical(env: Record<string, string | undefined> = process.env): Promise<CanonicalSnapshot> {
  const phase = resolveCutoverPhase(env);
  const titan = readTitanState();
  const usePostgres = phase === 'POST_CUTOVER';
  const core = usePostgres ? await readPostgres() : readJsonStore();
  return {
    phase,
    source: usePostgres ? 'POSTGRES' : 'GIT_JSON',
    ...core,
    tracker: titan.tracker,
    scheduled: titan.scheduled,
    warnings: titan.warnings,
  };
}

/** The email-ledger status for a target number, or null. The single accessor the services use. */
export const ledgerStatusOf = (snapshot: CanonicalSnapshot) => (targetNumber: string): string | null =>
  snapshot.tracker.get(targetNumber)?.status ?? null;
