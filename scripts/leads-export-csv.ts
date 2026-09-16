import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { ensureDir } from './lib/safe-io.js';
import { loadLeads, paths } from './lib/store.js';
import { parseArgs, str, runCli } from './lib/cli.js';
import { renderLeadsCsv } from '../core/leads/csv.js';

/** Exports the legacy 15-column shape. Never writes the protected production kachmo_targets.csv. */
export function exportLeadsToCsv(outputPath?: string): string {
  const target = resolve(process.cwd(), outputPath ?? 'database/kachmo_targets_export.csv');
  if (target === paths().csv) {
    throw new Error('kachmo_targets.csv is a protected production file; V2 never overwrites it. Choose another --output.');
  }
  const leads = loadLeads();
  if (!leads.length) throw new Error('Database contains 0 leads. Aborting export.');

  ensureDir(dirname(target));
  writeFileSync(target, renderLeadsCsv(leads), 'utf-8');
  console.log(`✅ Exported ${leads.length} leads → ${target}`);
  return target;
}

if (process.argv[1]?.endsWith('leads-export-csv.ts')) {
  runCli(() => {
    exportLeadsToCsv(str(parseArgs(process.argv.slice(2), ['output']), 'output'));
  });
}
