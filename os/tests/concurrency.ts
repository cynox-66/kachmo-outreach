/**
 * PHASE B — REAL-POSTGRES CONCURRENCY (ADR-026).
 *
 * PGlite is single-connection, so the canonical write lock can only be proven against a real server with two
 * independent connections. This suite runs against a LOOPBACK Postgres only:
 *
 *   docker run -d --name kachmo-concurrency -e POSTGRES_PASSWORD=kachmo -p 127.0.0.1:55432:5432 postgres:16
 *   KACHMO_CONCURRENCY_DATABASE_URL=postgres://postgres:kachmo@127.0.0.1:55432/postgres npm run test:concurrency
 *
 * It never reads DATABASE_URL or os/.env.local, refuses any non-loopback host, and works in a database it creates
 * and drops itself (`kachmo_concurrency`). It is not part of `npm test` because it needs that server.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { asc, eq, sql } from 'drizzle-orm';
import type { KachmoLead } from '@kachmo/core/leads/schema.js';
import { parseTrackerContent } from '@kachmo/core/email-ledger/tracker.js';
import { checkSuppression } from '@kachmo/core/suppression/match.js';
import { decideResearchRecord } from '@kachmo/core/state/research-record.js';
import * as schema from '../server/db/schema/index';
import { MIGRATIONS_FOLDER } from '../server/db/rehearsal-db';
import { loadCanonicalSource } from '../server/db/migration/source';
import { importCanonicalSource } from '../server/db/migration/import';
import { CANONICAL_WRITE_LOCK, type Db } from '../server/leads/locks';
import { applyLeadMutation, type MutationActor } from '../server/leads/mutate';
import { createSuppression } from '../server/leads/suppression';
import { permissionsFor } from '../server/authz/permissions';
import type { Actor } from '../server/authz/authorize';
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
    console.error(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 1500)}` : ''}`);
  }
}
const group = (t: string) => console.log(`\n${t}`);

console.log('\n🔒 KACHMO OUTBOUND OS — CONCURRENCY (real Postgres, two connections)');

// ── Target: loopback only ────────────────────────────────────────────────────
const adminUrl = process.env.KACHMO_CONCURRENCY_DATABASE_URL?.trim();
if (!adminUrl) {
  console.error('KACHMO_CONCURRENCY_DATABASE_URL is not set. This suite needs a local Postgres (see the header).');
  process.exit(2);
}
const admin = new URL(adminUrl);
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(admin.hostname)) {
  console.error(`Refusing: ${admin.hostname} is not a loopback host. The concurrency suite only ever runs against a local database.`);
  process.exit(2);
}
const DBNAME = 'kachmo_concurrency';
{
  const root = new Pool({ connectionString: adminUrl, max: 1 });
  await root.query(`drop database if exists ${DBNAME} with (force)`);
  await root.query(`create database ${DBNAME}`);
  await root.end();
}
const testUrl = new URL(adminUrl);
testUrl.pathname = `/${DBNAME}`;
// Two independent pools: A and B never share a connection.
const poolA = new Pool({ connectionString: testUrl.toString(), max: 4 });
const poolB = new Pool({ connectionString: testUrl.toString(), max: 4 });
const dbA = drizzle({ client: poolA, schema }) as unknown as Db;
const dbB = drizzle({ client: poolB, schema }) as unknown as Db;
await migrate(drizzle({ client: poolA, schema }), { migrationsFolder: MIGRATIONS_FOLDER });
const workspace = goldenWorkspace(REPO);
await importCanonicalSource(dbA, loadCanonicalSource(workspace), 'CONCURRENCY-TEST');
const tracker = parseTrackerContent(readFileSync(join(workspace, 'OUTREACH_TRACKER.md'), 'utf-8'));
const ledger = (tn: string) => tracker.get(tn)?.status ?? null;
const env = { KACHMO_CUTOVER_PHASE: 'POST_CUTOVER', KACHMO_APP_WRITES: 'on', DATABASE_URL: testUrl.toString() };
Object.assign(process.env, env);
const opts = { env, ledger };
const dev: MutationActor = { userId: null, label: 'Dev Jaiswal', engineActor: 'DEV' };
const aadi: MutationActor = { userId: null, label: 'Aadi', engineActor: 'AADI' };
// The research service reads through getServer(); give it pool B.
(globalThis as unknown as { __kachmoServer?: unknown }).__kachmoServer = { db: dbB, auth: {} };
const { reviewCandidate } = await import('../server/research/service');
const owner: Actor = { userId: 'u-owner', name: 'Dev Jaiswal', email: 'o@x', roles: ['OWNER'], permissions: permissionsFor(['OWNER']) };

/** Waits until some OTHER backend is blocked on the canonical advisory lock. */
async function waitForAdvisoryWaiter(timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await poolA.query(
      `select count(*)::int as n from pg_locks l join pg_stat_activity a on a.pid = l.pid
       where l.locktype = 'advisory' and not l.granted and a.datname = $1`,
      [DBNAME]
    );
    if (r.rows[0].n > 0) return true;
    await new Promise(r => setTimeout(r, 25));
  }
  return false;
}

