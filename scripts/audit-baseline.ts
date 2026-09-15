import { createHash } from 'crypto';
import { readFileSync, statSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fail, runCli } from './lib/cli.js';

/** The legacy Titan email subsystem. V2 must never write these. */
export const PROTECTED_FILES = [
  'scripts/send-titan-smtp.ts',
  'scripts/create-titan-drafts.ts',
  'scripts/cron-dispatch.ts',
  '.github/workflows/outreach-dispatch.yml',
  'scheduled-queue.json',
  'batch4.json',
  'batch5.json',
  'OUTREACH_TRACKER.md',
  '.last-send-results.json',
  '.env',
  'kachmo_targets.csv',
];

export function latestBaselineFile(repo: string = process.cwd()): string {
  const dirs = readdirSync(join(repo, 'audit')).filter(d => d.startsWith('baseline-')).sort();
  if (!dirs.length) throw new Error('No audit/baseline-*/ directory found.');
  return join(repo, 'audit', dirs[dirs.length - 1], 'protected-checksums.txt');
}

/**
 * Records a NEW protected-file baseline. Run it only after confirming that any change to a protected file
 * came from outside V2, e.g. a `git pull` of the cron's own commit. Existing baselines are never overwritten.
 */
export function captureBaseline(repo: string = process.cwd()): string {
  const dir = join(repo, 'audit', `baseline-${new Date().toISOString().slice(0, 16).replace(':', '')}`);
  if (existsSync(dir)) fail(`${dir} already exists; wait a minute and re-run.`);
  const lines = PROTECTED_FILES.map(f => {
    const full = join(repo, f);
    const s = statSync(full);
    return `${createHash('sha256').update(readFileSync(full)).digest('hex')}  ${s.size}  ${s.mtime.toISOString().slice(0, 19)}  ${f}`;
  });
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'protected-checksums.txt');
  writeFileSync(out, `${lines.join('\n')}\n`);
  return out;
}

if (process.argv[1]?.endsWith('audit-baseline.ts')) {
  runCli(() => {
    console.log(`✅ New protected-file baseline: ${captureBaseline()}`);
    console.log('   Only valid if every change since the previous baseline came from git (e.g. the cron commit), not from V2.');
  });
}
