/**
 * PHASE 1.5C — EXACT-COMMIT MIGRATION REHEARSAL TESTS.
 *
 * Proves the migration is deterministic, lossless, repeatable, fail-closed and auditable, and that every failure
 * mode leaves the database untouched rather than partially migrated.
 *
 * Everything runs against in-memory PostgreSQL (PGlite) with the real migrations applied. No hosted database is
 * contacted, no production data is migrated, and the repository working tree is never written.
 */
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { count, eq, sql } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../server/db/schema/index';
import { createRehearsalDatabase } from '../server/db/rehearsal-db';
import { loadCanonicalSource, type CanonicalSource } from '../server/db/migration/source';
import { importCanonicalSource } from '../server/db/migration/import';
import { reconcile } from '../server/db/migration/reconcile';
import { rehearse, snapshotFromGit, codeRevision, significantDirtyPaths } from '../server/db/migration/rehearse';
import { describeSchema } from '../server/db/migration/manifest';
import { canonicalSha256 } from '../server/db/migration/canonical';
import { leadRow } from '../server/db/migration/transform';
import type { KachmoLead } from '../../core/leads/schema.js';

const OS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(OS, 'server/db/migrations');

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
async function rejects(fn: () => Promise<unknown>, re?: RegExp): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const msg = `${(e as Error).message} ${((e as { cause?: Error }).cause?.message) ?? ''}`;
    return !re || re.test(msg) ? msg : `UNEXPECTED: ${msg}`;
  }
}
const tempDirs: string[] = [];
const snapshot = () => {
  const s = snapshotFromGit('HEAD');
  tempDirs.push(s.dir);
  return s;
};

console.log('\n🧪 KACHMO OUTBOUND OS — MIGRATION REHEARSAL (Phase 1.5C)');

const { dir: sourceDir } = snapshot();
const SOURCE = loadCanonicalSource(sourceDir);

// ─────────────────────────────────────────────────────────────────────────────
group('1. The rehearsal is an exact-commit, reproducible record');
{
  const a = await rehearse('HEAD');
  const b = await rehearse('HEAD');
  assert(a.report.ok && a.secondImportRefused && a.losslessByHash, 'the rehearsal passes end to end');
  assert(a.commit === b.commit && a.commit.length === 40, 'the rehearsal names the full source commit');
  const strip = (m: typeof a.manifest) => ({ ...m, generatedAt: '<ts>' });
  assert(JSON.stringify(strip(a.manifest)) === JSON.stringify(strip(b.manifest)), 'two rehearsals from the same commit produce an identical manifest (deterministic)');
  assert(a.manifest.source.leadRecordsSha256 === a.manifest.target.leadRecordsSha256, 'the stored records hash identically to the source records (lossless)');
  assert(a.manifest.source.leads === 120 && a.manifest.source.events === 240, 'the manifest records the source counts', { leads: a.manifest.source.leads, events: a.manifest.source.events });
  assert(a.manifest.target.rowCounts.lead === a.manifest.source.leads && a.manifest.target.rowCounts.analytics_event === a.manifest.source.events, 'every source row reached the database');
  assert(JSON.stringify(a.manifest.source.leadIds) === JSON.stringify(a.manifest.target.leadIds), 'the lead IDs in the database are exactly the source lead IDs, in the same order');
  assert(a.manifest.source.targetNumbers.length === new Set(a.manifest.source.targetNumbers).size, 'every target number in the manifest is unique');
  assert(Object.values(a.manifest.source.files).every(f => /^[0-9a-f]{64}$/.test(f.sha256)), 'every source file is pinned by SHA-256');
  assert(a.manifest.schema.migrations.length === 3 && a.manifest.schema.tables.length === 13, 'the manifest pins the schema version and table inventory', a.manifest.schema.migrations.map(m => m.tag));
  assert(a.manifest.schema.triggers.length > 0 && a.manifest.schema.indexes.length > 0 && a.manifest.schema.constraints.length > 0, 'the manifest records constraints, indexes and triggers');
  assert(!/@|\+\d{6}/.test(JSON.stringify(a.manifest)), 'the manifest holds no contact data');
  assert(typeof a.manifest.codeTreeDirty === 'boolean' && a.manifest.codeCommit === codeRevision().commit, 'the manifest records which code produced it, and whether the tree was dirty');
  assert(Object.values(a.manifest.source.provenance.phoneStatus).reduce((x, y) => x + y, 0) === 120, 'the manifest tallies contact provenance for every lead');
  assert(a.manifest.codeTreeDirty === (a.manifest.codeTreeDirtyPaths.length > 0), 'a dirty tree always names the paths that made it dirty');
}

