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

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');

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
}

export async function rehearse(ref = 'HEAD'): Promise<RehearsalResult> {
  const { dir, commit } = snapshotFromGit(ref);
  const database = await createRehearsalDatabase();
  try {
    const source = loadCanonicalSource(dir);
    await importCanonicalSource(database.db, source, `REHEARSAL ${commit.slice(0, 12)}`);
    const report = await reconcile(database.db, source);
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
      console.log(`   report: ${file}`);
      const ok = result.report.ok && result.secondImportRefused;
      console.log(ok ? '\n✅ Rehearsal passed. No hosted database was touched.' : '\n❌ Rehearsal FAILED. Do not migrate.');
      process.exit(ok ? 0 : 1);
    })
    .catch(err => {
      console.error(`\n❌ Rehearsal aborted: ${(err as Error).message}`);
      process.exit(1);
    });
}
