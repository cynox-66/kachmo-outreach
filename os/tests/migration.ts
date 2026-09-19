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
import { authorizeHostedRehearsal, DISPOSABLE_ACKNOWLEDGEMENT, safeTargetLabel } from '../server/db/migration/hosted-target';
import { preflight, DATA_MIGRATION_ACKNOWLEDGEMENT } from '../server/db/migration/migrate-data';
import { LOCAL_ENV_FILE } from '../server/db/local-env';
import { canonicalSha256 } from '../server/db/migration/canonical';
import { leadRow } from '../server/db/migration/transform';
import type { KachmoLead } from '@kachmo/core/leads/schema.js';

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
  assert(a.manifest.schema.migrations.length === 5 && a.manifest.schema.tables.length === 19, 'the manifest pins the schema version and table inventory', a.manifest.schema.migrations.map(m => m.tag));
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
    staleShape.appliedMigrationHashes.length === 1 && currentShape.appliedMigrationHashes.length === journal.entries.length,
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
group('6b. The hosted rehearsal gate: DATABASE_URL is not authorisation');
{
  const HOST = 'ep-throwaway-abc123.eu-central-1.aws.neon.tech';
  const SECRET = 'SUPER-SECRET-PASSWORD';
  const URL_ = `postgresql://user:${SECRET}@${HOST}/neondb?sslmode=require`;
  const full = {
    DATABASE_URL: URL_,
    KACHMO_REHEARSE_CONFIRM_HOST: HOST,
    KACHMO_REHEARSE_DISPOSABLE: DISPOSABLE_ACKNOWLEDGEMENT,
    KACHMO_REHEARSE_PROJECT: 'kachmo-outbound-rehearsal',
  };
  const denied = (over: Record<string, string | undefined>) => authorizeHostedRehearsal({ ...full, ...over });

  assert(authorizeHostedRehearsal(full).authorized, 'a fully acknowledged throwaway target is authorised');
  assert(authorizeHostedRehearsal(full).project === 'kachmo-outbound-rehearsal', 'and the throwaway project is recorded for the cleanup obligation');

  assert(denied({ DATABASE_URL: undefined }).code === 'NO_DATABASE_URL', 'no connection string → refused');
  assert(denied({ DATABASE_URL: 'nonsense' }).code === 'MALFORMED_DATABASE_URL', 'a malformed connection string → refused');
  assert(denied({ DATABASE_URL: 'https://example.com/db' }).code === 'MALFORMED_DATABASE_URL', 'a non-PostgreSQL URL → refused');
  assert(denied({ KACHMO_REHEARSE_CONFIRM_HOST: undefined }).code === 'NO_CONFIRMATION', 'DATABASE_URL alone is NOT authorisation — the host must be named');
  assert(denied({ KACHMO_REHEARSE_CONFIRM_HOST: 'ep-other.neon.tech' }).code === 'WRONG_CONFIRMATION', 'naming a different host → refused');
  assert(denied({ KACHMO_REHEARSE_DISPOSABLE: undefined }).code === 'NO_DISPOSABLE_ACKNOWLEDGEMENT', 'without the disposability acknowledgement → refused');
  assert(denied({ KACHMO_REHEARSE_DISPOSABLE: 'yes' }).code === 'NO_DISPOSABLE_ACKNOWLEDGEMENT', 'and an approximate acknowledgement does not count');
  assert(denied({ KACHMO_REHEARSE_PROJECT: undefined }).code === 'NO_DISPOSABLE_PROJECT', 'the throwaway project must be named, so the cleanup obligation is written down');
  assert(denied({ KACHMO_REHEARSE_PROJECT: 'kachmo-production' }).code === 'PROJECT_LOOKS_LIKE_PRODUCTION', 'a production-looking project name → refused');
  assert(denied({ DATABASE_URL: `postgresql://u:p@ep-prod-main.neon.tech/db`, KACHMO_REHEARSE_CONFIRM_HOST: 'ep-prod-main.neon.tech' }).code === 'TARGET_LOOKS_LIKE_PRODUCTION', 'a production-looking host → refused');

  // The denylist is the one check no acknowledgement can satisfy.
  assert(denied({ KACHMO_PRODUCTION_HOSTS: `something.else, ${HOST}` }).code === 'TARGET_ON_PRODUCTION_DENYLIST', 'a denylisted host is refused despite every acknowledgement being present');
  assert(denied({ KACHMO_PRODUCTION_HOSTS: HOST.toUpperCase() }).code === 'TARGET_ON_PRODUCTION_DENYLIST', 'and the denylist is case-insensitive');

  // Nothing about a refusal may carry the credential.
  const everyResult = [authorizeHostedRehearsal(full), denied({ KACHMO_REHEARSE_CONFIRM_HOST: 'x' }), denied({ KACHMO_REHEARSE_PROJECT: undefined }), denied({ KACHMO_PRODUCTION_HOSTS: HOST })];
  assert(everyResult.every(r => !JSON.stringify(r).includes(SECRET)), 'no authorisation result contains the password');
  assert(everyResult.every(r => !JSON.stringify(r).includes('user:')), 'nor the username');
  assert(safeTargetLabel(URL_) === `postgresql://${HOST}/neondb`, 'the target label is scheme, host and database only');
  assert(!safeTargetLabel(URL_).includes(SECRET), 'and never the credential');

  const src = readFileSync(join(OS, 'server/db/migration/rehearse.ts'), 'utf-8');
  assert(!/DATABASE_URL|neon|postgresql:\/\//i.test(src), 'the DEFAULT rehearsal still never learns how to reach a hosted database');
}

// ─────────────────────────────────────────────────────────────────────────────
group('6c. The production data-migration preflight');
{
  const HOST = 'ep-prodtarget-xyz.eu-central-1.aws.neon.tech';
  const SECRET = 'PRODUCTION-PASSWORD';
  const full = {
    DATABASE_URL: `postgresql://user:${SECRET}@${HOST}/neondb`,
    KACHMO_MIGRATE_CONFIRM_HOST: HOST,
    KACHMO_MIGRATE_CONFIRM_DATA: DATA_MIGRATION_ACKNOWLEDGEMENT,
  };
  const clean = (): { commit: string; dirty: boolean; dirtyPaths: string[] } => ({ commit: 'a'.repeat(40), dirty: false, dirtyPaths: [] });
  const source = loadCanonicalSource(sourceDir);
  const run = (env: Record<string, string | undefined>, countRows: () => Promise<Record<string, number>>, revision = clean) =>
    preflight(env, { countRows, loadSource: () => source, revision });
  const empty = async () => ({ lead: 0, suppression_entry: 0, analytics_event: 0 });
  const codeOf = (r: Awaited<ReturnType<typeof run>>) => r.checks.find(c => !c.ok)?.code ?? null;

  const okReport = await run(full, empty);
  assert(okReport.ok, 'a confirmed, clean, empty, valid target passes preflight', okReport.checks.filter(c => !c.ok));
  assert(okReport.host === HOST, 'and the host is reported');
  assert(!JSON.stringify(okReport).includes(SECRET), 'no preflight report contains the password');

  assert(codeOf(await run({ ...full, DATABASE_URL: undefined }, empty)) === 'NO_DATABASE_URL', 'no connection string → refused');
  assert(codeOf(await run({ ...full, DATABASE_URL: 'nonsense' }, empty)) === 'MALFORMED_DATABASE_URL', 'a malformed connection string → refused');
  assert(codeOf(await run({ ...full, KACHMO_MIGRATE_CONFIRM_HOST: undefined }, empty)) === 'NO_HOST_CONFIRMATION', 'the exact host must be named');
  assert(codeOf(await run({ ...full, KACHMO_MIGRATE_CONFIRM_HOST: 'ep-other.neon.tech' }, empty)) === 'WRONG_HOST_CONFIRMATION', 'naming a different host → refused');
  assert(codeOf(await run({ ...full, KACHMO_MIGRATE_CONFIRM_DATA: undefined }, empty)) === 'NO_DATA_ACKNOWLEDGEMENT', 'migrating real leads must be acknowledged');
  assert(codeOf(await run({ ...full, KACHMO_MIGRATE_CONFIRM_DATA: 'ok' }, empty)) === 'NO_DATA_ACKNOWLEDGEMENT', 'and an approximate acknowledgement does not count');

  const dirty = await run(full, empty, () => ({ commit: 'a'.repeat(40), dirty: true, dirtyPaths: ['core/qualification/gates.ts'] }));
  assert(codeOf(dirty) === 'DIRTY_WORKING_TREE', 'a dirty tree → refused: the migrated snapshot must be reproducible from a commit');
  assert(dirty.checks.some(c => !c.ok && c.detail.includes('core/qualification/gates.ts')), 'and the offending path is named');

  const occupied = await run(full, async () => ({ lead: 120, suppression_entry: 0, analytics_event: 240 }));
  assert(codeOf(occupied) === 'TARGET_NOT_EMPTY', 'a populated target → refused; a migration never merges into existing rows');
  assert(occupied.checks.some(c => !c.ok && c.detail.includes('lead=120')), 'and says what is already there');

  // The two failures an operator must never confuse.
  const missingSchema = await run(full, async () => { throw Object.assign(new Error('relation "lead" does not exist'), { code: '42P01' }); });
  assert(codeOf(missingSchema) === 'SCHEMA_NOT_APPLIED', 'a target with no schema is reported as such, not as an opaque query failure');
  assert(missingSchema.checks.some(c => !c.ok && c.detail.includes('db:migrate')), 'and names the command that fixes it');
  const unreachable = await run(full, async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); });
  assert(codeOf(unreachable) === 'TARGET_UNREACHABLE', 'an unreachable host is reported as unreachable, not as a missing table');

  // A failing preflight must stop at the first thing that touches the database.
  assert(occupied.checks.filter(c => !c.ok).length >= 1 && missingSchema.checks.every(c => c.name !== 'the target tables are empty'), 'when the schema is absent, emptiness is not also claimed to have been checked');
}

