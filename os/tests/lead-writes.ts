/**
 * PHASE B — THE POSTGRES LEAD WRITE PATH.
 *
 * Everything here runs against in-memory PostgreSQL (PGlite) with every migration applied, loaded with the PINNED
 * golden dataset (git 48cfbc0) through the real migration importer. No hosted database, no network, and the
 * repository working tree is never read as data or written.
 *
 * The oracles are the two committed golden baselines. They are READ, never regenerated:
 *   - methodology-v1.0.baseline.json      what `leads:refresh` makes of every lead
 *   - methodology-v1.0.writepaths.baseline.json   what the call / WhatsApp / pipeline / record / suppress CLIs write
 *
 * If the Postgres path and the CLI path ever disagree, one of them changed Methodology v1.0. That is the failure
 * this file exists to catch.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq, sql } from 'drizzle-orm';
import type { KachmoLead } from '@kachmo/core/leads/schema.js';
import { FIELD_OWNERSHIP, ownerOf } from '@kachmo/core/reconciliation/ownership.js';
import { parseTrackerContent } from '@kachmo/core/email-ledger/tracker.js';
import { CALL_OUTCOMES, OBJECTION_CATEGORIES, LOST_REASONS } from '@kachmo/core/leads/schema.js';
import { decideCallOutcome, callLogInputProblem } from '@kachmo/core/state/call.js';
import { decideWhatsAppTransition, WHATSAPP_STATUSES } from '@kachmo/core/state/whatsapp.js';
import { decidePipelineTransition, pipelineLogInputProblem, PIPELINE_STAGES, PIPELINE_CHANNELS } from '@kachmo/core/state/pipeline.js';
import { decideResearchRecord, RECORDABLE_FIELDS, type RecordableField } from '@kachmo/core/state/research-record.js';
import * as schema from '../server/db/schema/index';
import { createRehearsalDatabase } from '../server/db/rehearsal-db';
import { loadCanonicalSource } from '../server/db/migration/source';
import { importCanonicalSource } from '../server/db/migration/import';
import { appWritesEnabled, writeRefusal } from '../server/repo/phase';
import { reevaluateLead, engineRef } from '../server/leads/reevaluate';
import { applyLeadMutation, type MutationActor } from '../server/leads/mutate';
import { createSuppression } from '../server/leads/suppression';
import { planReevaluation, runReevaluation } from '../server/leads/reevaluate-run';
import { bindEngineActor, activeEngineActor, requireEngineActor, revokeEngineActor } from '../server/leads/actor-binding';
import { goldenWorkspace, hash, GOLDEN_NOW } from '../../scripts/__tests__/golden/snapshot.js';
import { SCENARIO, WRITE_NOW_ISO } from '../../scripts/__tests__/golden/write-paths.js';
import { parseArgs, str, oneOf } from '../../scripts/lib/cli.js';

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
    console.error(`  ❌ ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1500)}` : ''}`);
  }
}
const group = (t: string) => console.log(`\n${t}`);
const omit = (o: object, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

console.log('\n✍️  KACHMO OUTBOUND OS — PHASE B LEAD WRITE PATH');

// The suites write to in-memory Postgres; the declared target is a loopback database, which the write guard allows.
const POST = { KACHMO_CUTOVER_PHASE: 'POST_CUTOVER', KACHMO_APP_WRITES: 'on', DATABASE_URL: 'postgres://localhost:5432/kachmo_test' };
const FROZEN = () => new Date(WRITE_NOW_ISO);

// ── Fixture: the pinned golden dataset in PGlite ─────────────────────────────
async function goldenDatabase() {
  const workspace = goldenWorkspace(REPO);
  const database = await createRehearsalDatabase();
  await importCanonicalSource(database.db, loadCanonicalSource(workspace), 'TEST');
  const tracker = parseTrackerContent(readFileSync(join(workspace, 'OUTREACH_TRACKER.md'), 'utf-8'));
  const ledger = (tn: string) => tracker.get(tn)?.status ?? null;
  return { database, workspace, ledger };
}
const leadsOf = async (db: Awaited<ReturnType<typeof goldenDatabase>>['database']['db']) =>
  (await db.select().from(schema.lead).orderBy(asc(schema.lead.targetNumber))).map(r => r.record as KachmoLead);

// ─────────────────────────────────────────────────────────────────────────────
group('1. Application writes are off unless explicitly switched on (ADR-027)');
{
  assert(!appWritesEnabled({}), 'unset → off');
  assert(!appWritesEnabled({ KACHMO_APP_WRITES: 'true' }) && !appWritesEnabled({ KACHMO_APP_WRITES: 'yes' }) && !appWritesEnabled({ KACHMO_APP_WRITES: '1' }), 'only the exact word "on" enables writes');
  assert(appWritesEnabled({ KACHMO_APP_WRITES: 'on' }), '"on" → on');
  assert(writeRefusal({ KACHMO_APP_WRITES: 'on' }) !== null, 'even switched on, nothing is written before cutover (PRE_CUTOVER is the default)');
  assert(writeRefusal({ KACHMO_CUTOVER_PHASE: 'POST_CUTOVER' }) !== null, 'after cutover, writes still need the switch');
  assert(writeRefusal(POST) === null, 'POST_CUTOVER + switch on + a loopback target → writes allowed');
  // No accidental production writer: a development server never writes to a hosted database.
  const PROD = 'postgres://u:p@ep-real-prod.neon.tech/neondb';
  const hosted = { KACHMO_CUTOVER_PHASE: 'POST_CUTOVER', KACHMO_APP_WRITES: 'on', DATABASE_URL: PROD };
  assert(/not a production build/.test(writeRefusal({ ...hosted, NODE_ENV: 'development' }) ?? ''), '`next dev` with the switch on, pointed at a hosted database (the os/.env.local situation), is refused');
  assert(/not a production build/.test(writeRefusal(hosted) ?? ''), 'so is any process with NODE_ENV unset');
  assert(/KACHMO_APP_WRITES_HOST/.test(writeRefusal({ ...hosted, NODE_ENV: 'production' }) ?? ''), 'a production build still refuses until it names the exact host it may write');
  assert(/KACHMO_APP_WRITES_HOST/.test(writeRefusal({ ...hosted, NODE_ENV: 'production', KACHMO_APP_WRITES_HOST: 'ep-other.neon.tech' }) ?? ''), 'naming a different host is refused');
  assert(writeRefusal({ ...hosted, NODE_ENV: 'production', KACHMO_APP_WRITES_HOST: 'EP-REAL-PROD.neon.tech' }) === null, 'a production build naming exactly its database host may write');
  assert(/DATABASE_URL is missing/.test(writeRefusal({ KACHMO_CUTOVER_PHASE: 'POST_CUTOVER', KACHMO_APP_WRITES: 'on' }) ?? ''), 'with no verifiable target, nothing is written');
  assert(writeRefusal({ ...POST, NODE_ENV: 'development' }) === null && writeRefusal({ ...POST, DATABASE_URL: 'postgres://127.0.0.1/x' }) === null, 'a loopback database (a local test database) may be written in development');
  const env = readFileSync(join(OS, 'server/repo/phase.ts'), 'utf-8');
  assert(!/KACHMO_APP_WRITES\s*\?\?\s*['"]on/.test(env), 'there is no code path that defaults the switch to on');
}

// ─────────────────────────────────────────────────────────────────────────────
group('2. Re-evaluation reproduces `leads:refresh` exactly (golden parity, Methodology v1.0)');
const baseline = JSON.parse(readFileSync(join(REPO, 'scripts/__tests__/golden/methodology-v1.0.baseline.json'), 'utf-8'));
{
  const { database, workspace, ledger } = await goldenDatabase();
  const suppression = JSON.parse(readFileSync(join(workspace, 'database/suppression.json'), 'utf-8'));
  const leads = await leadsOf(database.db);
  const expected = new Map<string, { record_sha: string }>((baseline.pipeline.leads as Array<{ lead_id: string; record_sha: string }>).map(l => [l.lead_id, l]));

  const mismatched: string[] = [];
  let qualificationEvents = 0;
  const mutatedInputs: string[] = [];
  for (const lead of leads) {
    const input = JSON.stringify(lead);
    const re = reevaluateLead(lead, { suppression, ledgerStatus: ledger(lead.target_number), now: new Date(GOLDEN_NOW).toISOString() });
    if (JSON.stringify(lead) !== input) mutatedInputs.push(lead.target_number);
    if (hash(omit(re.next, ['updated_at'])) !== expected.get(lead.lead_id)?.record_sha) mismatched.push(lead.target_number);
    qualificationEvents += re.events.filter(e => e.event_type === 'QUALIFICATION_CHANGED').length;
  }
  assert(mutatedInputs.length === 0, 're-evaluation never mutates the record it is given', mutatedInputs);
  assert(leads.length === 120, 'the pinned dataset has 120 leads', leads.length);
  assert(mismatched.length === 0, `every one of the 120 re-evaluated records is byte-identical to the golden refresh output`, mismatched);
  const inputEvents = readFileSync(join(workspace, 'analytics/events.jsonl'), 'utf-8').split('\n').filter(Boolean).length;
  assert(qualificationEvents === baseline.pipeline.events.count - inputEvents, `the same number of QUALIFICATION_CHANGED events as the CLI appended (${qualificationEvents})`, { qualificationEvents, cli: baseline.pipeline.events.count - inputEvents });

  // The operator command over the same database: dry run, apply, idempotency.
  const dry = await planReevaluation(database.db, { ledger, now: WRITE_NOW_ISO });
  assert(dry.items.length === 120 && dry.toRecordOnly + dry.toWrite === 120, 'the first dry run plans an evaluation for every lead', { w: dry.toWrite, r: dry.toRecordOnly });
  const before = await database.db.select({ n: sql<number>`count(*)::int` }).from(schema.leadEvaluation);
  assert(Number(before[0].n) === 0, 'a dry run writes nothing');
  let refused = '';
  try {
    await runReevaluation(database.db, { apply: true, confirm: 'not-the-digest', actor: 'Dev Jaiswal', env: POST, ledger, now: FROZEN });
  } catch (e) {
    refused = (e as Error).message;
  }
  assert(/--confirm must equal the plan digest/.test(refused), 'apply refuses without the digest of the exact dry-run state');
  let agentRefused = '';
  try {
    await runReevaluation(database.db, { apply: true, confirm: dry.digest, actor: 'SYSTEM', env: POST, ledger, now: FROZEN });
  } catch (e) {
    agentRefused = (e as Error).message;
  }
  assert(/not a named person/.test(agentRefused), 'apply refuses a system identity as the actor');
  let preRefused = '';
  try {
    await runReevaluation(database.db, { apply: true, confirm: dry.digest, actor: 'Dev Jaiswal', env: {}, ledger, now: FROZEN });
  } catch (e) {
    preRefused = (e as Error).message;
  }
  assert(/no lead writes in PRE_CUTOVER/.test(preRefused), 'apply refuses outside POST_CUTOVER');

  const run = await runReevaluation(database.db, { apply: true, confirm: dry.digest, actor: 'Dev Jaiswal', env: POST, ledger, now: FROZEN });
  assert(run.applied && run.written === dry.toWrite && run.recorded === 120, `apply rewrote ${run.written} lead(s) and recorded 120 evaluations`, run);
  const after = await leadsOf(database.db);
  const stillMismatched = after.filter(l => hash(omit(l, ['updated_at'])) !== expected.get(l.lead_id)?.record_sha).map(l => l.target_number);
  assert(stillMismatched.length === 0, 'the stored records now equal the golden refresh output', stillMismatched);

  const revisions = await database.db.select({ n: sql<number>`count(*)::int` }).from(schema.leadRevision);
  assert(Number(revisions[0].n) === run.written, 'every rewritten lead kept its superseded record in lead_revision');
  const evals = await database.db.select().from(schema.leadEvaluation);
  assert(evals.every(e => e.methodologyVersionId === '1.0' && e.engineRef === engineRef() && e.engineRef.startsWith('core-dist:')), 'every evaluation names methodology 1.0 and the exact engine build');
  assert(evals.every(e => /^[0-9a-f]{64}$/.test(e.inputSha256)) && evals.every(e => e.actorLabel === 'Dev Jaiswal'), 'every evaluation is attributed to its input and to the named human who ran it');

  const again = await planReevaluation(database.db, { ledger, now: WRITE_NOW_ISO });
  assert(again.toWrite === 0 && again.toRecordOnly === 0, 'a second dry run finds nothing to do (idempotent)', { w: again.toWrite, r: again.toRecordOnly });
  const noop = await runReevaluation(database.db, { apply: true, confirm: again.digest, actor: 'Dev Jaiswal', env: POST, ledger, now: FROZEN });
  assert(noop.written === 0 && noop.recorded === 0, 'and applying it writes nothing');
  const runs = await database.db.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'lead.reevaluation_run'));
  assert(runs.length === 2 && runs.every(r => r.actorLabel === 'Dev Jaiswal'), 'each applied run is audited once, with the named actor');
  await database.close();
}

// ─────────────────────────────────────────────────────────────────────────────
group('3. Every field a core decision can write has an owner (ADR-009, ADR-019)');
{
  const stateDir = join(REPO, 'core/state');
  const src = readdirSync(stateDir).filter(f => f.endsWith('.ts')).map(f => readFileSync(join(stateDir, f), 'utf-8')).join('\n');
  const patched = new Set<string>([...src.matchAll(/patch\.([a-z_]+)\s*=/g)].map(m => m[1]));
  // Object-literal patches: doNotContactPatch and the research-record / suppression helpers.
  const literal = [...src.matchAll(/return \{\n([\s\S]*?)\n  \};/g)].flatMap(m => [...m[1].matchAll(/^\s+([a-z_]+):/gm)].map(x => x[1]));
  for (const k of literal) if (FIELD_OWNERSHIP.some(g => g.fields.includes(k))) patched.add(k);
  patched.add('research_sources');
  patched.add('updated_at');
  assert(patched.size >= 25, `the static scan found the fields core decisions patch (${patched.size})`, [...patched]);
  const unowned = [...patched].filter(f => ownerOf(f, 'POST_CUTOVER') === null);
  assert(unowned.length === 0, 'every one of them is classified in FIELD_OWNERSHIP', unowned);
  const titanOwned = [...patched].filter(f => ownerOf(f, 'POST_CUTOVER') === 'TITAN');
  assert(JSON.stringify(titanOwned) === JSON.stringify(['email_follow_up_sent_at']), 'exactly one is Titan-owned — the FOLLOW_UP_SENT stamp, which is why the app never applies FOLLOW_UP_SENT (ADR-019)', titanOwned);
}

// ─────────────────────────────────────────────────────────────────────────────
group('4. The Postgres applier reproduces the CLI write paths (golden write-path parity)');
const writeBaseline = JSON.parse(readFileSync(join(REPO, 'scripts/__tests__/golden/methodology-v1.0.writepaths.baseline.json'), 'utf-8'));
{
  const { database, ledger } = await goldenDatabase();
  const db = database.db;
  // Start where the CLI scenario starts: a refreshed database.
  const first = await planReevaluation(db, { ledger, now: WRITE_NOW_ISO });
  await runReevaluation(db, { apply: true, confirm: first.digest, actor: 'Dev Jaiswal', env: POST, ledger, now: FROZEN });

  const isKnownTimezone = (tz: string) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  };
  const find = async (ident: string) => {
    const tn = /^\d{1,3}$/.test(ident) ? ident.padStart(3, '0') : ident;
    const [row] = await db.select().from(schema.lead).where(eq(schema.lead.targetNumber, tn));
    return row;
  };
  const actor = (by: 'DEV' | 'AADI'): MutationActor => ({ userId: null, label: by === 'DEV' ? 'Dev Jaiswal' : 'Aadi', engineActor: by });
  const opts = { env: POST, ledger, now: FROZEN };

  // Each CLI's own argument mapping, reproduced exactly — only the persistence differs.
  type Outcome = { outcome: 'applied' | 'refused'; reason?: string };
  const run = async (kind: string, argv: string[]): Promise<Outcome> => {
    const refuse = (reason: string): Outcome => ({ outcome: 'refused', reason });
    try {
      if (kind === 'recordResearch') {
        const args = parseArgs(argv, ['lead', 'field', 'value', 'status', 'source', 'source-type', 'basis', 'title', 'by', 'date']);
        const by = oneOf(str(args, 'by') ?? 'DEV', ['DEV', 'AADI'] as const, 'by')!;
        const row = await find(str(args, 'lead')!);
        const field = str(args, 'field')!.toLowerCase() as RecordableField;
        if (!(RECORDABLE_FIELDS as readonly string[]).includes(field)) return refuse('bad field');
        const r = await applyLeadMutation(db, {
          leadId: row.leadId, expectedVersion: row.version, action: 'lead.research_recorded', actor: actor(by),
          decide: (lead, ctx) => decideResearchRecord(lead, { field, by, byExplicit: !!args.by, value: str(args, 'value') ?? null, status: str(args, 'status') ?? null, source: str(args, 'source') ?? null, sourceType: str(args, 'source-type') ?? null, basis: str(args, 'basis') ?? null, title: str(args, 'title') ?? null, date: str(args, 'date') ?? null }, { today: ctx.today, now: ctx.now, isKnownTimezone }),
        }, opts);
        return r.outcome === 'APPLIED' ? { outcome: 'applied' } : refuse(r.reason);
      }
      if (kind === 'logCall') {
        const args = parseArgs(argv, ['lead', 'outcome', 'notes', 'objection', 'objection-category', 'callback-date', 'by', 'whatsapp-ok', 'confirmed-identity']);
        const outcome = oneOf(str(args, 'outcome'), CALL_OUTCOMES, 'outcome')!;
        const by = oneOf(str(args, 'by') ?? 'AADI', ['AADI', 'DEV'] as const, 'by')!;
        const input = { outcome, by, notes: str(args, 'notes') ?? null, objection: str(args, 'objection') ?? null, objectionCategory: oneOf(str(args, 'objection-category'), OBJECTION_CATEGORIES, 'objection-category') ?? null, callbackDate: str(args, 'callback-date') ?? null, whatsappOk: !!args['whatsapp-ok'], confirmedIdentity: !!args['confirmed-identity'] };
        const problem = callLogInputProblem(input);
        if (problem) return refuse(problem);
        const row = await find(str(args, 'lead')!);
        const r = await applyLeadMutation(db, { leadId: row.leadId, expectedVersion: row.version, action: 'lead.call_logged', actor: actor(by), decide: (lead, ctx) => decideCallOutcome(lead, input, ctx) }, opts);
        return r.outcome === 'APPLIED' ? { outcome: 'applied' } : refuse(r.reason);
      }
      if (kind === 'logWhatsApp') {
        const args = parseArgs(argv, ['lead', 'status', 'by', 'notes']);
        const status = oneOf(str(args, 'status'), WHATSAPP_STATUSES, 'status')!;
        const by = oneOf(str(args, 'by') ?? 'AADI', ['DEV', 'AADI'] as const, 'by')!;
        const row = await find(str(args, 'lead')!);
        const r = await applyLeadMutation(db, { leadId: row.leadId, expectedVersion: row.version, action: 'lead.whatsapp_transitioned', actor: actor(by), decide: (lead, ctx) => decideWhatsAppTransition(lead, { status, by, notes: str(args, 'notes') ?? null }, ctx) }, opts);
        return r.outcome === 'APPLIED' ? { outcome: 'applied' } : refuse(r.reason);
      }
      if (kind === 'logPipeline') {
        const args = parseArgs(argv, ['lead', 'stage', 'channel', 'value', 'reason', 'date', 'by', 'notes']);
        const stage = oneOf(str(args, 'stage'), PIPELINE_STAGES, 'stage')!;
        const by = oneOf(str(args, 'by') ?? 'DEV', ['DEV', 'AADI'] as const, 'by')!;
        const input = { stage, by, channel: oneOf(str(args, 'channel'), PIPELINE_CHANNELS, 'channel'), value: str(args, 'value') ?? null, reason: oneOf(str(args, 'reason'), LOST_REASONS, 'reason'), date: str(args, 'date') ?? null, notes: str(args, 'notes') ?? null };
        const problem = pipelineLogInputProblem(input);
        if (problem) return refuse(problem);
        const row = await find(str(args, 'lead')!);
        const r = await applyLeadMutation(db, { leadId: row.leadId, expectedVersion: row.version, action: 'lead.pipeline_transitioned', actor: actor(by), decide: (lead, ctx) => decidePipelineTransition(lead, input, ctx) }, opts);
        return r.outcome === 'APPLIED' ? { outcome: 'applied' } : refuse(r.reason);
      }
      if (kind === 'suppress') {
        const args = parseArgs(argv, ['lead', 'email', 'phone', 'domain', 'reason', 'by']);
        const by = oneOf(str(args, 'by') ?? 'DEV', ['DEV', 'AADI'] as const, 'by')!;
        const reason = str(args, 'reason');
        if (!reason) return refuse('usage');
        const ident = str(args, 'lead');
        const row = ident ? await find(ident) : null;
        const r = await createSuppression(db, actor(by), { reason, leadId: row?.leadId ?? null, email: str(args, 'email') ?? null, phone: str(args, 'phone') ?? null, domain: str(args, 'domain') ?? null }, opts);
        return r.outcome === 'APPLIED' ? { outcome: 'applied' } : refuse(r.reason);
      }
      if (kind === 'refresh') {
        const plan = await planReevaluation(db, { ledger, now: WRITE_NOW_ISO });
        // Inline re-evaluation already ran on every write, so a refresh has nothing left to change.
        assert(plan.toWrite === 0, `a refresh after inline re-evaluation changes nothing`, plan.items.filter(i => i.changedFields.length).map(i => [i.targetNumber, i.changedFields]));
        return { outcome: 'applied' };
      }
      return refuse(`unknown ${kind}`);
    } catch (e) {
      return refuse((e as Error).message);
    }
  };

  const outcomes: Array<{ label: string } & Outcome> = [];
  for (const step of SCENARIO) {
    const calls: Array<[string, string[]]> = [];
    const recorder = new Proxy({}, { get: (_t, kind: string) => (argv: string[] = []) => void calls.push([kind, argv]) }) as Parameters<typeof step.run>[0];
    step.run(recorder);
    for (const [kind, argv] of calls) outcomes.push({ label: step.label, ...(await run(kind, argv)) });
  }

  const expectedOutcomes = (writeBaseline.steps as Array<{ label: string; outcome: string }>).map(s => s.outcome);
  const diffs = outcomes.map((o, i) => ({ label: o.label, app: o.outcome, cli: expectedOutcomes[i] })).filter(d => d.app !== d.cli);
  assert(
    diffs.length === 1 && diffs[0].label === 'log the single email follow-up the ledger supports' && diffs[0].app === 'refused',
    'every step is applied or refused exactly as the CLI did — except the email follow-up, which is Titan-owned and refused (ADR-019)',
    diffs
  );
  const followUp = outcomes.find(o => o.label === 'log the single email follow-up the ledger supports');
  assert(/email_follow_up_sent_at.*TITAN/.test(followUp?.reason ?? ''), 'and it is refused by the ownership check, naming the Titan-owned field', followUp?.reason);
  const violations = await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'lead.ownership_violation'));
  assert(violations.length >= 1, 'an ownership violation is audited even though nothing was written');

  // Final state: identical to the CLI's for every lead but 001 (the refused follow-up).
  const expectedLeads = new Map<string, { record_sha: string }>((writeBaseline.leads as Array<{ target_number: string; record_sha: string }>).map(l => [l.target_number, l]));
  const finalLeads = await leadsOf(db);
  const leadDiffs = finalLeads.filter(l => l.target_number !== '001' && hash(l) !== expectedLeads.get(l.target_number)?.record_sha).map(l => l.target_number);
  assert(leadDiffs.length === 0, 'every other lead ends byte-identical to the CLI result (provenance, calls, WhatsApp, sales stage, notes, next action, timestamps)', leadDiffs);
  const lead001 = finalLeads.find(l => l.target_number === '001')!;
  assert(!lead001.email_follow_up_sent_at, 'lead 001 carries no follow-up stamp: Titan records follow-ups, not the app');

  const sup = await db.select().from(schema.suppressionEntry).orderBy(asc(schema.suppressionEntry.sequence));
  const expectedSup = writeBaseline.suppression.entries as Array<{ target_number: string | null; source: string; reason_sha: string; identifiers: string[] }>;
  assert(sup.length === expectedSup.length, `the same ${expectedSup.length} suppression entries exist`, sup.length);
  assert(
    sup.every((s, i) => (s.targetNumber ?? null) === expectedSup[i].target_number && hash(s.reason) === expectedSup[i].reason_sha),
    'in the same order, for the same targets, with the same reasons'
  );
  assert(sup.map(s => s.sequence).join(',') === '1,2,3', 'sequence numbers are allocated gap-free');
  assert(sup[0].source.startsWith('outbound-os suppression.create') && sup[2].source === 'calls:log (AADI)', 'provenance says where each entry was recorded: the app, or the call-outcome rule');

  const events = await db.select().from(schema.analyticsEvent).orderBy(asc(schema.analyticsEvent.sequence));
  const seqs = events.map(e => e.sequence);
  assert(seqs.every((s, i) => s === i + 1), 'analytics events are numbered gap-free in commit order');
  const cliTypes = writeBaseline.events.by_type as Record<string, number>;
  const appTypes: Record<string, number> = {};
  for (const e of events) appTypes[e.eventType] = (appTypes[e.eventType] ?? 0) + 1;
  const domainTypes = Object.keys(cliTypes).filter(t => !['QUALIFICATION_CHANGED', 'PRIORITY_CHANGED', 'FOLLOW_UP_SENT'].includes(t));
  assert(domainTypes.every(t => appTypes[t] === cliTypes[t]), 'every domain event the CLI appended, the app appended the same number of times', domainTypes.map(t => [t, appTypes[t], cliTypes[t]]));
  assert(!appTypes.FOLLOW_UP_SENT, 'no FOLLOW_UP_SENT event exists (it was refused)');

  // Contact values never reach an audit row or an event payload.
  const audits = await db.select().from(schema.auditEvent);
  const auditText = JSON.stringify(audits.map(a => [a.metadata, a.before, a.after]));
  const records = await leadsOf(db);
  const contactValues = records.flatMap(l => [l.decision_maker_email, l.decision_maker_phone]).filter((v): v is string => !!v && v.length > 5);
  assert(!contactValues.some(v => auditText.includes(v)), 'no contact value appears in any audit row');
  const eventText = JSON.stringify(events.map(e => e.payload));
  assert(!contactValues.some(v => eventText.includes(v)), 'no contact value appears in any event payload');

  // Every write is attributed and versioned.
  const writes = audits.filter(a => a.action.startsWith('lead.') && a.action !== 'lead.reevaluation_run' && a.action !== 'lead.write_refused' && a.action !== 'lead.ownership_violation' && a.action !== 'lead.reevaluated');
  assert(writes.length > 0 && writes.every(a => (a.metadata as Record<string, unknown>).engineActor && typeof (a.metadata as Record<string, unknown>).versionTo === 'number'), 'every lead write audit names the engine actor and the version it produced');
  await database.close();
}

// ─────────────────────────────────────────────────────────────────────────────
group('5. The applier refuses rather than guessing');
{
  const { database, ledger } = await goldenDatabase();
  const db = database.db;
  const [row] = await db.select().from(schema.lead).where(eq(schema.lead.targetNumber, '111'));
  const dev: MutationActor = { userId: null, label: 'Dev Jaiswal', engineActor: 'DEV' };
  const note = (lead: KachmoLead, ctx: { today: string; now: string }) =>
    decideResearchRecord(lead, { field: 'tech', by: 'DEV', value: 'Webflow', source: 'https://example.com/111/built-with' }, { today: ctx.today, now: ctx.now, isKnownTimezone: () => true });

  const off = await applyLeadMutation(db, { leadId: row.leadId, expectedVersion: row.version, action: 'lead.research_recorded', actor: dev, decide: note }, { env: { KACHMO_CUTOVER_PHASE: 'POST_CUTOVER' }, ledger });
  assert(off.outcome === 'REFUSED' && off.code === 'WRITES_DISABLED', 'with the switch off, nothing is written');
  const pre = await applyLeadMutation(db, { leadId: row.leadId, expectedVersion: row.version, action: 'lead.research_recorded', actor: dev, decide: note }, { env: { KACHMO_APP_WRITES: 'on' }, ledger });
  assert(pre.outcome === 'REFUSED' && pre.code === 'WRITES_DISABLED', 'before cutover, nothing is written');

  const ok = await applyLeadMutation(db, { leadId: row.leadId, expectedVersion: row.version, action: 'lead.research_recorded', actor: dev, decide: note }, { env: POST, ledger });
  assert(ok.outcome === 'APPLIED' && ok.version === row.version + 1, 'a valid write advances the version by one', ok);
  const stale = await applyLeadMutation(db, { leadId: row.leadId, expectedVersion: row.version, action: 'lead.research_recorded', actor: dev, decide: note }, { env: POST, ledger });
  assert(stale.outcome === 'REFUSED' && stale.code === 'STALE', 'resubmitting against the version you saw is refused, not layered on top (double-submit safe)');

  const [current] = await db.select().from(schema.lead).where(eq(schema.lead.leadId, row.leadId));
  const titan = await applyLeadMutation(db, { leadId: row.leadId, expectedVersion: current.version, action: 'lead.research_recorded', actor: dev, decide: () => ({ refusal: null, warnings: [], patch: { lead_state: 'SENT' } as Partial<KachmoLead>, suppression: null, events: [], summary: '' }) }, { env: POST, ledger });
  assert(titan.outcome === 'REFUSED' && titan.code === 'OWNERSHIP', 'a patch to a Titan-owned field is refused by ownership');
  const identity = await applyLeadMutation(db, { leadId: row.leadId, expectedVersion: current.version, action: 'lead.research_recorded', actor: dev, decide: () => ({ refusal: null, warnings: [], patch: { target_number: '999' } as Partial<KachmoLead>, suppression: null, events: [], summary: '' }) }, { env: POST, ledger });
  assert(identity.outcome === 'REFUSED' && identity.code === 'OWNERSHIP', 'a patch to an immutable identity field is refused');
  const estimate = await applyLeadMutation(db, { leadId: row.leadId, expectedVersion: current.version, action: 'lead.research_recorded', actor: dev, decide: () => ({ refusal: null, warnings: [], patch: { conversion_probability: 0.4 } as unknown as Partial<KachmoLead>, suppression: null, events: [], summary: '' }) }, { env: POST, ledger });
  assert(estimate.outcome === 'REFUSED' && estimate.code === 'OWNERSHIP', 'nothing can start estimating a never-estimated field');
  const unknownField = await applyLeadMutation(db, { leadId: row.leadId, expectedVersion: current.version, action: 'lead.research_recorded', actor: dev, decide: () => ({ refusal: null, warnings: [], patch: { invented_field: 'x' } as unknown as Partial<KachmoLead>, suppression: null, events: [], summary: '' }) }, { env: POST, ledger });
  assert(unknownField.outcome === 'REFUSED' && unknownField.code === 'OWNERSHIP', 'an unclassified field is deny-by-default');
  const impossible = await applyLeadMutation(db, { leadId: row.leadId, expectedVersion: current.version, action: 'lead.research_recorded', actor: dev, decide: () => ({ refusal: null, warnings: [], patch: { phone_status: 'VERIFIED', phone_verification_basis: null }, suppression: null, events: [], summary: '' }) }, { env: POST, ledger });
  assert(impossible.outcome === 'REFUSED' && impossible.code === 'INVARIANT', 'a write that would leave an impossible state (VERIFIED without a basis) is refused');
  const [unchanged] = await db.select().from(schema.lead).where(eq(schema.lead.leadId, row.leadId));
  assert(unchanged.version === current.version && unchanged.recordSha256 === current.recordSha256, 'none of those refusals changed the lead');
  const missing = await applyLeadMutation(db, { leadId: '00000000-0000-4000-8000-000000000000', expectedVersion: null, action: 'lead.research_recorded', actor: dev, decide: note }, { env: POST, ledger });
  assert(missing.outcome === 'REFUSED' && missing.code === 'NOT_FOUND', 'an unknown lead is refused');

  // A suppression committed first is seen by the next write, which the decision then refuses.
  const [l112] = await db.select().from(schema.lead).where(eq(schema.lead.targetNumber, '112'));
  const sup = await createSuppression(db, dev, { reason: 'asked on LinkedIn not to be contacted', leadId: l112.leadId }, { env: POST, ledger });
  assert(sup.outcome === 'APPLIED' && sup.added && sup.affected.includes('112'), 'a suppression flags the lead in the same transaction', sup);
  const [after112] = await db.select().from(schema.lead).where(eq(schema.lead.leadId, l112.leadId));
  const rec = after112.record as KachmoLead;
  assert(rec.do_not_contact === true && rec.research_state === 'DISQUALIFIED' && rec.lead_priority === 'DISQUALIFIED', 'the flagged lead is re-derived DISQUALIFIED in stored state, not only at render time');
  const callBlocked = await applyLeadMutation(db, { leadId: l112.leadId, expectedVersion: after112.version, action: 'lead.pipeline_transitioned', actor: dev, decide: (lead, ctx) => decidePipelineTransition(lead, { stage: 'REPLIED_POSITIVE', by: 'DEV', channel: 'EMAIL' }, ctx) }, { env: POST, ledger });
  assert(callBlocked.outcome === 'REFUSED' && callBlocked.code === 'DECISION', 'engagement on a suppressed lead is refused by core', callBlocked);
  const refusedAudit = await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'lead.write_refused'));
  assert(refusedAudit.some(a => a.targetId === l112.leadId), 'and that refusal on a blocked lead is audited');
  const dup = await createSuppression(db, dev, { reason: 'again', leadId: l112.leadId }, { env: POST, ledger });
  assert(dup.outcome === 'APPLIED' && !dup.added, 'an equivalent suppression is not duplicated');
  const dupAudit = await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'suppression.create_duplicate'));
  assert(dupAudit.length === 1, 'and the duplicate attempt is still audited');
  const system = await createSuppression(db, { userId: null, label: 'SYSTEM', engineActor: 'SYSTEM' }, { reason: 'x', domain: 'example.org' }, { env: POST, ledger });
  assert(system.outcome === 'REFUSED', 'the system cannot record a suppression');
  const freemail = await createSuppression(db, dev, { reason: 'x', domain: 'gmail.com' }, { env: POST, ledger });
  assert(freemail.outcome === 'REFUSED', 'a freemail domain suppression is refused (it would suppress everyone on it)');

  // REGRESSION (release-candidate review): revoked means lifted (ADR-010), everywhere.
  const { readCanonicalSuppression } = await import('../server/sync/publish-suppression');
  const { findEmailQueueIssues } = await import('@kachmo/core/email-ledger/queue-check.js');
  const first = await createSuppression(db, dev, { reason: 'first opt-out', email: 'person@revoked-then-again.example' }, { env: POST, ledger });
  assert(first.outcome === 'APPLIED' && first.added, 'a bare-email opt-out is recorded');
  await db.execute(sql`update suppression_entry set revoked_at = now(), revoked_by_user_id = 'owner', revoke_reason = 'recorded against the wrong address' where email = 'person@revoked-then-again.example'`);
  const lifted = await readCanonicalSuppression(db);
  const queued = [{ targetNumber: '999', to: 'person@revoked-then-again.example', companyName: 'Probe' }];
  assert(!findEmailQueueIssues(queued, [], lifted.active, new Map()).some(i => i.kind === 'SUPPRESSED'), 'once revoked, the entry is lifted for the publisher and the dispatch preflight');
  const again = await createSuppression(db, dev, { reason: 'asked again not to be contacted', email: 'person@revoked-then-again.example' }, { env: POST, ledger });
  assert(again.outcome === 'APPLIED' && again.added, 'a new opt-out equivalent only to a REVOKED entry is inserted — never swallowed as a duplicate', again);
  const after = await readCanonicalSuppression(db);
  assert(after.active.some(e => e.email === 'person@revoked-then-again.example'), 'the new entry is active, so the publisher will publish it');
  assert(findEmailQueueIssues(queued, [], after.active, new Map()).some(i => i.kind === 'SUPPRESSED' && i.blocking), 'and the dispatch preflight blocks the queued email to that person');
  const again2 = await createSuppression(db, dev, { reason: 'third time', email: 'person@revoked-then-again.example' }, { env: POST, ledger });
  assert(again2.outcome === 'APPLIED' && !again2.added, 'an equivalent ACTIVE entry still prevents a duplicate');

  // Database guards hold even against direct SQL through the app's connection.
  const tryDb = async (q: ReturnType<typeof sql>) => {
    try {
      await db.execute(q);
      return 'allowed';
    } catch (e) {
      return `${(e as Error).message} ${((e as { cause?: Error }).cause)?.message ?? ''}`;
    }
  };
  assert(/append-only/.test(await tryDb(sql`update lead_revision set superseded_by = 'x'`)), 'lead_revision cannot be rewritten');
  assert(/append-only/.test(await tryDb(sql`delete from lead_revision`)), 'lead_revision cannot be deleted from');
  await database.close();
}

// ─────────────────────────────────────────────────────────────────────────────
group('6. Engine-actor binding (ADR-021)');
{
  const database = await createRehearsalDatabase();
  const db = database.db;
  await db.insert(schema.user).values([
    { id: 'u-owner', name: 'Dev Jaiswal', email: 'dev@kachmo.test' },
    { id: 'u-aadi', name: 'Aadi', email: 'aadi@kachmo.test' },
  ]);
  let refused = '';
  try {
    await bindEngineActor(db, { userEmail: 'aadi@kachmo.test', engineActor: 'AADI', ownerLabel: 'Dev Jaiswal' });
  } catch (e) {
    refused = (e as Error).message;
  }
  assert(/No OWNER exists/.test(refused), 'nothing can be bound before an owner exists');
  await db.insert(schema.userRole).values({ userId: 'u-owner', role: 'OWNER' });
  assert((await activeEngineActor(db, 'u-aadi')) === null, 'an unbound user has no engine actor');
  let unbound = '';
  try {
    await requireEngineActor(db, 'u-aadi');
  } catch (e) {
    unbound = (e as Error).message;
  }
  assert(/not bound to an engine actor/.test(unbound), 'and cannot write: the refusal says who to ask');
  let bot = '';
  try {
    await bindEngineActor(db, { userEmail: 'aadi@kachmo.test', engineActor: 'AADI', ownerLabel: 'claude' });
  } catch (e) {
    bot = (e as Error).message;
  }
  assert(/not a named person/.test(bot), 'an agent identity cannot make a binding');
  const b = await bindEngineActor(db, { userEmail: 'AADI@kachmo.test', engineActor: 'AADI', ownerLabel: 'Dev Jaiswal' });
  assert(b.changed && (await activeEngineActor(db, 'u-aadi')) === 'AADI', 'an owner binds a user (email match is case-insensitive)');
  const same = await bindEngineActor(db, { userEmail: 'aadi@kachmo.test', engineActor: 'AADI', ownerLabel: 'Dev Jaiswal' });
  assert(!same.changed, 'binding the same actor again changes nothing');
  const rebound = await bindEngineActor(db, { userEmail: 'aadi@kachmo.test', engineActor: 'DEV', ownerLabel: 'Dev Jaiswal' });
  assert(rebound.changed && rebound.previous === 'AADI' && (await activeEngineActor(db, 'u-aadi')) === 'DEV', 'rebinding revokes the previous binding in the same transaction');
  const rows = await db.select().from(schema.userEngineActor).where(eq(schema.userEngineActor.userId, 'u-aadi'));
  assert(rows.length === 2 && rows.filter(r => r.revokedAt === null).length === 1, 'history is kept: one revoked binding, one active');
  assert(await revokeEngineActor(db, 'aadi@kachmo.test', 'Dev Jaiswal'), 'a binding can be revoked');
  assert((await activeEngineActor(db, 'u-aadi')) === null, 'after which the user cannot write');
  const audits = await db.select().from(schema.auditEvent);
  assert(audits.filter(a => a.action === 'user.engine_actor_bound').length === 2 && audits.filter(a => a.action === 'user.engine_actor_revoked').length === 2, 'every bind and revoke is audited');
  const tryDb = async (q: ReturnType<typeof sql>) => {
    try {
      await db.execute(q);
      return 'allowed';
    } catch (e) {
      return `${(e as Error).message} ${((e as { cause?: Error }).cause)?.message ?? ''}`;
    }
  };
  assert(/never deleted/.test(await tryDb(sql`delete from user_engine_actor`)), 'a binding can never be deleted');
  assert(/immutable|already revoked/.test(await tryDb(sql`update user_engine_actor set engine_actor = 'DEV'`)), 'nor edited into a different actor');
  await database.close();
}

// ─────────────────────────────────────────────────────────────────────────────
group('7. Revert is forward-only and never un-suppresses (ADR-022)');
{
  const { runRevert } = await import('../server/leads/revert');
  const { database, ledger } = await goldenDatabase();
  const db = database.db;
  const dev: MutationActor = { userId: null, label: 'Dev Jaiswal', engineActor: 'DEV' };
  const tech = (value: string) => (lead: KachmoLead, ctx: { today: string; now: string }) =>
    decideResearchRecord(lead, { field: 'tech', by: 'DEV', value, source: 'https://example.com/built-with' }, { today: ctx.today, now: ctx.now, isKnownTimezone: () => true });
  const write = async (tn: string, value: string) => {
    const [row] = await db.select().from(schema.lead).where(eq(schema.lead.targetNumber, tn));
    return applyLeadMutation(db, { leadId: row.leadId, expectedVersion: row.version, action: 'lead.research_recorded', actor: dev, decide: tech(value) }, { env: POST, ledger });
  };
  await write('111', 'Webflow');
  await write('111', 'Wordpress (typo — meant Webflow)');
  const [before] = await db.select().from(schema.lead).where(eq(schema.lead.targetNumber, '111'));
  assert(before.version === 3, 'two writes took the lead to version 3');

  const toCurrent = await runRevert(db, { targetNumber: '111', toVersion: 3, apply: false, actor: 'Dev Jaiswal', ledger });
  assert(toCurrent.plan.refusal !== null, 'reverting to the current version is refused');
  const dry = await runRevert(db, { targetNumber: '111', toVersion: 2, apply: false, actor: 'Dev Jaiswal', ledger });
  assert(!dry.applied && dry.plan.fieldsChanged.includes('current_framework'), 'the dry run shows what the revert would change', dry.plan.fieldsChanged);
  let noDigest = '';
  try {
    await runRevert(db, { targetNumber: '111', toVersion: 2, apply: true, confirm: 'nope', actor: 'Dev Jaiswal', env: POST, ledger });
  } catch (e) {
    noDigest = (e as Error).message;
  }
  assert(/plan digest/.test(noDigest), 'applying needs the dry-run digest');
  const done = await runRevert(db, { targetNumber: '111', toVersion: 2, apply: true, confirm: dry.plan.digest, actor: 'Dev Jaiswal', env: POST, ledger });
  const [after] = await db.select().from(schema.lead).where(eq(schema.lead.targetNumber, '111'));
  assert(done.applied && after.version === 4, 'the revert is a NEW version (4), not a rewind', { v: after.version });
  assert((after.record as KachmoLead).current_framework === 'Webflow', 'with the content of version 2');
  const revs = await db.select().from(schema.leadRevision).where(eq(schema.leadRevision.leadId, after.leadId));
  assert(revs.map(r => r.version).sort().join(',') === '1,2,3', 'every superseded version, including the mistaken one, is still in lead_revision');
  const audit = await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'lead.reverted'));
  assert(audit.length === 1 && audit[0].actorLabel === 'Dev Jaiswal', 'the revert is audited with the named person');

  // A suppression in the range makes the revert impossible.
  const [l112] = await db.select().from(schema.lead).where(eq(schema.lead.targetNumber, '112'));
  await write('112', 'Squarespace');
  await createSuppression(db, dev, { reason: 'asked not to be contacted', leadId: l112.leadId }, { env: POST, ledger });
  const unsuppress = await runRevert(db, { targetNumber: '112', toVersion: 1, apply: false, actor: 'Dev Jaiswal', ledger });
  assert(/never un-suppresses/.test(unsuppress.plan.refusal ?? ''), 'a revert across a suppression is refused — it would un-suppress someone', unsuppress.plan.refusal);
  await database.close();
}

console.log(`\n${'='.repeat(60)}`);
console.log(`LEAD WRITES SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.error(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
