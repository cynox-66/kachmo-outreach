/**
 * PHASE E — THE JOB LEDGER AND THE MAINTENANCE JOBS.
 *
 * Against in-memory PostgreSQL with the pinned golden dataset and a fake internet. The properties under test are the
 * ones that make a scheduled job safe to leave running: it is idempotent, it survives a crash, it gives up, it only
 * writes what it declares, and it is visible afterwards.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq, sql } from 'drizzle-orm';
import { parseTrackerContent } from '@kachmo/core/email-ledger/tracker.js';
import * as schema from '../server/db/schema/index';
import { createRehearsalDatabase } from '../server/db/rehearsal-db';
import { loadCanonicalSource } from '../server/db/migration/source';
import { importCanonicalSource } from '../server/db/migration/import';
import { permissionsFor } from '../server/authz/permissions';
import type { Actor } from '../server/authz/authorize';
import { runJob, jobStatus, MAX_ATTEMPTS } from '../server/jobs/runner';
import { runNamedJob, periodFor, JOBS, JOB_WRITES, isJobName } from '../server/jobs/jobs';
import { goldenWorkspace } from '../../scripts/__tests__/golden/snapshot.js';

const OS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(OS, '..');

let passed = 0;
const failures: string[] = [];
function assert(cond: unknown, name: string, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 1200)}` : ''}`);
  }
}
const group = (t: string) => console.log(`\n${t}`);

console.log('\n🧰 KACHMO OUTBOUND OS — PHASE E JOBS');

const POST = { KACHMO_CUTOVER_PHASE: 'POST_CUTOVER', KACHMO_APP_WRITES: 'on', DATABASE_URL: 'postgres://localhost:5432/kachmo_test' };
Object.assign(process.env, POST);

const workspace = goldenWorkspace(REPO);
const source = loadCanonicalSource(workspace);
const tracker = parseTrackerContent(readFileSync(join(workspace, 'OUTREACH_TRACKER.md'), 'utf-8'));
const ledger = (tn: string) => tracker.get(tn)?.status ?? null;
const database = await createRehearsalDatabase();
(globalThis as unknown as { __kachmoServer?: unknown }).__kachmoServer = { db: database.db, auth: {} };
const db = database.db;
await importCanonicalSource(db, source, 'PHASE-E-TEST');
await db.insert(schema.user).values({ id: 'u-owner', name: 'Dev Jaiswal', email: 'u-owner@kachmo.test' });
await db.insert(schema.userRole).values({ userId: 'u-owner', role: 'OWNER' });
const { bindEngineActor } = await import('../server/leads/actor-binding');
await bindEngineActor(db, { userEmail: 'u-owner@kachmo.test', engineActor: 'DEV', ownerLabel: 'Dev Jaiswal' });
const owner: Actor = { userId: 'u-owner', name: 'Dev Jaiswal', email: 'u-owner@kachmo.test', roles: ['OWNER'], permissions: permissionsFor(['OWNER']) };
const fakeNet = (pages: Record<string, { status?: number; body?: string }>) => ({
  transport: {
    async resolve() {
      return ['93.184.216.34'];
    },
    async get(url: URL) {
      const p = pages[url.toString()] ?? { status: 404 };
      return { status: p.status ?? 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(p.body ?? ''), truncated: false };
    },
  },
});

// ─────────────────────────────────────────────────────────────────────────────
group('1. The same work is never done twice');
{
  let ran = 0;
  const work = async () => {
    ran++;
    return { did: ran };
  };
  const first = await runJob(db, { job: 'test-job', period: '2026-09-20', actor: 'SCHEDULED_JOB', work });
  const second = await runJob(db, { job: 'test-job', period: '2026-09-20', actor: 'SCHEDULED_JOB', work });
  assert(first.outcome === 'SUCCEEDED' && ran === 1, 'the first invocation does the work');
  assert(second.outcome === 'SKIPPED_DONE' && ran === 1, 'a repeat of the same key does nothing at all', second);
  const nextDay = await runJob(db, { job: 'test-job', period: '2026-09-21', actor: 'SCHEDULED_JOB', work });
  assert(nextDay.outcome === 'SUCCEEDED' && ran === 2, 'the next period is different work and runs');
  const rows = await db.select().from(schema.jobRun).where(eq(schema.jobRun.job, 'test-job'));
  assert(rows.length === 2 && rows.every(r => r.status === 'SUCCEEDED' && r.finishedAt), 'each run is one ledger row, finished');
  const audits = await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'job.succeeded'));
  assert(audits.length === 2, 'and each is audited once');
}

// ─────────────────────────────────────────────────────────────────────────────
group('2. A crash is recovered; a failure is retried, then left for a person');
{
  // A run that never finished: its lease is in the past, so the next invocation takes it over.
  await db.insert(schema.jobRun).values({ job: 'crashy', idempotencyKey: 'crashy:2026-09-20', status: 'RUNNING', attempt: 1, leaseUntil: new Date(Date.now() - 60_000), actorLabel: 'SCHEDULED_JOB' });
  const taken = await runJob(db, { job: 'crashy', period: '2026-09-20', actor: 'SCHEDULED_JOB', work: async () => ({ ok: true }) });
  assert(taken.outcome === 'SUCCEEDED' && taken.attempt === 2, 'a run whose lease expired is taken over on the next attempt', taken);

  // A run still in flight (lease in the future) is left alone.
  await db.insert(schema.jobRun).values({ job: 'inflight', idempotencyKey: 'inflight:2026-09-20', status: 'RUNNING', attempt: 1, leaseUntil: new Date(Date.now() + 600_000), actorLabel: 'OTHER' });
  let ranInflight = false;
  const busy = await runJob(db, { job: 'inflight', period: '2026-09-20', actor: 'SCHEDULED_JOB', work: async () => ((ranInflight = true), {}) });
  assert(busy.outcome === 'SKIPPED_RUNNING' && !ranInflight, 'a key another process holds is not run concurrently', busy);

  let attempts = 0;
  const failing = () => runJob(db, { job: 'flaky', period: '2026-09-20', actor: 'SCHEDULED_JOB', work: async () => { attempts++; throw new Error('upstream unavailable'); } });
  const r1 = await failing();
  assert(r1.outcome === 'FAILED' && r1.error === 'upstream unavailable', 'a failure is recorded with its reason', r1);
  const r2 = await failing();
  const r3 = await failing();
  assert(r2.outcome === 'FAILED' && r3.outcome === 'FAILED' && attempts === MAX_ATTEMPTS, `it is retried up to ${MAX_ATTEMPTS} attempts`, { attempts });
  const r4 = await failing();
  assert(r4.outcome === 'SKIPPED_EXHAUSTED' && attempts === MAX_ATTEMPTS, 'then it stops retrying and waits for a person', r4);
  const failed = await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'job.failed'));
  assert(failed.length === MAX_ATTEMPTS, 'every failure is audited');

  const tryDb = async (q: ReturnType<typeof sql>) => {
    try {
      await db.execute(q);
      return 'allowed';
    } catch (e) {
      return `${(e as Error).message} ${(e as { cause?: Error }).cause?.message ?? ''}`;
    }
  };
  assert(/never deleted/.test(await tryDb(sql`delete from job_run`)), 'the ledger is never deleted from');
  assert(/never re-run/.test(await tryDb(sql`update job_run set status = 'RUNNING', attempt = attempt + 1 where status = 'SUCCEEDED'`)), 'and completed work can never be reopened under the same key');
}

// ─────────────────────────────────────────────────────────────────────────────
group('3. The jobs do their work, and only what they declare');
{
  const now = new Date();
  const before = {
    leads: await db.select({ sha: schema.lead.recordSha256, v: schema.lead.version }).from(schema.lead).orderBy(asc(schema.lead.targetNumber)),
    suppression: (await db.select().from(schema.suppressionEntry)).length,
    events: (await db.select().from(schema.analyticsEvent)).length,
    evaluations: (await db.select().from(schema.leadEvaluation)).length,
  };

  const stale = await runNamedJob(db, 'stale-data', { actor: 'SCHEDULED_JOB', now });
  assert(stale.outcome === 'SUCCEEDED' && typeof stale.summary.overdueFollowUps === 'number' && typeof stale.summary.leadsNeedingReevaluation === 'number', 'stale-data reports what has drifted or is waiting', stale.summary);
  const weekly = await runNamedJob(db, 'weekly-report', { actor: 'SCHEDULED_JOB', now });
  assert(weekly.outcome === 'SUCCEEDED' && Array.isArray(weekly.summary.funnel), 'weekly-report records the funnel from canonical state', Object.keys(weekly.summary));
  assert(!JSON.stringify(weekly.summary).includes('@'), 'and carries counts, not companies or contacts');

  // evidence-refresh: give it a stale, already-retrieved source to re-fetch.
  const { recordResearch } = await import('../server/leads/commands');
  const [lead] = await db.select().from(schema.lead).where(eq(schema.lead.targetNumber, '111'));
  const url = 'https://studio-e.example/about';
  await recordResearch(db, owner, { leadId: lead.leadId, expectedVersion: lead.version, field: 'commercial-source', value: 'Named in a national design annual', source: url }, { env: POST, ledger });
  const { runFetch } = await import('../server/evidence/fetch-run');
  await runFetch(db, { actor: 'Dev Jaiswal', fetchOptions: fakeNet({ [url]: { body: '<p>original</p>' } }), sleep: async () => {} });
  const afterWrite = await db.select({ sha: schema.lead.recordSha256, v: schema.lead.version }).from(schema.lead).orderBy(asc(schema.lead.targetNumber));

  // A moment after the first retrieval, with a zero-day window: the source counts as stale.
  const later = new Date(Date.now() + 60_000);
  const refresh = await runNamedJob(db, 'evidence-refresh', { actor: 'SCHEDULED_JOB', now: later, freshnessDays: 0, fetchOptions: fakeNet({ [url]: { body: '<p>changed</p>' } }), sleep: async () => {} });
  assert(refresh.outcome === 'SUCCEEDED' && refresh.summary.refetched === 1, 'evidence-refresh re-fetches the stale source', refresh.summary);
  const retrievals = await db.select().from(schema.evidenceRetrieval).where(eq(schema.evidenceRetrieval.requestedUrl, url));
  assert(retrievals.length === 2, 'appending a new retrieval rather than replacing the old one');

  const after = {
    leads: await db.select({ sha: schema.lead.recordSha256, v: schema.lead.version }).from(schema.lead).orderBy(asc(schema.lead.targetNumber)),
    suppression: (await db.select().from(schema.suppressionEntry)).length,
    events: (await db.select().from(schema.analyticsEvent)).length,
    evaluations: (await db.select().from(schema.leadEvaluation)).length,
  };
  assert(JSON.stringify(after.leads) === JSON.stringify(afterWrite), 'no job wrote a lead (only the operator’s own research record did)');
  assert(after.suppression === before.suppression && after.events === before.events + 2 && after.evaluations === before.evaluations + 1, 'no job touched suppression; only the operator write appended events and an evaluation', { before, after });
  assert(JOBS.every(j => JOB_WRITES[j].includes('job_run')) && JOB_WRITES['stale-data'].length === 2 && JOB_WRITES['weekly-report'].length === 2, 'the read-only jobs declare that they write nothing but the ledger');
}

// ─────────────────────────────────────────────────────────────────────────────
group('4. Periods, names and visibility');
{
  assert(periodFor('stale-data', new Date('2026-09-20T22:00:00Z')).length === 10, 'maintenance jobs are keyed by the IST calendar day');
  assert(/^\d{4}-W\d{2}$/.test(periodFor('weekly-report', new Date('2026-09-20T10:00:00Z'))), 'the report is keyed by ISO week', periodFor('weekly-report', new Date('2026-09-20T10:00:00Z')));
  assert(periodFor('weekly-report', new Date('2026-09-21T10:00:00Z')) !== periodFor('weekly-report', new Date('2026-09-20T10:00:00Z')), 'a Sunday and the following Monday are different weeks');
  assert(isJobName('stale-data') && !isJobName('rm -rf'), 'only declared job names are accepted');

  const status = await jobStatus(db);
  assert(status.length >= 3 && status.every(r => !!r.job && !!r.status), 'the ledger shows the last run of each job');
  assert(status.find(r => r.job === 'flaky')?.status === 'FAILED', 'including the one that gave up', status.map(r => `${r.job}:${r.status}`));

  const workflow = readFileSync(join(REPO, '.github/workflows/maintenance-jobs.yml'), 'utf-8');
  const active = workflow.split('\n').filter(l => /^\s*-?\s*cron:/.test(l) && !l.trim().startsWith('#'));
  assert(active.length === 0, 'the committed workflow has no active schedule — enabling it is a reviewed commit (ADR-034)', active);
  assert(/workflow_dispatch/.test(workflow) && /KACHMO_OPERATOR_CONFIRM_HOST/.test(workflow), 'it runs only on demand, and confirms the host it writes to');
  assert(!/send|smtp|outreach-dispatch|suppression:publish/i.test(workflow), 'and it cannot send anything or touch the outreach pipeline');
}

await database.close();
console.log(`\n${'='.repeat(60)}`);
console.log(`JOBS SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.error(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