// ─────────────────────────────────────────────────────────────────────────────
group('6d. Operator commands read the documented local config');
{
  assert(LOCAL_ENV_FILE.endsWith('/.env.local') && LOCAL_ENV_FILE.includes('/os/'), 'the local env file is os/.env.local', LOCAL_ENV_FILE);
  const localEnv = readFileSync(join(OS, 'server/db/local-env.ts'), 'utf-8');
  assert(/override: false/.test(localEnv), 'an env-file value never overrides one already exported deliberately');
  // It may name a PATH (that is the misplaced-file warning); it must never surface a VALUE.
  assert(!/\.parsed/.test(localEnv), 'the loader never reads back the parsed values');
  assert(!/console\.[a-z]+\([^)]*process\.env/.test(localEnv), 'and never logs anything out of the environment it just populated');
  assert(/loaded: (true|false)/.test(localEnv) && !/values|contents/.test(localEnv.split('export function')[1] ?? ''), 'it returns only whether a file was loaded, never what was in it');

  // Every operator-facing database command must read the place the operator is told to put the connection string.
  for (const cmd of ['server/db/migrate.ts', 'server/db/migration/migrate-data.ts', 'server/db/migration/rehearse-hosted.ts']) {
    assert(/loadLocalEnv\(\)/.test(readFileSync(join(OS, cmd), 'utf-8')), `${cmd} loads os/.env.local`);
  }
  // …and the PGlite-only rehearsal still must not.
  assert(!/loadLocalEnv/.test(readFileSync(join(OS, 'server/db/migration/rehearse.ts'), 'utf-8')), 'the default rehearsal does not, because it has no hosted target to configure');

  // The opt-out that keeps an isolated process isolated. Without it, any spawned migration command inherits the
  // operator's real target, and a test that believes it is running against nothing runs against production.
  const localEnvSrc = readFileSync(join(OS, 'server/db/local-env.ts'), 'utf-8');
  assert(/KACHMO_NO_LOCAL_ENV/.test(localEnvSrc), 'a process can opt out of loading the local config entirely');
  assert(localEnvSrc.indexOf('KACHMO_NO_LOCAL_ENV') < localEnvSrc.indexOf('existsSync(MISPLACED_ENV_FILE)'), 'and the opt-out is checked before anything else is read');
  assert(/KACHMO_NO_LOCAL_ENV: '1'/.test(readFileSync(join(OS, 'tests/run.ts'), 'utf-8')), 'the spawned-command tests set it, so they never inherit a real target');
  assert(/MISPLACED_ENV_FILE/.test(localEnvSrc) && !/loadEnvFile\(\{ path: MISPLACED_ENV_FILE/.test(localEnvSrc), 'a misplaced config file is reported but never loaded');

  const schemaMigrate = readFileSync(join(OS, 'server/db/migrate.ts'), 'utf-8');
  assert(/node-postgres/.test(schemaMigrate) && !/neon-http/.test(schemaMigrate), 'schema migration uses the transport the hosted rehearsal proved, so DDL is transactional');
  assert(/rejectUnauthorized: true/.test(schemaMigrate), 'and always verifies the server certificate');
  assert(!/importCanonicalSource|insert\(/.test(schemaMigrate), 'db:migrate applies schema only; it contains no data import');
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
