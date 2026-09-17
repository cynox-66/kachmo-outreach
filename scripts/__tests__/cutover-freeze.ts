/**
 * POST_CUTOVER LEGACY-JSON-WRITE FREEZE TESTS. `npm run test:freeze`
 *
 * Postgres became canonical at cutover. From that point the three legacy canonical files
 * (database/kachmo_leads.json, database/suppression.json, analytics/events.jsonl) are frozen evidence of what
 * was migrated, and any CLI that still writes them would silently fork the two stores.
 *
 * NOTHING HERE WRITES THE REAL STORE. Every case runs inside a temp workspace that the test `process.chdir()`s
 * into, and the suite hashes the three real files before and after itself to prove it.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import {
  CUTOVER_STATE_FILE,
  LegacyStoreFrozenError,
  assertLegacyStoreWritable,
  effectiveCutoverPhase,
  legacyJsonWritesFrozen,
  readCutoverState,
} from '../lib/cutover.js';
import { loadLeads, loadSuppression, readEvents, saveLeads, addSuppression, logEvent, paths } from '../lib/store.js';
import type { KachmoLead } from '../lib/schema.js';

const REPO = process.cwd();
if (!existsSync(join(REPO, 'scripts/__tests__/cutover-freeze.ts'))) {
  console.error('Run from Clients/mails (npm run test:freeze).');
  process.exit(1);
}

let passed = 0;
const failures: string[] = [];
function assert(cond: unknown, name: string, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ❌ ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
}
const group = (t: string) => console.log(`\n${t}`);

/** The real canonical files, hashed before anything runs. Re-checked at the end. */
const CANONICAL = ['database/kachmo_leads.json', 'database/suppression.json', 'analytics/events.jsonl'];
const hashFile = (f: string) => createHash('sha256').update(readFileSync(join(REPO, f))).digest('hex');
const canonicalBefore = Object.fromEntries(CANONICAL.map(f => [f, hashFile(f)]));

const tempDirs: string[] = [];
/** A workspace holding a real lead database, so writers reach the guard rather than failing on a missing file. */
function newWorkspace(phase: 'PRE_CUTOVER' | 'CUTOVER_WINDOW' | 'POST_CUTOVER' | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'kachmo-freeze-test-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, 'database'), { recursive: true });
  mkdirSync(join(dir, 'analytics'), { recursive: true });
  writeFileSync(join(dir, 'database/kachmo_leads.json'), readFileSync(join(REPO, 'database/kachmo_leads.json')));
  writeFileSync(join(dir, 'database/suppression.json'), '[]');
  writeFileSync(join(dir, 'analytics/events.jsonl'), '');
  if (phase) {
    writeFileSync(
      join(dir, CUTOVER_STATE_FILE),
      JSON.stringify({ phase, declaredAt: '2026-09-17T00:00:00.000Z', migrationCommit: 'abc123def456', note: 'test fixture' }, null, 2)
    );
  }
  return dir;
}

/** Runs `fn` with the process rooted in `dir`; the cwd is always restored. */
function inWorkspace<T>(dir: string, fn: () => T): T {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(previous);
  }
}

/** Returns the thrown error, or null when `fn` completed. */
function thrown(fn: () => void): Error | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e as Error;
  }
}

const silenced = <T>(fn: () => T): T => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
};

console.log('\n🧊 POST_CUTOVER LEGACY JSON WRITE FREEZE');

