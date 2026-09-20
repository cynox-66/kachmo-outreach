/**
 * THE JOBS (Phase E, ADR-033 / ADR-034).
 *
 * Three bounded maintenance jobs. Between them they write exactly two kinds of row — evidence retrievals (and the
 * links to the claims that cite them) and the job ledger itself. None of them touches a lead, a score, suppression,
 * Titan or any outreach path, and none contacts a prospect.
 *
 *   evidence-refresh   re-fetches sources whose newest successful retrieval has gone stale (ADR-031)
 *   stale-data         counts what has drifted or is waiting: overdue follow-ups, re-derivation due, sources to
 *                      re-check, sources that have given up. Read-only.
 *   weekly-report      the core weekly funnel over canonical state, stored as the run's summary. Read-only.
 */
import { asc, eq } from 'drizzle-orm';
import type { KachmoLead } from '@kachmo/core/leads/schema.js';
import { buildWeeklyReport } from '@kachmo/core/reports/weekly.js';
import { isFollowUpDue } from '@kachmo/core/queues/work-rules.js';
import { outreachBlock } from '@kachmo/core/suppression/match.js';
import * as schema from '../db/schema/index';
import { readTitanState, ledgerLookup } from '../repo/titan-ledger';
import { readSuppressionInTx } from '../leads/mutate';
import { planReevaluation } from '../leads/reevaluate-run';
import { planFetch, runFetch, MAX_ATTEMPTS as FETCH_MAX_ATTEMPTS } from '../evidence/fetch-run';
import { analyticsEventFromRow } from '../db/migration/transform';
import type { Db } from '../leads/locks';
import { runJob, type JobResult } from './runner';

export const JOBS = ['evidence-refresh', 'stale-data', 'weekly-report'] as const;
export type JobName = (typeof JOBS)[number];

export const isJobName = (v: string): v is JobName => (JOBS as readonly string[]).includes(v);

/** What each job may write — asserted by test, so a job cannot quietly grow a new power. */
export const JOB_WRITES: Record<JobName, readonly string[]> = {
  'evidence-refresh': ['evidence_retrieval', 'lead_evidence.retrieval_id', 'job_run', 'audit_event'],
  'stale-data': ['job_run', 'audit_event'],
  'weekly-report': ['job_run', 'audit_event'],
};

const istToday = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
/** The period a run covers. Daily for maintenance; the ISO week for the report. */
export function periodFor(job: JobName, now = new Date()): string {
  if (job !== 'weekly-report') return istToday(now);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const week = Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface JobOptions {
  limit?: number;
  now?: Date;
  /** Injected by tests so the suite never opens a socket. */
  fetchOptions?: Parameters<typeof runFetch>[1]['fetchOptions'];
  sleep?: (ms: number) => Promise<void>;
  freshnessDays?: number;
}

async function evidenceRefresh(db: Db, actor: string, opts: JobOptions): Promise<Record<string, unknown>> {
  const r = await runFetch(db, {
    actor,
    mode: 'REFRESH',
    limit: opts.limit ?? 25,
    now: opts.now,
    freshnessDays: opts.freshnessDays,
    fetchOptions: opts.fetchOptions,
    sleep: opts.sleep,
  });
  return { runId: r.runId, refetched: r.fetched, byOutcome: r.byOutcome };
}

async function staleData(db: Db, _actor: string, opts: JobOptions): Promise<Record<string, unknown>> {
  const now = opts.now ?? new Date();
  const today = istToday(now);
  const ledger = ledgerLookup(readTitanState().tracker);
  const rows = await db.select({ record: schema.lead.record }).from(schema.lead);
  const leads = rows.map(r => r.record as KachmoLead);
  const suppression = await readSuppressionInTx(db);
  const overdue = leads.filter(l => {
    const blocked = outreachBlock(l, suppression, ledger(l.target_number)).blocked;
    return isFollowUpDue(l, today, blocked) && !!l.next_action_date && l.next_action_date < today;
  });
  const plan = await planReevaluation(db, { ledger });

  // Sources a person still owes something, and sources the fetcher has given up on.
  const evidence = await db
    .select({ id: schema.leadEvidence.id, url: schema.leadEvidence.sourceUrl, reviewStatus: schema.leadEvidence.reviewStatus, retrievalId: schema.leadEvidence.retrievalId, sha: schema.evidenceRetrieval.contentSha256 })
    .from(schema.leadEvidence)
    .leftJoin(schema.evidenceRetrieval, eq(schema.evidenceRetrieval.id, schema.leadEvidence.retrievalId));
  const retrievals = await db.select().from(schema.evidenceRetrieval).orderBy(asc(schema.evidenceRetrieval.fetchedAt));
  const latestOk = new Map<string, (typeof retrievals)[number]>();
  const failures = new Map<string, number>();
  for (const r of retrievals) {
    if (r.outcome === 'OK') latestOk.set(r.requestedUrl, r);
    else failures.set(r.requestedUrl, (failures.get(r.requestedUrl) ?? 0) + 1);
  }
  const changed = evidence.filter(e => e.reviewStatus !== 'UNREVIEWED' && e.url && latestOk.get(e.url) && latestOk.get(e.url)!.id !== e.retrievalId && latestOk.get(e.url)!.contentSha256 !== e.sha).length;
  const unreviewed = evidence.filter(e => e.retrievalId && e.reviewStatus === 'UNREVIEWED').length;
  const gaveUp = [...failures.entries()].filter(([url, n]) => n >= FETCH_MAX_ATTEMPTS && !latestOk.has(url)).length;
  const unfetched = await planFetch(db, { mode: 'NEW', limit: 200, now });

  return {
    today,
    overdueFollowUps: overdue.length,
    overdueTargets: overdue.slice(0, 20).map(l => l.target_number),
    leadsNeedingReevaluation: plan.toWrite,
    evidenceAwaitingFirstCheck: unreviewed,
    evidenceNeedingRecheck: changed,
    sourcesNeverFetched: unfetched.toFetch.length,
    sourcesGivenUpOn: gaveUp,
  };
}

async function weeklyReport(db: Db, _actor: string, opts: JobOptions): Promise<Record<string, unknown>> {
  const now = opts.now ?? new Date();
  const leadRows = await db.select({ record: schema.lead.record }).from(schema.lead);
  const eventRows = await db.select().from(schema.analyticsEvent).orderBy(asc(schema.analyticsEvent.sequence));
  const report = buildWeeklyReport({
    today: istToday(now),
    generatedAt: now.toISOString(),
    leads: leadRows.map(r => r.record as KachmoLead),
    events: eventRows.map(analyticsEventFromRow),
    tracker: readTitanState().tracker,
  });
  // Counts only: the funnel and the movement, never a company or a contact.
  return { funnel: report.funnel, week: report.week, conversions: report.conversions, channels: report.channels };
}

const IMPLEMENTATIONS: Record<JobName, (db: Db, actor: string, opts: JobOptions) => Promise<Record<string, unknown>>> = {
  'evidence-refresh': evidenceRefresh,
  'stale-data': staleData,
  'weekly-report': weeklyReport,
};

/** Runs one job under the ledger. The period defaults to today (or this ISO week for the report). */
export async function runNamedJob(db: Db, job: JobName, opts: { actor: string; period?: string } & JobOptions): Promise<JobResult> {
  const now = opts.now ?? new Date();
  return runJob(db, {
    job,
    period: opts.period ?? periodFor(job, now),
    actor: opts.actor,
    now: () => now,
    work: () => IMPLEMENTATIONS[job](db, opts.actor, opts),
  });
}