// ─────────────────────────────────────────────────────────────────────────────
group('1b. Reproducibility is judged on real inputs, not on regenerated artifacts');
{
  // Every porcelain line starts with a two-character status column. The FIRST line's leading space is the one a
  // naive trim() eats, which silently mis-slices its filename — the regression this group exists to prevent.
  const porcelain = ' M AADI_DAILY_CALLS.md\n M queues/calling-queue.json\n M database/research-queue.json\n';
  assert(significantDirtyPaths(porcelain).length === 0, 'modified operator artifacts do not make a rehearsal irreproducible', significantDirtyPaths(porcelain));
  assert(significantDirtyPaths(' M AADI_DAILY_CALLS.md\n').length === 0, 'and that holds when the artifact is the FIRST line (the trim() regression)');
  assert(significantDirtyPaths('?? AADI_DAILY_CALLS.md\n').length === 0, 'whatever its status code');

  const real = ' M core/qualification/gates.ts\n M AADI_DAILY_CALLS.md\n';
  assert(significantDirtyPaths(real).length === 1 && significantDirtyPaths(real)[0] === 'core/qualification/gates.ts', 'a modified source file does, and is named exactly');
  assert(significantDirtyPaths('M  scripts/leads-qualify.ts\n')[0] === 'scripts/leads-qualify.ts', 'a staged change counts too');
  assert(significantDirtyPaths('').length === 0 && significantDirtyPaths('\n\n').length === 0, 'a clean tree produces nothing');
  assert(significantDirtyPaths(' M database/kachmo_leads.json\n').length === 1, 'the lead database is a migration INPUT, so changing it does make a rehearsal irreproducible');
  assert(significantDirtyPaths(' M database/suppression.json\n').length === 1, 'and so is the suppression list');
}

