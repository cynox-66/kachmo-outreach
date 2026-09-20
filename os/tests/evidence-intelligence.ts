/**
 * PHASE D — EVIDENCE INTELLIGENCE.
 *
 * Gate coverage, source freshness and change detection, the work items they produce, and the methodology shadow —
 * against in-memory PostgreSQL with the pinned golden dataset and a fake internet. No network, no hosted database.
 *
 * The governing rule of this phase is negative: none of it may change a gate, a score, a state or a lead.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq, sql } from 'drizzle-orm';
import type { KachmoLead } from '@kachmo/core/leads/schema.js';
import { parseTrackerContent } from '@kachmo/core/email-ledger/tracker.js';
import { evaluateLeadGates } from '@kachmo/core/qualification/gates.js';
import { gateCoverage, coverageSummary, shadowDifferences, bestLevel, GATE_CLAIM_FIELDS } from '@kachmo/core/research/coverage.js';
import { strictGateOutcomeFor } from '@kachmo/core/research/evidence.js';
import * as schema from '../server/db/schema/index';
import { createRehearsalDatabase } from '../server/db/rehearsal-db';
import { loadCanonicalSource } from '../server/db/migration/source';
import { importCanonicalSource } from '../server/db/migration/import';
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
    console.error(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 1200)}` : ''}`);
  }
}
const group = (t: string) => console.log(`\n${t}`);

console.log('\n🔬 KACHMO OUTBOUND OS — PHASE D EVIDENCE INTELLIGENCE');

const POST = { KACHMO_CUTOVER_PHASE: 'POST_CUTOVER', KACHMO_APP_WRITES: 'on', DATABASE_URL: 'postgres://localhost:5432/kachmo_test' };
Object.assign(process.env, POST);

// ─────────────────────────────────────────────────────────────────────────────
group('1. Coverage measures how far each gate’s source was taken');
{
  const gates = {
    gate_1_decision_maker: 'PASS', gate_2_contactability: 'PENDING', gate_3_commercial_proof: 'PASS', gate_4_digital_friction: 'UNVERIFIED',
    gate_5_location_timezone: 'PASS', gate_6_budget_probability: 'UNKNOWN', gate_7_buying_intent: 'UNKNOWN', gate_8_kachmo_fit: 'UNVERIFIED',
  } as Parameters<typeof gateCoverage>[0];
  const c = gateCoverage(gates, { decision_maker_name: ['URL_SHAPED', 'SUPPORTED'], commercial_validation_signal: ['CONTRADICTED'], observable_friction: ['RETRIEVED'] });
  const by = (g: string) => c.find(x => x.gate === g)!;
  assert(by('gate_1_decision_maker').level === 'SUPPORTED', 'the strongest level for a field wins');
  assert(by('gate_3_commercial_proof').contradicted && by('gate_3_commercial_proof').level === 'NONE', 'a contradiction is reported separately, never as "stronger"');
  assert(by('gate_4_digital_friction').level === 'RETRIEVED' && by('gate_2_contactability').level === 'NONE', 'a field with no evidence contributes nothing');
  assert(by('gate_8_kachmo_fit').fields.length === 0, 'a gate that rests on a human judgement has no measurable source');
  assert(c.every(x => x.outcome === gates[x.gate]), 'coverage never alters the gate outcome it reports');
  const s = coverageSummary(c);
  assert(s.measurable === 7 && s.checked === 1 && s.retrieved === 1 && s.contradicted === 1, 'the summary counts what it says it counts', s);
  assert(bestLevel([]).level === 'NONE' && bestLevel(['CONTRADICTED']).contradicted, 'an empty set is NONE; a contradiction is flagged');
  assert(Object.values(GATE_CLAIM_FIELDS).flat().length > 0, 'every gate declares the claim fields it rests on');
}

// ─────────────────────────────────────────────────────────────────────────────
group('2. The shadow measures a stricter reading without applying it');
{
  const gates = { gate_1_decision_maker: 'PASS', gate_3_commercial_proof: 'PASS', gate_4_digital_friction: 'PASS' } as Parameters<typeof gateCoverage>[0];
  const c = gateCoverage(gates, { decision_maker_name: ['SUPPORTED'], commercial_validation_signal: ['URL_SHAPED'], observable_friction: ['CONTRADICTED'] });
  const d = shadowDifferences(c);
  assert(!d.some(x => x.gate === 'gate_1_decision_maker'), 'a checked source still passes under the strict reading — no difference to report');
  assert(d.find(x => x.gate === 'gate_3_commercial_proof')?.shadow === 'UNVERIFIED', 'a URL nobody fetched would become UNVERIFIED');
  assert(d.find(x => x.gate === 'gate_4_digital_friction')?.shadow === 'FAIL', 'a contradicted claim would fail');
  assert(d.every(x => x.shadow === strictGateOutcomeFor(x.level)), 'the shadow is exactly ADR-011’s published mapping, not a new rule');
  const none = shadowDifferences(gateCoverage(gates, {}));
  assert(none.length === 0, 'a gate with no recorded evidence is left alone — nothing is measured, so nothing is claimed');
}

// ── Database-backed ──────────────────────────────────────────────────────────
const workspace = goldenWorkspace(REPO);
const source = loadCanonicalSource(workspace);
const tracker = parseTrackerContent(readFileSync(join(workspace, 'OUTREACH_TRACKER.md'), 'utf-8'));
const ledger = (tn: string) => tracker.get(tn)?.status ?? null;
const database = await createRehearsalDatabase();
(globalThis as unknown as { __kachmoServer?: unknown }).__kachmoServer = { db: database.db, auth: {} };
const db = database.db;
await importCanonicalSource(db, source, 'PHASE-D-TEST');
await db.insert(schema.user).values({ id: 'u-owner', name: 'Dev Jaiswal', email: 'u-owner@kachmo.test' });
await db.insert(schema.userRole).values({ userId: 'u-owner', role: 'OWNER' });
const { bindEngineActor } = await import('../server/leads/actor-binding');
await bindEngineActor(db, { userEmail: 'u-owner@kachmo.test', engineActor: 'DEV', ownerLabel: 'Dev Jaiswal' });
const owner: Actor = { userId: 'u-owner', name: 'Dev Jaiswal', email: 'u-owner@kachmo.test', roles: ['OWNER'], permissions: permissionsFor(['OWNER']) };

const { recordResearch } = await import('../server/leads/commands');
const { planFetch, runFetch } = await import('../server/evidence/fetch-run');
const { evidenceForLead, FRESHNESS_DAYS } = await import('../server/evidence/store');
const { reviewEvidence } = await import('../server/evidence/review');
const { shadowReport, coverageForLead } = await import('../server/evidence/coverage');
const { getToday } = await import('../server/services/today');
const { loadCanonical } = await import('../server/repo/canonical');
const opts = { env: POST, ledger };

const SOURCE_URL = 'https://studio-d.example/clients';
const PAGE_V1 = '<p>Northwind works with three national retailers on their store design.</p>';
const PAGE_V2 = '<p>Northwind is a two-person studio and takes no retail work.</p>';
type Page = { status?: number; type?: string; body?: string };
function fakeNet(pages: Record<string, Page>) {
  return {
    transport: {
      async resolve() {
        return ['93.184.216.34'];
      },
      async get(url: URL) {
        const p = pages[url.toString()] ?? { status: 404 };
        return { status: p.status ?? 200, headers: { 'content-type': p.type ?? 'text/html' }, body: Buffer.from(p.body ?? ''), truncated: false };
      },
    },
  };
}
const leadRow = async (tn: string) => (await db.select().from(schema.lead).where(eq(schema.lead.targetNumber, tn)))[0];

// ─────────────────────────────────────────────────────────────────────────────
group('3. A refresh re-fetches only stale sources, and a changed page invalidates the check');
{
  const l = await leadRow('111');
  const rec = await recordResearch(db, owner, { leadId: l.leadId, expectedVersion: l.version, field: 'commercial-source', value: 'Works with three national retailers', source: SOURCE_URL }, opts);
  assert(rec.ok, 'a researcher records a sourced claim', rec);
  await runFetch(db, { actor: 'Dev Jaiswal', fetchOptions: fakeNet({ [SOURCE_URL]: { body: PAGE_V1 } }), sleep: async () => {} });
  const [ev] = await db.select().from(schema.leadEvidence).where(eq(schema.leadEvidence.sourceUrl, SOURCE_URL));
  const view1 = (await evidenceForLead(db, l.leadId)).find(x => x.id === ev.id)!;
  assert(view1.level === 'RETRIEVED' && view1.freshness === 'FRESH' && view1.ageDays === 0, 'a freshly retrieved source is FRESH', view1);

  const r = await reviewEvidence(db, owner, { evidenceId: ev.id, verdict: 'SUPPORTS', excerpt: 'works with three national retailers' });
  assert(r.ok, 'a person checks it against the claim', r);

  const fresh = await planFetch(db, { mode: 'REFRESH' });
  assert(fresh.toFetch.length === 0 && fresh.candidates.every(c => c.skip === 'FRESH_ENOUGH'), 'a refresh re-fetches nothing while the source is still fresh');
  const later = new Date(Date.now() + (FRESHNESS_DAYS + 1) * 86_400_000);
  const due = await planFetch(db, { mode: 'REFRESH', now: later });
  assert(due.toFetch.some(c => c.url === SOURCE_URL), `after ${FRESHNESS_DAYS} days the source is planned for a re-fetch`);

  // The page changed since it was checked.
  await runFetch(db, { actor: 'Dev Jaiswal', mode: 'REFRESH', now: later, freshnessDays: 0, fetchOptions: fakeNet({ [SOURCE_URL]: { body: PAGE_V2 } }), sleep: async () => {} });
  const view2 = (await evidenceForLead(db, l.leadId)).find(x => x.id === ev.id)!;
  assert(view2.freshness === 'SOURCE_CHANGED', 'the earlier check is marked SOURCE_CHANGED — it no longer describes the page', view2.freshness);
  assert(view2.level === 'SUPPORTED', 'the recorded level is not rewritten behind the reviewer’s back; the claim is flagged, not downgraded');
  const [after] = await db.select().from(schema.lead).where(eq(schema.lead.leadId, l.leadId));
  const [before] = await db.select().from(schema.leadRevision).where(sql`${schema.leadRevision.leadId} = ${l.leadId} order by version desc limit 1`);
  assert(after.version === (before?.version ?? 0) + 1, 'no fetch or refresh ever wrote a new lead version', { after: after.version });
  const retrievals = await db.select().from(schema.evidenceRetrieval).where(eq(schema.evidenceRetrieval.requestedUrl, SOURCE_URL));
  assert(retrievals.length === 2 && retrievals.every(x => x.outcome === 'OK'), 'both retrievals are kept: the record of what the page said, and what it says now');
}

// ─────────────────────────────────────────────────────────────────────────────
group('4. Evidence that needs a person becomes work');
{
  const snapshot = await loadCanonical({ KACHMO_CUTOVER_PHASE: 'POST_CUTOVER' });
  const t = await getToday(owner, { snapshot });
  assert(t.items.some(i => i.kind === 'EVIDENCE_RECHECK'), 'a changed source appears as a re-check item', t.counts);

  // A contradiction recorded by a person becomes the most serious kind of evidence work.
  const l = await leadRow('112');
  const url = 'https://studio-d2.example/about';
  const rec = await recordResearch(db, owner, { leadId: l.leadId, expectedVersion: l.version, field: 'friction-source', value: 'Booking flow is a PDF form', source: url }, opts);
  assert(rec.ok, 'a second sourced claim is recorded');
  await runFetch(db, { actor: 'Dev Jaiswal', fetchOptions: fakeNet({ [url]: { body: '<p>Bookings are handled by an online scheduler.</p>' } }), sleep: async () => {} });
  const [ev2] = await db.select().from(schema.leadEvidence).where(eq(schema.leadEvidence.sourceUrl, url));
  const con = await reviewEvidence(db, owner, { evidenceId: ev2.id, verdict: 'CONTRADICTS', excerpt: 'Bookings are handled by an online scheduler', note: 'the page says the opposite' });
  assert(con.ok, 'a person records the contradiction', con);
  const t2 = await getToday(owner, { snapshot: await loadCanonical({ KACHMO_CUTOVER_PHASE: 'POST_CUTOVER' }) });
  const contradiction = t2.items.find(i => i.kind === 'EVIDENCE_CONTRADICTION');
  assert(!!contradiction && contradiction.targetNumber === '112', 'it appears as a contradiction item on the lead it concerns', contradiction);
  assert(t2.items.findIndex(i => i.kind === 'EVIDENCE_CONTRADICTION') < t2.items.findIndex(i => i.kind === 'EVIDENCE_REVIEW' || i.kind === 'RESEARCH'), 'and is ordered above ordinary evidence and research work');
  assert(contradiction!.why.some(w => /contradicts/.test(w)), 'the item says what is wrong, in stored terms', contradiction!.why);
}

// ─────────────────────────────────────────────────────────────────────────────
group('5. Coverage and the shadow change nothing');
{
  const l = await leadRow('111');
  const lead = l.record as KachmoLead;
  const gates = evaluateLeadGates(lead, [], ledger(lead.target_number)).gates;
  const c = await coverageForLead(db, lead, gates);
  assert(c.coverage.length === 8 && c.coverage.every(x => x.outcome === gates[x.gate]), 'per-lead coverage reports all eight gates and never changes an outcome');
  assert(c.coverage.find(x => x.gate === 'gate_3_commercial_proof')!.level === 'SUPPORTED', 'the checked source shows up against the gate it supports');

  const before = await db.select({ id: schema.lead.leadId, sha: schema.lead.recordSha256, v: schema.lead.version }).from(schema.lead).orderBy(asc(schema.lead.targetNumber));
  const beforeEvals = await db.select({ n: sql<number>`count(*)::int` }).from(schema.leadEvaluation);
  const report = await shadowReport(db);
  const after = await db.select({ id: schema.lead.leadId, sha: schema.lead.recordSha256, v: schema.lead.version }).from(schema.lead).orderBy(asc(schema.lead.targetNumber));
  const afterEvals = await db.select({ n: sql<number>`count(*)::int` }).from(schema.leadEvaluation);
  assert(JSON.stringify(before) === JSON.stringify(after), 'the shadow report writes no lead');
  assert(Number(beforeEvals[0].n) === Number(afterEvals[0].n), 'and records no evaluation');
  assert(report.leads === 120 && report.leadsWithEvidence === 2, 'it measures only leads that actually have recorded sources', { leads: report.leads, withEvidence: report.leadsWithEvidence });
  assert(report.byGate.every(g => g.changes > 0) && report.byTransition.every(t => t.count > 0), 'it reports per-gate differences and the transitions they would make', report.byGate);
  const [methodology] = await db.select().from(schema.methodologyVersion).where(eq(schema.methodologyVersion.status, 'ACTIVE'));
  assert(methodology.id === '1.0', 'Methodology v1.0 is still the only ACTIVE methodology');
}

await database.close();
console.log(`\n${'='.repeat(60)}`);
console.log(`EVIDENCE INTELLIGENCE SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.error(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
