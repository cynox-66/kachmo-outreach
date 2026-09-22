import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asc } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { KachmoLead, SuppressionEntry } from '@kachmo/core/leads/schema.js';
import * as schema from '../db/schema/index';
import { readCanonicalSuppression } from './publish-suppression';
import { evaluateDispatchPreflight, type PreflightResult } from './preflight-rules';

/**
 * DISPATCH PREFLIGHT — the queue the cron is about to send, checked against CANONICAL Postgres.
 *
 * Artifact verification proves database/suppression.json holds every active Postgres suppression. It cannot prove
 * the dispatcher will honour them: the GitHub Actions dispatcher script matches only target_number, email and domain, and never
 * reads lead state at all. So an entry keyed by lead_id or phone alone, or a lead marked DO_NOT_CONTACT / OPT_OUT in
 * Postgres with no suppression row, would verify IN_SYNC and still be emailed.
 *
 * This closes that gap without touching the dispatcher. The rule itself is `evaluateDispatchPreflight` in
 * `preflight-rules.ts` (pure, shared with the application — ADR-036); this module reads the same workspace files the
 * dispatcher reads in the next step, plus canonical Postgres, so what it approves is what gets sent.
 */
export { evaluateDispatchPreflight, type PreflightFinding, type PreflightResult, type PreflightInput } from './preflight-rules';

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export async function runDispatchPreflight(db: Db, root: string): Promise<PreflightResult> {
  const read = (rel: string) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf-8') : null);
  let leads: KachmoLead[] | null = null;
  let activeSuppression: SuppressionEntry[] | null = null;
  try {
    leads = (await db.select().from(schema.lead).orderBy(asc(schema.lead.targetNumber))).map(r => r.record as KachmoLead);
    activeSuppression = (await readCanonicalSuppression(db)).active;
  } catch {
    leads = null;
    activeSuppression = null;
  }
  return evaluateDispatchPreflight({ queueRaw: read('scheduled-queue.json'), trackerRaw: read('OUTREACH_TRACKER.md'), leads, activeSuppression });
}
