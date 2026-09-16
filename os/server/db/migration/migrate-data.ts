/**
 * PRODUCTION DATA MIGRATION. `npm run db:migrate:data`
 *
 * This is the command that moves the real leads into the hosted database and makes Postgres canonical. It has
 * never been run. It exists so that when it is run, it is run once, deliberately, with evidence.
 *
 * It is the same code path the rehearsal exercises — `loadCanonicalSource` → `importCanonicalSource` →
 * `reconcile` → `buildManifest` — with three additions a rehearsal does not need: a preflight that refuses on
 * anything unexpected, a dry run that is the default, and a written manifest that proves what happened.
 *
 * Refuses unless ALL of these hold:
 *   - DATABASE_URL is set and parses
 *   - KACHMO_MIGRATE_CONFIRM_HOST exactly equals its host
 *   - KACHMO_MIGRATE_CONFIRM_DATA equals the acknowledgement below
 *   - the working tree is clean of source changes (the source snapshot must be reproducible)
 *   - the target tables are empty
 *   - the source passes the engine's own validation
 *   - --apply is passed explicitly; without it this is a dry run that writes nothing
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { count } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '../schema/index';
import { loadCanonicalSource, type CanonicalSource } from './source';
import { importCanonicalSource } from './import';
import { reconcile } from './reconcile';
import { buildManifest, type MigrationManifest } from './manifest';
import { snapshotFromGit, codeRevision } from './rehearse';
import { safeTargetLabel } from './hosted-target';

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
const HERE = dirname(fileURLToPath(import.meta.url));

export const DATA_MIGRATION_ACKNOWLEDGEMENT = 'MIGRATE_THE_REAL_LEADS' as const;

export type PreflightCode =
  | 'NO_DATABASE_URL'
  | 'MALFORMED_DATABASE_URL'
  | 'NO_HOST_CONFIRMATION'
  | 'WRONG_HOST_CONFIRMATION'
  | 'NO_DATA_ACKNOWLEDGEMENT'
  | 'DIRTY_WORKING_TREE'
  | 'TARGET_NOT_EMPTY'
  | 'SOURCE_INVALID';

export interface PreflightCheck {
  name: string;
  ok: boolean;
  code: PreflightCode | null;
  detail: string;
}

export interface PreflightReport {
  ok: boolean;
  checks: PreflightCheck[];
  host: string | null;
  sourceCommit: string | null;
}

/** Only the three variables that matter are read; anything else in the environment is ignored. */
export type MigrationEnvironment = Record<string, string | undefined>;

/**
 * Everything that can be checked before a connection is opened. Pure enough to test without a database:
 * `countRows` is injected so the target-occupancy check can be exercised against any backend.
 */
export async function preflight(
  env: MigrationEnvironment,
  opts: {
    countRows: () => Promise<Record<string, number>>;
    loadSource: () => CanonicalSource;
    revision: () => { commit: string; dirty: boolean; dirtyPaths: string[] };
  }
): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];
  const add = (name: string, ok: boolean, code: PreflightCode | null, detail: string) => checks.push({ name, ok, code, detail });

  const url = env.DATABASE_URL?.trim();
  if (!url) {
    add('DATABASE_URL is set', false, 'NO_DATABASE_URL', 'DATABASE_URL is not set.');
    return { ok: false, checks, host: null, sourceCommit: null };
  }
  let host: string;
  try {
    const parsed = new URL(url);
    if (!/^postgres(ql)?:$/.test(parsed.protocol) || !parsed.hostname) throw new Error('not postgres');
    host = parsed.hostname;
  } catch {
    add('DATABASE_URL parses', false, 'MALFORMED_DATABASE_URL', 'DATABASE_URL is not a PostgreSQL connection string.');
    return { ok: false, checks, host: null, sourceCommit: null };
  }
  add('DATABASE_URL parses', true, null, safeTargetLabel(url));

  const confirmHost = env.KACHMO_MIGRATE_CONFIRM_HOST?.trim();
  add(
    'the exact target host is confirmed',
    confirmHost === host,
    confirmHost ? (confirmHost === host ? null : 'WRONG_HOST_CONFIRMATION') : 'NO_HOST_CONFIRMATION',
    confirmHost === host ? host : `set KACHMO_MIGRATE_CONFIRM_HOST=${host}`
  );

  const ack = env.KACHMO_MIGRATE_CONFIRM_DATA?.trim();
  add(
    'migrating real lead data is acknowledged',
    ack === DATA_MIGRATION_ACKNOWLEDGEMENT,
    ack === DATA_MIGRATION_ACKNOWLEDGEMENT ? null : 'NO_DATA_ACKNOWLEDGEMENT',
    ack === DATA_MIGRATION_ACKNOWLEDGEMENT ? 'acknowledged' : `set KACHMO_MIGRATE_CONFIRM_DATA=${DATA_MIGRATION_ACKNOWLEDGEMENT}`
  );

  const rev = opts.revision();
  add(
    'the working tree is clean',
    !rev.dirty,
    rev.dirty ? 'DIRTY_WORKING_TREE' : null,
    rev.dirty ? `uncommitted: ${rev.dirtyPaths.slice(0, 5).join(', ')} — the migrated snapshot must be reproducible from a commit` : rev.commit.slice(0, 12)
  );

  let sourceCommit: string | null = null;
  try {
    const source = opts.loadSource();
    sourceCommit = rev.commit;
    add('the source passes the engine’s own validation', true, null, `${source.leads.length} leads · ${source.suppression.length} suppression · ${source.events.length} events`);
  } catch (e) {
    add('the source passes the engine’s own validation', false, 'SOURCE_INVALID', (e as Error).message.split('\n')[0]);
  }

  const counts = await opts.countRows();
  const occupied = Object.entries(counts).filter(([, n]) => n > 0);
  add(
    'the target tables are empty',
    occupied.length === 0,
    occupied.length ? 'TARGET_NOT_EMPTY' : null,
    occupied.length ? occupied.map(([t, n]) => `${t}=${n}`).join(', ') : 'lead, suppression_entry and analytics_event are all empty'
  );

  return { ok: checks.every(c => c.ok), checks, host, sourceCommit };
}

