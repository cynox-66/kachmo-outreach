/**
 * Kachmo Outbound OS — server foundation tests. Database tests run against in-memory PostgreSQL (PGlite) with the real
 * migrations applied. No hosted database, no network, and the repository working tree is never written.
 */
import { readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { count, eq } from 'drizzle-orm';
import * as schema from '../server/db/schema/index';
import { createRehearsalDatabase } from '../server/db/rehearsal-db';
import { loadCanonicalSource, MigrationSourceError, SOURCE_FILES, type CanonicalSource } from '../server/db/migration/source';
import { importCanonicalSource, MigrationRefusedError } from '../server/db/migration/import';
import { reconcile } from '../server/db/migration/reconcile';
import { rehearse, snapshotFromGit } from '../server/db/migration/rehearse';
import { PROVENANCE_VALUES, RESEARCH_STATE_VALUES } from '@kachmo/core/leads/validation.js';

const OS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

console.log('\n🗄️  KACHMO OUTBOUND OS — DATABASE FOUNDATION');

// ─────────────────────────────────────────────────────────────────────────────
group('1. Schema mirrors core/ (no second definition of allowed values)');
{
  const sql = readFileSync(join(OS, 'server/db/migrations/0000_initial_schema.sql'), 'utf-8');
  const listOf = (constraint: string) => [...(sql.match(new RegExp(`"${constraint}" CHECK \\([^)]*?in \\(([^)]*)\\)`))?.[1] ?? '').matchAll(/'([^']+)'/g)].map(m => m[1]);
  const same = (a: string[], b: ReadonlySet<string>) => a.length === b.size && a.every(x => b.has(x));
  assert(same(listOf('lead_phone_status_check'), PROVENANCE_VALUES) && same(listOf('lead_email_status_check'), PROVENANCE_VALUES), 'phone/email provenance values equal core PROVENANCE_VALUES');
  assert(same(listOf('lead_research_state_check'), RESEARCH_STATE_VALUES), 'research states equal core RESEARCH_STATE_VALUES');
  assert(same(listOf('user_role_role_check'), new Set(schema.ROLE_VALUES)), 'role check equals ROLE_VALUES');
  const tables = [...sql.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map(m => m[1]).sort();
  const allSql = readdirSync(join(OS, 'server/db/migrations')).filter(f => f.endsWith('.sql')).map(f => readFileSync(join(OS, 'server/db/migrations', f), 'utf-8')).join('\n');
  const allTables = [...allSql.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map(m => m[1]).sort();
  // Every table is here because something needs it; an unjustified table is a place for state to hide.
  // The three research_* tables are Phase 2: a report and its candidates live BESIDE the lead table, never inside
  // it, so an uploaded report can never mutate a canonical lead.
  const JUSTIFIED_TABLES = [
    'account', 'analytics_event', 'audit_event', 'lead', 'lead_evaluation', 'lead_evidence', 'methodology_version',
    'rate_limit', 'research_brief', 'research_candidate', 'research_report', 'session', 'suppression_entry', 'user',
    'user_role', 'verification',
  ];
  assert(JSON.stringify(allTables) === JSON.stringify(JUSTIFIED_TABLES), `exactly the ${JUSTIFIED_TABLES.length} justified tables exist across all migrations`, allTables);
  assert(tables.length === 12, 'the initial migration created the 12 Phase 1.2 tables', tables);
  const statements = [sql, readFileSync(join(OS, 'server/db/migrations/0001_append_only_guards.sql'), 'utf-8')]
    .flatMap(f => f.split('--> statement-breakpoint'))
    .map(s => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean);
  const destructive = statements.filter(s => /^(DROP|TRUNCATE|DELETE)\b/i.test(s) || /\bDROP\s+(TABLE|COLUMN|CONSTRAINT|SCHEMA|INDEX)\b/i.test(s) || /\bALTER\s+TABLE\b[\s\S]*\bDROP\b/i.test(s));
  assert(statements.length > 20 && destructive.length === 0, `migrations contain no destructive statement (${statements.length} statements checked)`, destructive.map(s => s.slice(0, 80)));
}

// ─────────────────────────────────────────────────────────────────────────────
group('2. Rehearsal: the real committed dataset → in-memory PostgreSQL → reconciliation');
{
  const result = await rehearse('HEAD');
  assert(result.source.leads === 120, 'source snapshot holds the 120 real leads', result.source);
  for (const c of result.report.checks) assert(c.ok, `reconcile: ${c.name}`, c.detail);
  assert(result.secondImportRefused, 'a second import into a populated database is refused (no merge / overwrite)');
}

// ─────────────────────────────────────────────────────────────────────────────
group('3. Constraints and history guards (enforced by the database)');
{
  const { dir } = snapshotFromGit('HEAD');
  tempDirs.push(dir);
  const source = loadCanonicalSource(dir);
  const database = await createRehearsalDatabase();
  const { db, client } = database;
  await importCanonicalSource(db, source, 'TEST');
  const raw = (q: string, params: unknown[] = []) => client.query(q, params);
  const first = source.leads[0];
  const guard = /kachmo:|violates check constraint|duplicate key/;

  assert(await rejects(() => raw(`update lead set phone_status = 'MAYBE' where lead_id = $1`, [first.lead_id]), /lead_phone_status_check/), 'an invalid provenance value is rejected');
  assert(await rejects(() => raw(`update lead set record = jsonb_set(record, '{lead_id}', '"00000000-0000-4000-8000-000000000000"') where lead_id = $1`, [first.lead_id]), /lead_record_identity_check/), 'a record whose lead_id differs from the row identity is rejected');
  assert(await rejects(() => raw(`update lead set do_not_contact = true where lead_id = $1 and research_state <> 'DISQUALIFIED'`, [first.lead_id]), /lead_dnc_disqualified_check/), 'do_not_contact without DISQUALIFIED is rejected (core invariant)');
  assert(await rejects(() => raw(`delete from lead where lead_id = $1`, [first.lead_id]), guard), 'leads can never be deleted');
  assert(await rejects(() => raw(`truncate lead cascade`), guard), 'the lead table cannot be truncated');

  await db.insert(schema.auditEvent).values({ actorLabel: 'TEST', action: 'test.event', targetType: 'test' });
  assert(await rejects(() => raw(`update audit_event set actor_label = 'someone else'`), guard), 'audit events cannot be edited');
  assert(await rejects(() => raw(`delete from audit_event`), guard), 'audit events cannot be deleted');
  assert(await rejects(() => raw(`truncate audit_event`), guard), 'the audit log cannot be truncated');
  assert(await rejects(() => db.insert(schema.auditEvent).values({ actorLabel: 'TEST', action: 'NotDotted', targetType: 'test' }), /audit_event_action_format_check/), 'audit actions must be namespaced (e.g. lead.approve)');
  assert(await rejects(() => raw(`delete from analytics_event`), guard), 'analytics events cannot be deleted');

  await db.insert(schema.user).values({ id: 'u-test', name: 'Test Owner', email: 'owner@test.invalid', updatedAt: new Date() });
  assert(await rejects(() => raw(`delete from "user" where id = 'u-test'`), guard), 'users are never deleted (deactivate instead)');
  assert(await rejects(() => db.insert(schema.userRole).values({ userId: 'u-test', role: 'SUPERUSER' }), /user_role_role_check/), 'unknown roles are rejected');

  await db.insert(schema.suppressionEntry).values({ sequence: 9001, email: 'optout@test.invalid', reason: 'test opt-out', suppressedAt: '2026-09-15', source: 'test' });
  assert(await rejects(() => raw(`delete from suppression_entry where sequence = 9001`), guard), 'suppression entries can never be deleted');
  assert(await rejects(() => raw(`update suppression_entry set email = 'other@test.invalid' where sequence = 9001`), guard), 'suppression identifiers are immutable');
  assert(await rejects(() => raw(`update suppression_entry set revoked_at = now(), revoke_reason = 'x' where sequence = 9001`), guard), 'a revocation without an attributed user is rejected');
  await raw(`update suppression_entry set revoked_at = now(), revoked_by_user_id = 'u-test', revoke_reason = 'contact asked to be re-included' where sequence = 9001`);
  assert(await rejects(() => raw(`update suppression_entry set revoke_reason = 'again' where sequence = 9001`), guard), 'a revocation happens once and is then immutable');
  assert(await rejects(() => db.insert(schema.suppressionEntry).values({ sequence: 9002, email: '  ', reason: 'x', suppressedAt: '', source: 't' }), /suppression_entry_identifier_check/), 'a suppression entry with no identifier is rejected');

  const [m] = await db.select().from(schema.methodologyVersion).where(eq(schema.methodologyVersion.id, '1.0'));
  assert(m?.status === 'ACTIVE' && m.activatedAt !== null, 'methodology v1.0 is seeded ACTIVE by the import');
  assert(await rejects(() => raw(`update methodology_version set config = '{}' where id = '1.0'`), guard), 'an activated methodology version cannot be changed');
  assert(await rejects(() => raw(`delete from methodology_version where id = '1.0'`), guard), 'an activated methodology version cannot be deleted');
  assert(await rejects(() => db.insert(schema.methodologyVersion).values({ id: '1.1', status: 'ACTIVE', title: 't', description: 'd', config: {}, createdByLabel: 'TEST' }), /single_active|duplicate key/), 'only one methodology version can be ACTIVE');

  await raw(`update lead set record = jsonb_set(record, '{phone_status}', '"VERIFIED"') where lead_id = $1`, [first.lead_id]);
  const tampered = await reconcile(db, source);
  const failed = tampered.checks.filter(c => !c.ok).map(c => c.name);
  assert(!tampered.ok && failed.some(n => /identical to its source record/.test(n)) && failed.some(n => /typed columns equal/.test(n)) && failed.some(n => /provenance/.test(n)), 'reconciliation detects a silently changed provenance value', failed);
  assert(tampered.checks.every(c => !c.detail || !/@|\+\d{6,}/.test(c.detail)), 'reconciliation details contain no contact values');
  await database.close();
}

// ─────────────────────────────────────────────────────────────────────────────
group('4. Import is all-or-nothing and never overwrites');
{
  const { dir } = snapshotFromGit('HEAD');
  tempDirs.push(dir);
  const source = loadCanonicalSource(dir);
  const database = await createRehearsalDatabase();
  const broken: CanonicalSource = { ...source, events: [...source.events, source.events[0]] };
  assert(await rejects(() => importCanonicalSource(database.db, broken, 'TEST')), 'an import that fails part-way throws');
  const [{ n: leadsAfter }] = await database.db.select({ n: count() }).from(schema.lead);
  const [{ n: auditAfter }] = await database.db.select({ n: count() }).from(schema.auditEvent);
  assert(leadsAfter === 0 && auditAfter === 0, 'a failed import writes nothing (transaction rolled back)', { leadsAfter, auditAfter });
  await importCanonicalSource(database.db, source, 'TEST');
  assert((await rejects(() => importCanonicalSource(database.db, source, 'TEST'), /Refusing to import/)) !== null, 'importing into populated tables is refused');
  assert((await rejects(() => importCanonicalSource(database.db, source, 'TEST'))) !== null && MigrationRefusedError.name === 'MigrationRefusedError', 'the refusal is a MigrationRefusedError');
  const [{ n: audits }] = await database.db.select({ n: count() }).from(schema.auditEvent).where(eq(schema.auditEvent.action, 'migration.import'));
  const [auditRow] = await database.db.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'migration.import'));
  assert(audits === 1 && !/@/.test(JSON.stringify(auditRow.metadata)), 'exactly one migration.import audit event, without contact data');
  await database.close();
}

// ─────────────────────────────────────────────────────────────────────────────
group('5. Source validation fails closed');
{
  const make = (mutate: (dir: string) => void) => {
    const { dir } = snapshotFromGit('HEAD');
    tempDirs.push(dir);
    mutate(dir);
    try {
      loadCanonicalSource(dir);
      return null;
    } catch (e) {
      return e instanceof MigrationSourceError ? e.message : `UNEXPECTED ${(e as Error).message}`;
    }
  };
  const leadsPath = (d: string) => join(d, SOURCE_FILES.leads);
  const mutateLeads = (d: string, fn: (ls: Array<Record<string, unknown>>) => void) => {
    const ls = JSON.parse(readFileSync(leadsPath(d), 'utf-8'));
    fn(ls);
    writeFileSync(leadsPath(d), JSON.stringify(ls));
  };
  assert(/missing/.test(make(d => rmSync(join(d, SOURCE_FILES.suppression))) ?? ''), 'missing suppression file → rejected');
  assert(/not valid JSON/.test(make(d => writeFileSync(leadsPath(d), '{bad')) ?? ''), 'corrupt lead database → rejected');
  assert(/Duplicate target_number/.test(make(d => mutateLeads(d, ls => ls.push(ls[0]))) ?? ''), 'duplicate lead → rejected');
  assert(/not a UUID/.test(make(d => mutateLeads(d, ls => (ls[0].lead_id = 'not-a-uuid'))) ?? ''), 'non-UUID lead_id → rejected (IDs are never regenerated)');
  assert(/invariant/.test(make(d => mutateLeads(d, ls => { ls[0].phone_status = 'PUBLICLY_LISTED'; ls[0].phone_source = null; ls[0].decision_maker_phone = '+44 20 7946 0000'; })) ?? ''), 'invariant violation (PUBLICLY_LISTED without a source) → rejected');
  assert(/truncated line is not silently dropped/.test(make(d => writeFileSync(join(d, SOURCE_FILES.events), `${readFileSync(join(d, SOURCE_FILES.events), 'utf-8')}{"event_id":`)) ?? ''), 'truncated event line → rejected (the JSON store tolerates it, a migration must not)');
  assert(/has no lead_id/.test(make(d => writeFileSync(join(d, SOURCE_FILES.suppression), '[{"reason":"x","suppressed_at":"","source":"t"}]')) ?? ''), 'suppression entry without identifier → rejected');
}

// ─────────────────────────────────────────────────────────────────────────────
group('6. Hosted migration safety');
{
  const run = (env: Record<string, string>) =>
    // A deliberately minimal environment: the migration command must never inherit stray credentials.
    spawnSync(process.execPath, [join(OS, 'node_modules/tsx/dist/cli.mjs'), join(OS, 'server/db/migrate.ts')], { cwd: OS, encoding: 'utf-8', timeout: 60000, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...env } });
  const none = run({});
  assert(none.status !== 0 && /DATABASE_URL is not set/.test(none.stderr), 'db:migrate refuses without DATABASE_URL');
  const unconfirmed = run({ DATABASE_URL: 'postgresql://user:pw@ep-test.example.invalid/db' });
  assert(unconfirmed.status !== 0 && /KACHMO_MIGRATE_CONFIRM_HOST=ep-test\.example\.invalid/.test(unconfirmed.stderr), 'db:migrate refuses without explicit confirmation of the exact target host');
  const wrong = run({ DATABASE_URL: 'postgresql://user:pw@ep-test.example.invalid/db', KACHMO_MIGRATE_CONFIRM_HOST: 'ep-other.example.invalid' });
  assert(wrong.status !== 0 && /Refusing to migrate/.test(wrong.stderr) && !/pw/.test(wrong.stderr), 'db:migrate refuses a mismatched confirmation and never prints the credentials');
  const src = readFileSync(join(OS, 'server/db/migrate.ts'), 'utf-8');
  assert(!/importCanonicalSource|insert\(/.test(src), 'db:migrate applies schema only; it contains no data import');
}

for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
console.log(`\n${'='.repeat(60)}\nOS SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
