/**
 * MIGRATION REHEARSAL (dry run). `npm run db:rehearse [-- --ref=<git ref>]`
 *
 * 1. Snapshots the canonical JSON data exactly as committed at <ref> (default HEAD) into a temp directory — never the
 *    working tree, never a hosted database.
 * 2. Validates it with the engine's own rules (fails closed).
 * 3. Writes a manifest (git ref, file SHA-256s, counts, lead IDs — no contact data) to server/db/migration/out/.
 * 4. Creates an in-memory PostgreSQL (PGlite), applies all migrations, imports in one transaction, reconciles.
 * 5. Proves a second import is refused (no merge, no overwrite).
 * Exit code 0 only when every reconciliation check passes.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadCanonicalSource, SOURCE_FILES, type CanonicalSource } from './source';
import { importCanonicalSource, MigrationRefusedError } from './import';
import { reconcile, type ReconciliationReport } from './reconcile';
import { createRehearsalDatabase } from '../rehearsal-db';
import { buildManifest, type MigrationManifest } from './manifest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');

/**
 * Operator artifacts that are regenerated on every run. They are OUTPUTS of the engine, not inputs to a migration,
 * so their being modified does not make a rehearsal irreproducible.
 */
const GENERATED_ARTIFACT = /(DAILY_WAR_ROOM|AADI_DAILY_CALLS|WHATSAPP_QUEUE|RESEARCH_QUEUE|WEEKLY_OUTBOUND_REPORT)\.md$|^queues\/|^database\/research-queue\.json$/;

/**
 * Classifies `git status --porcelain` output into the paths that actually make a rehearsal irreproducible.
 *
 * Pure so it can be tested directly. The input is NOT trimmed as a whole: every porcelain line begins with a
 * two-character status column, and trimming the output would strip the first line's leading space and mis-slice
 * its filename — which is exactly the bug this function exists to keep fixed.
 */
export function significantDirtyPaths(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .filter(l => l.trim().length > 0)
    .map(l => l.slice(3).trim())
    .filter(f => f.length > 0 && !GENERATED_ARTIFACT.test(f));
}

/** HEAD of the working tree and whether it is dirty in a way that matters for reproducibility. */
export function codeRevision(repo = REPO): { commit: string; dirty: boolean; dirtyPaths: string[] } {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf-8' }).trim();
  const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf-8' });
  const dirtyPaths = significantDirtyPaths(porcelain);
  return { commit, dirty: dirtyPaths.length > 0, dirtyPaths };
}

export function snapshotFromGit(ref: string, repo = REPO): { dir: string; commit: string } {
  const commit = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: repo, encoding: 'utf-8' }).trim();
  const dir = mkdtempSync(join(tmpdir(), 'kachmo-rehearsal-'));
  for (const rel of Object.values(SOURCE_FILES)) {
    const content = execFileSync('git', ['show', `${commit}:${rel}`], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return { dir, commit };
}

export interface RehearsalResult {
  commit: string;
  source: Pick<CanonicalSource, 'fileSha256'> & { leads: number; suppression: number; events: number };
  report: ReconciliationReport;
  secondImportRefused: boolean;
  /** The exact-commit evidence record: what came from where, into which schema shape. */
  manifest: MigrationManifest;
  /** True when the manifest proves the stored records hash identically to the source records. */
  losslessByHash: boolean;
}

/**
 * A rehearsal target: an already-migrated database plus how to close it. The default is in-memory PGlite.
 * A hosted target is supplied ONLY by the separately gated entry point (rehearse-hosted.ts), so this module
 * never learns how to reach a hosted database.
 */
export interface RehearsalTarget {
  db: Parameters<typeof reconcile>[0];
  close: () => Promise<void> | void;
}

export async function rehearse(ref = 'HEAD', createTarget: () => Promise<RehearsalTarget> = createRehearsalDatabase): Promise<RehearsalResult> {
  const { dir, commit } = snapshotFromGit(ref);
  const database = await createTarget();
  try {
    const source = loadCanonicalSource(dir);
    await importCanonicalSource(database.db, source, `REHEARSAL ${commit.slice(0, 12)}`);
    const report = await reconcile(database.db, source);
    const code = codeRevision();
    const manifest = await buildManifest(database.db, source, {
      sourceCommit: commit,
      codeCommit: code.commit,
      codeTreeDirty: code.dirty,
      codeTreeDirtyPaths: code.dirtyPaths,
      generatedAt: new Date().toISOString(),
    });
    let secondImportRefused = false;
    try {
      await importCanonicalSource(database.db, source, 'REHEARSAL second import');
    } catch (e) {
      secondImportRefused = e instanceof MigrationRefusedError;
    }
    return {
      commit,
      source: { fileSha256: source.fileSha256, leads: source.leads.length, suppression: source.suppression.length, events: source.events.length },
      report,
      secondImportRefused,
      manifest,
      losslessByHash: manifest.source.leadRecordsSha256 === manifest.target.leadRecordsSha256,
    };
  } finally {
    await database.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ref = process.argv.find(a => a.startsWith('--ref='))?.slice(6) ?? 'HEAD';
  rehearse(ref)
    .then(result => {
      const outDir = join(HERE, 'out');
      mkdirSync(outDir, { recursive: true });
      const file = join(outDir, `rehearsal-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
      console.log(`\n🧪 Migration rehearsal (in-memory PostgreSQL) — source ${result.commit.slice(0, 12)}`);
      console.log(`   source: ${result.source.leads} leads · ${result.source.suppression} suppression entries · ${result.source.events} events`);
      for (const c of result.report.checks) console.log(`   ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
      console.log(`   ${result.secondImportRefused ? '✅' : '❌'} a second import into a populated database is refused`);
      console.log(`   ${result.losslessByHash ? '✅' : '❌'} stored lead records hash identically to the source records`);
      const m = result.manifest;
      console.log(`\n   manifest: source ${m.sourceCommit.slice(0, 12)} · code ${m.codeCommit.slice(0, 12)}${m.codeTreeDirty ? ` (DIRTY TREE — not reproducible: ${m.codeTreeDirtyPaths.slice(0, 5).join(', ')})` : ''}`);
      console.log(`             schema ${m.schema.migrations.map(x => x.tag).join(', ')} · ${m.schema.tables.length} tables · ${m.schema.constraints.length} constraints · ${m.schema.indexes.length} indexes · ${m.schema.triggers.length} triggers`);
      console.log(`             rows ${Object.entries(m.target.rowCounts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
      console.log(`   report: ${file}`);
      const ok = result.report.ok && result.secondImportRefused && result.losslessByHash;
      console.log(ok ? '\n✅ Rehearsal passed. No hosted database was touched.' : '\n❌ Rehearsal FAILED. Do not migrate.');
      process.exit(ok ? 0 : 1);
    })
    .catch(err => {
      console.error(`\n❌ Rehearsal aborted: ${(err as Error).message}`);
      process.exit(1);
    });
}
