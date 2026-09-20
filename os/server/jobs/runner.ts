import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../db/schema/index';
import { recordAudit } from '../audit/audit';
import type { Db } from '../leads/locks';

/**
 * THE JOB RUNNER (Phase E, ADR-033).
 *
 * Recurring maintenance that runs on a schedule must be safe to run twice, safe to crash, and visible afterwards.
 * This gives it those three properties and nothing else — there is no queue, no worker pool and no in-process timer:
 * a job is a command someone (or a committed workflow) invokes.
 *
 *   IDEMPOTENT   the key is `<job>:<period>` and is unique in the ledger. Work already SUCCEEDED is skipped.
 *   CRASH-SAFE   a claim carries a lease; a RUNNING row whose lease has expired is ABANDONED and may be retried.
 *   BOUNDED      a FAILED key is retried on later invocations up to MAX_ATTEMPTS, then left for a person.
 *   OBSERVABLE   every outcome is a row and an audit event, carrying counts — never lead data.
 *
 * Jobs never touch leads, suppression, outreach or Titan. What each job may write is declared by the job itself.
 */

export const MAX_ATTEMPTS = 3;
export const DEFAULT_LEASE_MS = 30 * 60 * 1000;

export type JobOutcome = 'SUCCEEDED' | 'FAILED' | 'SKIPPED_DONE' | 'SKIPPED_RUNNING' | 'SKIPPED_EXHAUSTED';

export interface JobResult {
  job: string;
  key: string;
  outcome: JobOutcome;
  attempt: number;
  summary: Record<string, unknown>;
  error: string | null;
}

export interface RunJobOptions {
  job: string;
  /** The period this run covers; with the job name it forms the idempotency key. */
  period: string;
  actor: string;
  leaseMs?: number;
  now?: () => Date;
  /** The work. Returns a summary of counts; throws to fail the run. */
  work: () => Promise<Record<string, unknown>>;
}

type JobRow = typeof schema.jobRun.$inferSelect;

/** Claims the key, or explains why this invocation must not do the work. */
async function claim(db: Db, key: string, opts: RunJobOptions, now: Date): Promise<{ claimed: JobRow } | { skip: JobOutcome; row: JobRow }> {
  const lease = new Date(now.getTime() + (opts.leaseMs ?? DEFAULT_LEASE_MS));
  const [fresh] = await db
    .insert(schema.jobRun)
    .values({ job: opts.job, idempotencyKey: key, status: 'RUNNING', attempt: 1, startedAt: now, leaseUntil: lease, actorLabel: opts.actor })
    .onConflictDoNothing()
    .returning();
  if (fresh) return { claimed: fresh };

  const [existing] = await db.select().from(schema.jobRun).where(eq(schema.jobRun.idempotencyKey, key));
  if (existing.status === 'SUCCEEDED') return { skip: 'SKIPPED_DONE', row: existing };
  if (existing.status === 'RUNNING' && existing.leaseUntil > now) return { skip: 'SKIPPED_RUNNING', row: existing };
  if (existing.attempt >= MAX_ATTEMPTS) return { skip: 'SKIPPED_EXHAUSTED', row: existing };

  // A crashed run (expired lease) or an earlier failure: take it over, conditional on the row not having moved.
  const [retried] = await db
    .update(schema.jobRun)
    .set({ status: 'RUNNING', attempt: existing.attempt + 1, startedAt: now, finishedAt: null, leaseUntil: lease, actorLabel: opts.actor, error: null })
    .where(and(eq(schema.jobRun.id, existing.id), eq(schema.jobRun.attempt, existing.attempt), eq(schema.jobRun.status, existing.status)))
    .returning();
  if (!retried) {
    const [current] = await db.select().from(schema.jobRun).where(eq(schema.jobRun.id, existing.id));
    return { skip: 'SKIPPED_RUNNING', row: current };
  }
  return { claimed: retried };
}

export async function runJob(db: Db, opts: RunJobOptions): Promise<JobResult> {
  if (!opts.actor.trim()) throw new Error('A job run must name who or what ran it.');
  const now = (opts.now ?? (() => new Date()))();
  const key = `${opts.job}:${opts.period}`;
  const claimed = await claim(db, key, opts, now);

  if ('skip' in claimed) {
    return { job: opts.job, key, outcome: claimed.skip, attempt: claimed.row.attempt, summary: (claimed.row.summary as Record<string, unknown>) ?? {}, error: claimed.row.error };
  }

  const row = claimed.claimed;
  try {
    const summary = await opts.work();
    await db.update(schema.jobRun).set({ status: 'SUCCEEDED', finishedAt: new Date(), summary }).where(eq(schema.jobRun.id, row.id));
    await audit(db, opts.actor, 'job.succeeded', { job: opts.job, key, attempt: row.attempt, ...summary });
    return { job: opts.job, key, outcome: 'SUCCEEDED', attempt: row.attempt, summary, error: null };
  } catch (e) {
    const error = (e as Error).message.slice(0, 1000);
    await db.update(schema.jobRun).set({ status: 'FAILED', finishedAt: new Date(), error }).where(eq(schema.jobRun.id, row.id));
    await audit(db, opts.actor, 'job.failed', { job: opts.job, key, attempt: row.attempt, error, retriesLeft: Math.max(0, MAX_ATTEMPTS - row.attempt) });
    return { job: opts.job, key, outcome: 'FAILED', attempt: row.attempt, summary: {}, error };
  }
}

async function audit(db: Db, actor: string, action: 'job.succeeded' | 'job.failed', metadata: Record<string, unknown>): Promise<void> {
  try {
    await recordAudit(db, { actor: { userId: null, label: actor }, action, target: { type: 'job', id: String(metadata.key) }, metadata });
  } catch {
    // The ledger row is the record of truth for a run; an audit failure must not turn a completed job into a crash.
  }
}

/** The most recent run of each job, for the operator panel and `jobs:status`. */
export async function jobStatus(db: Db): Promise<Array<{ job: string; status: string; attempt: number; startedAt: Date; finishedAt: Date | null; summary: Record<string, unknown>; error: string | null; key: string }>> {
  const rows = await db
    .select()
    .from(schema.jobRun)
    .where(sql`(${schema.jobRun.job}, ${schema.jobRun.startedAt}) in (select job, max(started_at) from job_run group by job)`);
  return rows
    .map(r => ({ job: r.job, status: r.status, attempt: r.attempt, startedAt: r.startedAt, finishedAt: r.finishedAt, summary: (r.summary as Record<string, unknown>) ?? {}, error: r.error, key: r.idempotencyKey }))
    .sort((a, b) => a.job.localeCompare(b.job));
}