// ─────────────────────────────────────────────────────────────────────────────
group('2. Foreign keys, uniqueness and enum constraints are enforced by the database');
{
  const db = await createRehearsalDatabase();
  await importCanonicalSource(db.db, SOURCE, 'TEST');
  const first = SOURCE.leads[0];

  assert(
    (await rejects(() => db.db.insert(schema.lead).values(leadRow({ ...first, lead_id: '99999999-9999-4999-8999-999999999999' })), /unique|duplicate/i)) !== null,
    'a duplicate target_number is refused by a unique constraint'
  );
  assert(
    (await rejects(() => db.db.insert(schema.lead).values(leadRow(first)), /unique|duplicate|primary/i)) !== null,
    'a duplicate lead_id is refused by the primary key'
  );
  assert(
    (await rejects(
      () => db.db.insert(schema.lead).values({ ...leadRow({ ...first, lead_id: '99999999-9999-4999-8999-999999999999', target_number: '998' }), researchState: 'MADE_UP' }),
      /lead_research_state_check/
    )) !== null,
    'an invalid research_state is refused by a check constraint'
  );
  assert(
    (await rejects(
      () => db.db.insert(schema.lead).values({ ...leadRow({ ...first, lead_id: '99999999-9999-4999-8999-999999999999', target_number: '997' }), phoneStatus: 'PROBABLY_FINE' }),
      /lead_phone_status_check/
    )) !== null,
    'an invalid contact provenance value is refused by a check constraint'
  );
  assert(
    (await rejects(
      () => db.db.insert(schema.lead).values({ ...leadRow({ ...first, lead_id: '99999999-9999-4999-8999-999999999999', target_number: '996' }), leadPriority: 'S' }),
      /lead_priority_check/
    )) !== null,
    'an invented priority tier is refused by a check constraint'
  );
  assert(
    (await rejects(
      () => db.db.insert(schema.lead).values({ ...leadRow({ ...first, lead_id: '99999999-9999-4999-8999-999999999999', target_number: '995' }), researchCompletenessScore: 140 }),
      /lead_completeness_range_check/
    )) !== null,
    'a completeness score outside 0–100 is refused by a check constraint'
  );
  assert(
    (await rejects(
      () => db.db.insert(schema.lead).values({ ...leadRow({ ...first, lead_id: '99999999-9999-4999-8999-999999999999', target_number: '994' }), doNotContact: true, researchState: 'QUALIFIED' }),
      /lead_dnc_disqualified_check/
    )) !== null,
    'a do-not-contact lead that is not disqualified is refused by a check constraint'
  );
  assert(
    (await rejects(
      // The typed columns say one thing, the stored record says another: exactly the divergence the check exists for.
      () => db.db.insert(schema.lead).values({ ...leadRow(first), leadId: '99999999-9999-4999-8999-999999999999', targetNumber: '993' }),
      /lead_record_identity_check/
    )) !== null,
    'a typed column that disagrees with the stored record is refused by a check constraint'
  );
  assert(
    (await rejects(
      () =>
        db.db.insert(schema.leadEvaluation).values({
          leadId: '99999999-9999-4999-8999-999999999999',
          methodologyVersionId: '1.0',
          engineRef: 'core/',
          inputSha256: 'x',
          gates: {},
          missingIntelligence: [],
          reasons: [],
          researchState: 'QUALIFIED',
          researchCompletenessScore: 0,
          scores: {},
          actorLabel: 'TEST',
        }),
      /foreign key|violates/i
    )) !== null,
    'an evaluation for a lead that does not exist is refused by a foreign key'
  );
  assert(
    (await rejects(() => db.db.delete(schema.lead).where(eq(schema.lead.leadId, first.lead_id)), /append-only|not allowed|never deleted/i)) !== null,
    'a lead can never be deleted'
  );
  assert(
    (await rejects(() => db.db.delete(schema.analyticsEvent), /append-only|not allowed/i)) !== null,
    'the analytics event log can never be deleted from'
  );
  assert(
    (await rejects(() => db.db.update(schema.auditEvent).set({ action: 'tampered.action' }), /append-only|not allowed/i)) !== null,
    'the audit log can never be rewritten'
  );
  await db.close();
}

// ─────────────────────────────────────────────────────────────────────────────
group('3. Every failure mode leaves the database untouched (no partial migration)');
{
  const emptyAfterFailure = async (label: string, mutate: (s: CanonicalSource) => CanonicalSource, re?: RegExp) => {
    const db = await createRehearsalDatabase();
    const err = await rejects(() => importCanonicalSource(db.db, mutate(SOURCE), 'TEST'), re);
    const [{ n: leads }] = await db.db.select({ n: count() }).from(schema.lead);
    const [{ n: sup }] = await db.db.select({ n: count() }).from(schema.suppressionEntry);
    const [{ n: events }] = await db.db.select({ n: count() }).from(schema.analyticsEvent);
    const [{ n: audit }] = await db.db.select({ n: count() }).from(schema.auditEvent);
    const [{ n: methodology }] = await db.db.select({ n: count() }).from(schema.methodologyVersion);
    await db.close();
    assert(err !== null, `${label}: the import fails`, err ?? 'it succeeded');
    assert(leads === 0 && sup === 0 && events === 0 && audit === 0 && methodology === 0, `${label}: nothing at all was written`, { leads, sup, events, audit, methodology });
  };

  const badLead = (over: Partial<KachmoLead>): CanonicalSource => {
    const leads = [...SOURCE.leads];
    const broken = { ...leads[5], ...over } as KachmoLead;
    leads[5] = broken;
    return { ...SOURCE, leads, leadRecordSha256: new Map([...SOURCE.leadRecordSha256, [broken.lead_id, canonicalSha256(broken)]]) };
  };

  await emptyAfterFailure('a duplicate event id', s => ({ ...s, events: [...s.events, s.events[0]] }));
  await emptyAfterFailure('a duplicate lead id', s => ({ ...s, leads: [...s.leads, s.leads[0]] }));
  await emptyAfterFailure('an invalid research_state', () => badLead({ research_state: 'NOT_A_STATE' as KachmoLead['research_state'] }), /research_state_check/);
  await emptyAfterFailure('an invalid contact provenance', () => badLead({ phone_status: 'MAYBE' as KachmoLead['phone_status'] }), /phone_status_check/);
  await emptyAfterFailure('an out-of-range completeness score', () => badLead({ research_completeness_score: -5 }), /completeness_range_check/);
  await emptyAfterFailure('a suppression entry with no identifier', s => ({ ...s, suppression: [{ reason: 'x', suppressed_at: '', source: 't' }] }), /identifier_check/);
}

