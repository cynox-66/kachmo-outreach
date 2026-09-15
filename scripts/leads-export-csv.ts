import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { ensureDir } from './lib/safe-io.js';
import { loadLeads, paths } from './lib/store.js';
import { CSV_COLUMNS } from './migrate-csv-to-leads.js';
import { parseArgs, str, runCli } from './lib/cli.js';

function escapeCsvField(val: string | null | undefined): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Exports the legacy 15-column shape. Never writes the protected production kachmo_targets.csv. */
export function exportLeadsToCsv(outputPath?: string): string {
  const target = resolve(process.cwd(), outputPath ?? 'database/kachmo_targets_export.csv');
  if (target === paths().csv) {
    throw new Error('kachmo_targets.csv is a protected production file; V2 never overwrites it. Choose another --output.');
  }
  const leads = loadLeads();
  if (!leads.length) throw new Error('Database contains 0 leads. Aborting export.');

  const rows = [CSV_COLUMNS.join(',')];
  for (const l of leads) {
    rows.push(
      [
        l.target_number, l.raw_archetype_id || l.archetype_id, l.archetype_label, l.company_name, l.website_url, l.location_city,
        l.location_country, l.estimated_scale, l.decision_maker_name, l.decision_maker_title,
        l.raw_contact_route || l.decision_maker_email || l.decision_maker_phone || '', l.commercial_validation_signal,
        l.observable_friction, l.kachmo_solution_angle, l.personalized_outreach_hook,
      ].map(escapeCsvField).join(',')
    );
  }
  ensureDir(dirname(target));
  writeFileSync(target, rows.join('\n') + '\n', 'utf-8');
  console.log(`✅ Exported ${leads.length} leads → ${target}`);
  return target;
}

if (process.argv[1]?.endsWith('leads-export-csv.ts')) {
  runCli(() => {
    exportLeadsToCsv(str(parseArgs(process.argv.slice(2), ['output']), 'output'));
  });
}