const targetCounts = async (db: Db): Promise<Record<string, number>> => {
  const out: Record<string, number> = {};
  for (const [name, table] of [
    ['lead', schema.lead],
    ['suppression_entry', schema.suppressionEntry],
    ['analytics_event', schema.analyticsEvent],
  ] as const) {
    const [{ n }] = await db.select({ n: count() }).from(table);
    out[name] = Number(n);
  }
  return out;
};

export interface DataMigrationResult {
  applied: boolean;
  preflight: PreflightReport;
  manifest: MigrationManifest | null;
  reconciled: boolean;
  target: string;
}

/**
 * Runs the migration. `apply` defaults to FALSE: without it this opens the connection, runs every preflight check
 * and reports what it would do, then rolls back without writing.
 */
export async function migrateData(env: MigrationEnvironment, opts: { apply: boolean; ref?: string } = { apply: false }): Promise<DataMigrationResult> {
  const url = env.DATABASE_URL ?? '';
  const target = url ? safeTargetLabel(url) : '<no target>';

  // The snapshot always comes from a commit, never the working tree.
  const ref = opts.ref ?? 'HEAD';
  let snapshotDir: string | null = null;
  const loadSource = () => {
    if (!snapshotDir) snapshotDir = snapshotFromGit(ref).dir;
    return loadCanonicalSource(snapshotDir);
  };

  if (!url) {
    const report = await preflight(env, { countRows: async () => ({}), loadSource, revision: codeRevision });
    return { applied: false, preflight: report, manifest: null, reconciled: false, target };
  }

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true }, max: 4, connectionTimeoutMillis: 15_000, statement_timeout: 300_000 });
  const db = drizzle({ client: pool, schema });
  try {
    const report = await preflight(env, { countRows: () => targetCounts(db), loadSource, revision: codeRevision });
    if (!report.ok || !opts.apply) return { applied: false, preflight: report, manifest: null, reconciled: false, target };

    const source = loadSource();
    const rev = codeRevision();
    await importCanonicalSource(db, source, `PRODUCTION MIGRATION ${rev.commit.slice(0, 12)}`);
    const reconciliation = await reconcile(db, source);
    const manifest = await buildManifest(db, source, {
      sourceCommit: rev.commit,
      codeCommit: rev.commit,
      codeTreeDirty: rev.dirty,
      codeTreeDirtyPaths: rev.dirtyPaths,
      generatedAt: new Date().toISOString(),
    });
    // Post-migration verification is part of the migration, not an optional follow-up.
    if (!reconciliation.ok || manifest.source.leadRecordsSha256 !== manifest.target.leadRecordsSha256) {
      throw new Error(
        `Post-migration verification FAILED: ${reconciliation.checks.filter(c => !c.ok).map(c => c.name).join('; ') || 'record hashes differ'}. ` +
          `The data is in the database but does not match the source. Do NOT declare cutover. Investigate before any further write.`
      );
    }
    return { applied: true, preflight: report, manifest, reconciled: true, target };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  migrateData(process.env, { apply, ref: process.argv.find(a => a.startsWith('--ref='))?.slice(6) })
    .then(result => {
      console.log(`\n🚚 Production data migration — target ${result.target}${apply ? '' : '  (DRY RUN)'}`);
      for (const c of result.preflight.checks) console.log(`   ${c.ok ? '✅' : '❌'} ${c.name} — ${c.detail}`);
      if (!result.preflight.ok) {
        console.error('\n⛔ Preflight failed. Nothing was written.');
        process.exit(2);
      }
      if (!result.applied) {
        console.log('\n✅ Dry run passed. Nothing was written.');
        console.log('   Re-run with --apply to migrate. This is irreversible in the sense that a second import is refused.');
        process.exit(0);
      }
      const outDir = join(HERE, 'out');
      mkdirSync(outDir, { recursive: true });
      const file = join(outDir, `migration-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      writeFileSync(file, `${JSON.stringify(result.manifest, null, 2)}\n`);
      console.log(`\n✅ Migrated and verified. Manifest: ${file}`);
      console.log('   Now set KACHMO_CUTOVER_PHASE=POST_CUTOVER and stop writing the JSON store.');
      process.exit(0);
    })
    .catch(err => {
      console.error(`\n❌ Migration aborted: ${(err as Error).message}`);
      console.error('   Nothing was repaired automatically. Investigate before retrying.');
      process.exit(1);
    });
}