// ─────────────────────────────────────────────────────────────────────────────
group('4. Rerunning is refused, never merged');
{
  const db = await createRehearsalDatabase();
  await importCanonicalSource(db.db, SOURCE, 'FIRST');
  const before = await db.db.select({ n: count() }).from(schema.lead);
  const err = await rejects(() => importCanonicalSource(db.db, SOURCE, 'SECOND'), /Refusing to import/);
  const after = await db.db.select({ n: count() }).from(schema.lead);
  const [{ n: audits }] = await db.db.select({ n: count() }).from(schema.auditEvent).where(eq(schema.auditEvent.action, 'migration.import'));
  assert(err !== null, 'a second import into a populated database is refused');
  assert(before[0].n === after[0].n, 'the refused rerun changed no rows', { before: before[0].n, after: after[0].n });
  assert(audits === 1, 'a refused rerun writes no second audit event', audits);

  // A partially populated database is just as refused as a fully populated one.
  const db2 = await createRehearsalDatabase();
  await db2.db.insert(schema.analyticsEvent).values({ eventId: 'seed', sequence: 1, eventType: 'LEAD_DISCOVERED', channel: 'SYSTEM', actor: 'SYSTEM', occurredAt: '2026-01-01T00:00:00.000Z', payload: {} });
  const err2 = await rejects(() => importCanonicalSource(db2.db, SOURCE, 'TEST'), /analytics_event \(1 rows\)/);
  const [{ n: leadsAfter }] = await db2.db.select({ n: count() }).from(schema.lead);
  assert(err2 !== null && leadsAfter === 0, 'an import into a partially populated database is refused and writes nothing');
  await db.close();
  await db2.close();
}

// ─────────────────────────────────────────────────────────────────────────────
group('5. Stale schema and lost connections fail closed');
{
  // A database at an older schema version must fail the import, not silently succeed against a subset of tables.
  const stale = new PGlite();
  const staleDb = drizzle({ client: stale, schema });
  const journalPath = join(MIGRATIONS, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf-8'));
  const staleDir = join(OS, 'server/db/migration/out/.stale-schema-test');
  rmSync(staleDir, { recursive: true, force: true });
  mkdirSync(join(staleDir, 'meta'), { recursive: true });
  writeFileSync(join(staleDir, '0000_initial_schema.sql'), readFileSync(join(MIGRATIONS, '0000_initial_schema.sql')));
  writeFileSync(join(staleDir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }));
  await migrate(staleDb, { migrationsFolder: staleDir });

  const staleShape = await describeSchema(staleDb);
  const currentDb = await createRehearsalDatabase();
  const currentShape = await describeSchema(currentDb.db);
  assert(
    staleShape.appliedMigrationHashes.length === 1 && currentShape.appliedMigrationHashes.length === 3,
    'a stale schema is detectable: the database reports fewer applied migrations than the code ships',
    { stale: staleShape.appliedMigrationHashes.length, current: currentShape.appliedMigrationHashes.length }
  );
  assert(staleShape.journalSha256 === currentShape.journalSha256, 'the journal hash pins the CODE\'s schema version, so it alone cannot detect a stale database');
  assert(staleShape.triggers.length === 0 && currentShape.triggers.length > 0, 'the stale schema is missing the append-only guards', { stale: staleShape.triggers.length, current: currentShape.triggers.length });
  assert(staleShape.tables.length < currentShape.tables.length, 'the stale schema is missing tables the current schema has');

  // On a stale schema the append-only guarantee does not hold — proving why the manifest must pin the schema.
  await importCanonicalSource(staleDb, SOURCE, 'STALE');
  const deletedOnStale = await rejects(() => staleDb.delete(schema.analyticsEvent));
  assert(deletedOnStale === null, 'on a stale schema the event log is deletable — the guards come from migration 0001, so the schema version must be pinned');
  await stale.close();
  rmSync(staleDir, { recursive: true, force: true });

  // A connection that dies mid-import must not leave a half-written database.
  const dying = await createRehearsalDatabase();
  await dying.close();
  const err = await rejects(() => importCanonicalSource(dying.db, SOURCE, 'TEST'));
  assert(err !== null, 'an import over a closed connection fails rather than appearing to succeed');
  await currentDb.close();
}