/** A client on pool A holding the canonical write lock inside an open transaction. */
async function holdLock() {
  const c = await poolA.connect();
  await c.query('begin');
  await c.query('select pg_advisory_xact_lock($1)', [CANONICAL_WRITE_LOCK]);
  return c;
}

async function candidate(id: string, domain: string, company: string) {
  const [report] = await dbA
    .insert(schema.researchReport)
    .values({ sourceReportId: `r-${id}`, provider: 'HUMAN', operatorLabel: 'Dev Jaiswal', originalFilename: 'r.md', byteSize: 1, format: 'markdown', contentSha256: 'c'.repeat(64), rawContent: 'x', stage: 'AWAITING_REVIEW', extractionStatus: 'OK' })
    .returning({ id: schema.researchReport.id });
  const claim = (field: string, value: string) => ({
    field, value, statedConfidence: 'HIGH', reportLocation: null,
    evidence: [{ field, claim: value, sourceUrl: `https://${domain}/about`, sourceDomain: domain, sourceType: 'official_website', retrievedAt: null, retrievedContentSha256: null, supportingExcerpt: null, level: 'URL_SHAPED', validator: 'LLM_EXTRACTION', validatedAt: null, contradictsEvidenceId: null, notes: null }],
  });
  const [row] = await dbA
    .insert(schema.researchCandidate)
    .values({ candidateId: id, reportId: report.id, status: 'AWAITING_REVIEW', companyName: company, websiteDomain: domain, archetypeId: '1', locationCountry: 'United Kingdom', claims: [claim('company_name', company), claim('website_url', `https://${domain}`), claim('location_country', 'United Kingdom'), claim('archetype_id', '1'), claim('decision_maker_name', 'Ada Lovelace')] })
    .returning({ id: schema.researchCandidate.id });
  return row.id;
}
const staleSnapshot = async () => ({
  phase: 'POST_CUTOVER' as const,
  source: 'POSTGRES' as const,
  leads: (await dbA.select().from(schema.lead)).map(r => r.record as KachmoLead),
  suppression: [],
  events: [],
  tracker,
  scheduled: [],
  warnings: [],
  versions: new Map<string, number>(),
});
const settle = <T,>(p: Promise<T>) => p.then(v => ({ ok: true as const, v }), (e: Error) => ({ ok: false as const, e }));