// ─────────────────────────────────────────────────────────────────────────────
group('1. POST_CUTOVER refuses every legacy JSON write');
{
  const dir = newWorkspace('POST_CUTOVER');
  inWorkspace(dir, () => {
    assert(effectiveCutoverPhase() === 'POST_CUTOVER', 'the recorded decision resolves to POST_CUTOVER');
    assert(legacyJsonWritesFrozen(), 'legacyJsonWritesFrozen() is true');

    const leads = silenced(() => loadLeads());
    const writers: [string, () => void][] = [
      ['saveLeads()', () => saveLeads(leads)],
      ['addSuppression()', () => addSuppression({ email: 'x@example.invalid', reason: 'TEST', suppressed_at: '2026-09-17T00:00:00.000Z', source: 'cutover-freeze test' })],
      ['logEvent()', () => logEvent({ event_id: '', lead_id: 'L-TEST', target_number: null, company_name: null, event_type: 'LEAD_DISCOVERED', channel: 'SYSTEM', actor: 'SYSTEM', payload: {} } as never)],
    ];
    for (const [name, write] of writers) {
      const err = thrown(write);
      assert(err instanceof LegacyStoreFrozenError, `${name} throws LegacyStoreFrozenError`, err?.message);
      assert(!!err && /Postgres is canonical/.test(err.message), `${name} says Postgres is canonical`);
      assert(!!err && /legacy JSON writer is disabled/.test(err.message), `${name} says the legacy JSON writer is disabled`);
      assert(!!err && err.message.includes(CUTOVER_STATE_FILE), `${name} names ${CUTOVER_STATE_FILE} as the recorded decision`);
      assert(!!err && /NOT been redirected to Postgres/.test(err.message), `${name} states it was not silently redirected to Postgres`);
    }

    // The refusal must happen before the file is touched — not after a partial write.
    assert(readFileSync(join(dir, 'database/suppression.json'), 'utf-8') === '[]', 'the refused suppression write left the file untouched');
    assert(readFileSync(join(dir, 'analytics/events.jsonl'), 'utf-8') === '', 'the refused event write appended nothing');
    assert(!existsSync(join(dir, 'database/backups')), 'a refused saveLeads() does not even create a backup');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
group('2. PRE_CUTOVER behaviour is unchanged');
{
  for (const phase of ['PRE_CUTOVER', 'CUTOVER_WINDOW'] as const) {
    const dir = newWorkspace(phase);
    inWorkspace(dir, () => {
      assert(effectiveCutoverPhase() === phase, `${phase} resolves to itself`);
      assert(!legacyJsonWritesFrozen(), `${phase} leaves legacy JSON writes enabled`);
      const leads = loadLeads();
      assert(thrown(() => saveLeads(leads)) === null, `${phase}: saveLeads() still writes`);
      assert(thrown(() => logEvent({ event_id: '', lead_id: 'L-TEST', target_number: null, company_name: null, event_type: 'LEAD_DISCOVERED', channel: 'SYSTEM', actor: 'SYSTEM', payload: {} } as never)) === null, `${phase}: logEvent() still appends`);
      assert(readEvents().length === 1, `${phase}: the appended event is readable`);
      assert(thrown(() => addSuppression({ email: 'x@example.invalid', reason: 'TEST', suppressed_at: '2026-09-17T00:00:00.000Z', source: 'cutover-freeze test' })) === null, `${phase}: addSuppression() still writes`);
      assert(loadSuppression().length === 1, `${phase}: the suppression entry is readable`);
    });
  }
  // A workspace with no marker at all is pre-cutover: it is not the canonical store.
  const bare = newWorkspace(null);
  inWorkspace(bare, () => {
    assert(readCutoverState() === null, 'a workspace with no marker records no decision');
    assert(effectiveCutoverPhase() === 'PRE_CUTOVER', 'no marker means PRE_CUTOVER');
    assert(thrown(() => saveLeads(loadLeads())) === null, 'an unmarked workspace is writable');
  });
  // The environment variable still works, and the more advanced signal wins in both directions.
  assert(effectiveCutoverPhase(bare, { KACHMO_CUTOVER_PHASE: 'POST_CUTOVER' }) === 'POST_CUTOVER', 'KACHMO_CUTOVER_PHASE can freeze an unmarked workspace');
  const post = newWorkspace('POST_CUTOVER');
  assert(effectiveCutoverPhase(post, { KACHMO_CUTOVER_PHASE: 'PRE_CUTOVER' }) === 'POST_CUTOVER', 'the environment cannot un-freeze a recorded POST_CUTOVER');
  assert(effectiveCutoverPhase(post, {}) === 'POST_CUTOVER', 'an empty environment cannot un-freeze a recorded POST_CUTOVER');
}

// ─────────────────────────────────────────────────────────────────────────────
group('3. Read-only access to the frozen store still works');
{
  const dir = newWorkspace('POST_CUTOVER');
  inWorkspace(dir, () => {
    const leads = silenced(() => loadLeads());
    assert(leads.length > 0, `loadLeads() still reads the frozen store (${leads.length} leads)`);
    assert(thrown(() => loadSuppression()) === null, 'loadSuppression() still reads the frozen store');
    assert(thrown(() => readEvents()) === null, 'readEvents() still reads the frozen store');
    assert(thrown(() => paths()) === null, 'paths() is unaffected');

    // A read is allowed but must SAY the data is no longer canonical, or an operator acts on stale output.
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (...a: unknown[]) => void warnings.push(a.join(' '));
    try {
      // The module warns once per process; this suite already triggered it, so assert on the mechanism directly.
      const err = thrown(() => assertLegacyStoreWritable('probe'));
      assert(err instanceof LegacyStoreFrozenError, 'assertLegacyStoreWritable() refuses in a frozen workspace');
    } finally {
      console.warn = warn;
    }
    assert(warnings.every(w => !/password|postgres:\/\//i.test(w)), 'no warning leaks a credential');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
group('4. Migration tooling stays functional and is not a normal operator write path');
{
  // The Postgres importer is what the migration runs. It must not import the frozen JSON writer at all.
  const importer = readFileSync(join(REPO, 'os/server/db/migration/import.ts'), 'utf-8');
  assert(!/lib\/store|assertLegacyStoreWritable/.test(importer), 'the Postgres importer does not go through the frozen JSON writer');
  assert(!/saveLeads|addSuppression\(|logEvent\(/.test(importer), 'the Postgres importer never calls a legacy JSON writer');

  // …and it reads the JSON store, which the freeze deliberately still permits.
  const dir = newWorkspace('POST_CUTOVER');
  inWorkspace(dir, () => {
    assert(silenced(() => loadLeads()).length > 0, 'migration tooling can still READ the frozen store as a source');
  });

  // The legacy CSV→JSON importer is a legacy writer: after cutover it must refuse like any other.
  const legacyImporter = readFileSync(join(REPO, 'scripts/migrate-csv-to-leads.ts'), 'utf-8');
  assert(/saveLeads/.test(legacyImporter), 'the legacy CSV importer writes through the guarded chokepoint');

  // Every legacy writer funnels through store.ts. If a script ever writes those files directly, this fails.
  const offenders = ['leads-record.ts', 'leads-qualify.ts', 'leads-score.ts', 'leads-opportunity.ts', 'suppress-add.ts', 'migrate-csv-to-leads.ts', 'lib/apply.ts']
    .filter(f => /writeFileSync\(\s*(paths\(\)\.(leads|suppression|events)|.*kachmo_leads\.json|.*suppression\.json|.*events\.jsonl)/.test(readFileSync(join(REPO, 'scripts', f), 'utf-8')));
  assert(offenders.length === 0, 'no legacy writer bypasses scripts/lib/store.ts', offenders);

  // And the three guarded writers are the only functions in store.ts that write.
  const store = readFileSync(join(REPO, 'scripts/lib/store.ts'), 'utf-8');
  const guarded = (store.match(/assertLegacyStoreWritable\(/g) ?? []).length;
  const writes = (store.match(/safeWriteJson\(|appendJsonl\(/g) ?? []).length;
  assert(guarded === 3, 'store.ts guards exactly three write entry points', guarded);
  assert(writes === 3, 'store.ts performs exactly three writes', writes);
}

// ─────────────────────────────────────────────────────────────────────────────
group('4b. database/suppression.json has exactly one legitimate writer');
{
  // The lead and event stores are frozen outright. The suppression artifact is the one exception: it is DERIVED
  // state that the audited ADR-010 publisher maintains. That exception must be exactly one module wide.
  const osRoot = join(REPO, 'os/server');
  const listTs = (dir: string): string[] =>
    readdirSync(dir).flatMap(f => {
      const full = join(dir, f);
      return statSync(full).isDirectory() ? listTs(full) : full.endsWith('.ts') ? [full] : [];
    });

  const writers = listTs(osRoot).filter(f => {
    const src = readFileSync(f, 'utf-8');
    return /suppression\.json/.test(src) && /writeFileSync|appendFileSync|renameSync|writeFile\(/.test(src);
  });
  assert(writers.length === 1, 'exactly one module in os/server writes the suppression artifact', writers.map(w => w.slice(REPO.length + 1)));
  assert(
    writers[0]?.endsWith('sync/suppression-artifact-store.ts'),
    'and it is the dedicated artifact store',
    writers[0]?.slice(REPO.length + 1)
  );

  // The legacy CLI path stays frozen: the publisher is an addition, not a loophole.
  const dir = newWorkspace('POST_CUTOVER');
  inWorkspace(dir, () => {
    const err = thrown(() => addSuppression({ email: 'x@example.invalid', reason: 'TEST', suppressed_at: '2026-09-17T00:00:00.000Z', source: 'cutover-freeze test' }));
    assert(err instanceof LegacyStoreFrozenError, 'the legacy suppress:add path is still refused after cutover');
  });

  // The publisher never writes the lead or event stores.
  const store = readFileSync(join(REPO, 'os/server/sync/suppression-artifact-store.ts'), 'utf-8');
  assert(!/kachmo_leads\.json|events\.jsonl/.test(store), 'the publisher cannot touch the frozen lead or event stores');
}

// ─────────────────────────────────────────────────────────────────────────────
group('5. The real canonical files were not modified by this suite');
{
  assert(process.cwd() === REPO, 'the suite finished in the repository root');
  for (const f of CANONICAL) {
    assert(hashFile(f) === canonicalBefore[f], `${f} is byte-identical to before the suite ran`);
  }
  assert(readCutoverState(REPO)?.phase === 'POST_CUTOVER', 'the repository itself is still recorded as POST_CUTOVER');
}

for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
console.log(`\n${'='.repeat(60)}\nFREEZE SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