// ─────────────────────────────────────────────────────────────────────────────
group('6. Reconciliation detects tampering, not just success');
{
  const db = await createRehearsalDatabase();
  await importCanonicalSource(db.db, SOURCE, 'TEST');
  assert((await reconcile(db.db, SOURCE)).ok, 'a faithful import reconciles');

  // Reconciliation must fail when the DATABASE and the SOURCE disagree, whichever side moved.
  const missingOne: CanonicalSource = { ...SOURCE, leads: SOURCE.leads.slice(1) };
  const r1 = await reconcile(db.db, missingOne);
  assert(!r1.ok && r1.checks.some(c => !c.ok && c.name.includes('lead count')), 'a source with fewer leads than the database fails reconciliation');

  const renamed = SOURCE.leads.map((l, i) => (i === 0 ? { ...l, company_name: `${l.company_name} (edited)` } : l));
  const tampered: CanonicalSource = { ...SOURCE, leads: renamed, leadRecordSha256: new Map(renamed.map(l => [l.lead_id, canonicalSha256(l)])) };
  const r2 = await reconcile(db.db, tampered);
  assert(!r2.ok && r2.checks.some(c => !c.ok && c.name.includes('identical to its source record')), 'a single edited field anywhere in a record fails reconciliation');

  const extraSuppression: CanonicalSource = { ...SOURCE, suppression: [{ reason: 'x', suppressed_at: '', source: 't', target_number: '001' }] };
  const r3 = await reconcile(db.db, extraSuppression);
  assert(!r3.ok && r3.checks.some(c => !c.ok && c.name.includes('suppression entries identical')), 'a suppression entry present in one side only fails reconciliation');

  const reordered: CanonicalSource = { ...SOURCE, events: [SOURCE.events[1], SOURCE.events[0], ...SOURCE.events.slice(2)] };
  const r4 = await reconcile(db.db, reordered);
  assert(!r4.ok && r4.checks.some(c => !c.ok && c.name.includes('events identical')), 'reordered events fail reconciliation (order carries meaning)');
  await db.close();
}

// ─────────────────────────────────────────────────────────────────────────────
group('7. The rehearsal never touches production');
{
  const src = readFileSync(join(OS, 'server/db/migration/rehearse.ts'), 'utf-8');
  assert(/PGlite|createRehearsalDatabase/.test(readFileSync(join(OS, 'server/db/rehearsal-db.ts'), 'utf-8')), 'the rehearsal database is in-memory PostgreSQL');
  assert(!/DATABASE_URL|neon|postgresql:\/\//i.test(src), 'the rehearsal never reads a hosted connection string');
  assert(/git', \['show'/.test(src), 'the rehearsal reads its source from git, not from the working tree');
  const manifestSrc = readFileSync(join(OS, 'server/db/migration/manifest.ts'), 'utf-8');
  assert(!/decision_maker_email|decision_maker_phone/.test(manifestSrc), 'the manifest never reads contact fields');
  const [{ n: liveRows }] = await (await createRehearsalDatabase()).db.select({ n: count() }).from(schema.lead);
  assert(liveRows === 0, 'a fresh rehearsal database starts empty');
  const check = await rejects(async () => {
    const db = await createRehearsalDatabase();
    await db.db.execute(sql`select 1`);
    await db.close();
  });
  assert(check === null, 'the rehearsal database is usable without any network access');
}

for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
console.log(`\n${'='.repeat(60)}\nMIGRATION SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