try {
  // ───────────────────────────────────────────────────────────────────────────
  group('0. The lock really blocks a second connection');
  {
    const held = await holdLock();
    const [row] = await dbB.select().from(schema.lead).where(eq(schema.lead.targetNumber, '111'));
    const write = settle(applyLeadMutation(dbB, { leadId: row.leadId, expectedVersion: row.version, action: 'lead.research_recorded', actor: dev, decide: (l, c) => decideResearchRecord(l, { field: 'tech', by: 'DEV', value: 'Webflow' }, { today: c.today, now: c.now, isKnownTimezone: () => true }) }, opts));
    assert(await waitForAdvisoryWaiter(), 'a write on connection B waits on the advisory lock held by connection A (seen in pg_locks)');
    const [still] = await dbA.select().from(schema.lead).where(eq(schema.lead.leadId, row.leadId));
    assert(still.version === row.version, 'and has written nothing while it waits');
    await held.query('commit');
    held.release();
    const r = await write;
    assert(r.ok && r.v.outcome === 'APPLIED', 'once A commits, B proceeds', r);
  }

  // ───────────────────────────────────────────────────────────────────────────
  group('1. Suppression vs candidate approval');
  {
    // Deterministic: A holds the lock and records a matching suppression; B's approval (against a stale view) waits,
    // then must see the suppression and refuse.
    const cand = await candidate('c-race-det', 'race-det.example', 'Race Det Studio');
    const snap = await staleSnapshot();
    const held = await holdLock();
    const approval = settle(reviewCandidate(owner, { candidateId: cand, decision: 'ACCEPT', note: null }, snap));
    assert(await waitForAdvisoryWaiter(), 'the approval waits for the lock');
    await held.query(`insert into suppression_entry (sequence, domain, reason, suppressed_at, source) values ((select coalesce(max(sequence),0)+1 from suppression_entry), 'race-det.example', 'opted out', now()::text, 'concurrency-test')`);
    await held.query('commit');
    held.release();
    const r = await approval;
    assert(!r.ok && /suppress/i.test(r.e.message), 'it re-reads suppression inside the transaction and refuses', r.ok ? r.v : r.e.message);
    const [c] = await dbA.select().from(schema.researchCandidate).where(eq(schema.researchCandidate.id, cand));
    assert(c.status === 'AWAITING_REVIEW' && c.resolvedLeadId === null, 'and records nothing against the candidate');

    // Deterministic, the other order: the approval commits first; a suppression then queued behind it must re-read
    // the leads inside its own transaction and flag the lead that was just imported.
    const cand2 = await candidate('c-race-det2', 'race-det2.example', 'Race Det Two');
    const held2 = await holdLock();
    const approval2 = settle(reviewCandidate(owner, { candidateId: cand2, decision: 'ACCEPT', note: null }, await staleSnapshot()));
    assert(await waitForAdvisoryWaiter(), 'the approval is queued first');
    await held2.query('commit');
    held2.release();
    const a2 = await approval2;
    const sup2 = await createSuppression(dbA, aadi, { reason: 'opted out', domain: 'race-det2.example' }, opts);
    const [imported] = a2.ok && a2.v.resolvedLeadId ? await dbA.select().from(schema.lead).where(eq(schema.lead.leadId, a2.v.resolvedLeadId)) : [];
    assert(a2.ok && !!imported && sup2.outcome === 'APPLIED' && sup2.affected.includes(imported.targetNumber) && (imported.record as KachmoLead).do_not_contact === true, 'when the approval wins, the suppression flags the freshly imported lead do-not-contact', { a2: a2.ok, sup2 });

    // Real race, both orders, many rounds: whoever wins, no lead may match an active suppression un-flagged.
    let refused = 0;
    let flagged = 0;
    for (let i = 0; i < 12; i++) {
      const domain = `race-${i}.example`;
      const id = await candidate(`c-race-${i}`, domain, `Race Studio ${i}`);
      const snap2 = await staleSnapshot();
      const [a, s] = await Promise.all([
        settle(reviewCandidate(owner, { candidateId: id, decision: 'ACCEPT', note: null }, snap2)),
        settle(createSuppression(dbA, aadi, { reason: 'opted out', domain }, opts)),
      ]);
      if (!a.ok) refused++;
      else flagged++;
      assert(s.ok && s.v.outcome === 'APPLIED', `round ${i}: the suppression is always recorded`, s.ok ? s.v : s.e.message);
    }
    const leads = (await dbA.select().from(schema.lead)).map(r => r.record as KachmoLead);
    const active = (await dbA.select().from(schema.suppressionEntry).where(sql`${schema.suppressionEntry.revokedAt} is null`)).map(r => ({ domain: r.domain ?? undefined, email: r.email ?? undefined, lead_id: r.leadId ?? undefined, target_number: r.targetNumber ?? undefined, phone: r.phone ?? undefined, reason: r.reason, suppressed_at: r.suppressedAt, source: r.source }));
    const exposed = leads.filter(l => checkSuppression(l, active).suppressed && !l.do_not_contact).map(l => l.target_number);
    assert(exposed.length === 0, `across the racing rounds no lead matches an active suppression without do-not-contact (${refused} approvals refused, ${flagged} imported then flagged; the other order is proven deterministically above)`, exposed);
  }

  // ───────────────────────────────────────────────────────────────────────────
  group('2. Two connections writing the same lead at the same version');
  {
    for (let i = 0; i < 8; i++) {
      const [row] = await dbA.select().from(schema.lead).where(eq(schema.lead.targetNumber, '120'));
      const w = (db: Db, value: string) => applyLeadMutation(db, { leadId: row.leadId, expectedVersion: row.version, action: 'lead.research_recorded', actor: dev, decide: (l, c) => decideResearchRecord(l, { field: 'tech', by: 'DEV', value }, { today: c.today, now: c.now, isKnownTimezone: () => true }) }, opts);
      const [a, b] = await Promise.all([w(dbA, `Framework A${i}`), w(dbB, `Framework B${i}`)]);
      const outcomes = [a.outcome, b.outcome].sort();
      const stale = [a, b].find(x => x.outcome === 'REFUSED');
      const [after] = await dbA.select().from(schema.lead).where(eq(schema.lead.leadId, row.leadId));
      const revs = await dbA.select().from(schema.leadRevision).where(sql`${schema.leadRevision.leadId} = ${row.leadId} and ${schema.leadRevision.version} = ${row.version}`);
      assert(
        outcomes.join() === 'APPLIED,REFUSED' && stale?.outcome === 'REFUSED' && stale.code === 'STALE' && after.version === row.version + 1 && revs.length === 1,
        `round ${i}: exactly one write lands (v${row.version}→v${row.version + 1}), the other is refused as STALE, one revision kept`,
        { outcomes, code: stale && 'code' in stale ? stale.code : null, version: after.version, revs: revs.length }
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  group('3. Target-number race');
  {
    const before = (await dbA.select({ tn: schema.lead.targetNumber }).from(schema.lead)).map(r => Number(r.tn));
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await candidate(`c-tn-${i}`, `tn-${i}.example`, `Target Studio ${i}`));
    const snap = await staleSnapshot();
    const results = await Promise.all(ids.map(id => settle(reviewCandidate(owner, { candidateId: id, decision: 'ACCEPT', note: null }, snap))));
    assert(results.every(r => r.ok), 'ten simultaneous approvals from one stale view all succeed — none collides', results.filter(r => !r.ok).map(r => (r as { e: Error }).e.message));
    const after = (await dbA.select({ tn: schema.lead.targetNumber }).from(schema.lead)).map(r => Number(r.tn)).sort((a, b) => a - b);
    const added = after.filter(n => !before.includes(n));
    const max = Math.max(...before);
    assert(added.length === 10 && added.every((n, i) => n === max + 1 + i), 'their target numbers are unique and contiguous', added);
  }

  // ───────────────────────────────────────────────────────────────────────────
  group('4. Suppression and event sequence allocation');
  {
    await Promise.all(Array.from({ length: 10 }, (_, i) => createSuppression(i % 2 ? dbA : dbB, dev, { reason: 'bulk opt-out', domain: `seq-${i}.example` }, opts)));
    const seqs = (await dbA.select({ s: schema.suppressionEntry.sequence }).from(schema.suppressionEntry).orderBy(asc(schema.suppressionEntry.sequence))).map(r => r.s);
    assert(seqs.every((s, i) => s === i + 1), `suppression sequence numbers are gap-free and unique across both connections (1…${seqs.length})`, seqs);
    const ev = (await dbA.select({ s: schema.analyticsEvent.sequence }).from(schema.analyticsEvent).orderBy(asc(schema.analyticsEvent.sequence))).map(r => r.s);
    assert(ev.every((s, i) => s === i + 1), `analytics event sequence numbers are gap-free and unique (1…${ev.length})`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  group('5. A version conflict across connections writes nothing');
  {
    const [seen] = await dbA.select().from(schema.lead).where(eq(schema.lead.targetNumber, '105'));
    const bump = await applyLeadMutation(dbB, { leadId: seen.leadId, expectedVersion: seen.version, action: 'lead.research_recorded', actor: aadi, decide: (l, c) => decideResearchRecord(l, { field: 'tech', by: 'AADI', value: 'Shopify' }, { today: c.today, now: c.now, isKnownTimezone: () => true }) }, opts);
    assert(bump.outcome === 'APPLIED', 'connection B changes the lead');
    const [mid] = await dbA.select().from(schema.lead).where(eq(schema.lead.leadId, seen.leadId));
    const late = await applyLeadMutation(dbA, { leadId: seen.leadId, expectedVersion: seen.version, action: 'lead.research_recorded', actor: dev, decide: (l, c) => decideResearchRecord(l, { field: 'tech', by: 'DEV', value: 'Wix' }, { today: c.today, now: c.now, isKnownTimezone: () => true }) }, opts);
    const [end] = await dbA.select().from(schema.lead).where(eq(schema.lead.leadId, seen.leadId));
    assert(late.outcome === 'REFUSED' && late.code === 'STALE', 'connection A, still holding the old version, is refused as STALE');
    assert(end.version === mid.version && end.recordSha256 === mid.recordSha256 && (end.record as KachmoLead).current_framework === 'Shopify', 'and wrote nothing over B\'s change');
  }
} finally {
  await poolA.end();
  await poolB.end();
  const root = new Pool({ connectionString: adminUrl, max: 1 });
  await root.query(`drop database if exists ${DBNAME} with (force)`);
  await root.end();
}

console.log(`\n${'='.repeat(60)}`);
console.log(`CONCURRENCY SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.error(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
