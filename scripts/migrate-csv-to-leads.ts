import { readFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { paths, loadLeads, saveLeads, logEvent } from './lib/store.js';
import { parseTracker } from './lib/email-state.js';
import { runCli } from './lib/cli.js';
import { planCsvMigration } from '../core/leads/csv.js';

// The CSV contract, row mapping and human-data preservation rules live in core/leads/csv.ts.
export { CSV_COLUMNS, parseCsv, escapeCsvField, csvExportCells, renderLeadsCsv, preserveHumanData, leadFromCsvRow, planCsvMigration, PRESERVE_IF_SET } from '../core/leads/csv.js';

export function runMigration(opts: { force: boolean }): { total: number; created: number; preserved: number } {
  const p = paths();
  if (!existsSync(p.csv)) throw new Error(`CSV file not found at ${p.csv}`);
  if (existsSync(p.leads) && !opts.force) {
    throw new Error(
      `Lead database already exists at ${p.leads}. Re-running re-derives legacy fields from the CSV. ` +
        `Use --force to proceed (lead_ids and human-entered data are preserved; a backup is written).`
    );
  }

  const existing = existsSync(p.leads) ? loadLeads() : [];
  const plan = planCsvMigration(readFileSync(p.csv, 'utf-8'), existing, parseTracker(p.tracker), {
    now: new Date().toISOString(),
    newLeadId: randomUUID,
  });
  if (plan.errors.length) {
    const header = plan.errors.length === 1 && plan.errors[0].startsWith('Unexpected CSV header');
    if (header) throw new Error(plan.errors[0]);
    throw new Error(`Migration aborted, nothing written. ${plan.errors.length} problem(s):\n  - ${plan.errors.join('\n  - ')}`);
  }

  const newTargets = new Set(plan.newTargetNumbers);
  saveLeads(plan.leads, { basedOn: existing });
  for (const l of plan.leads) {
    if (newTargets.has(l.target_number) && l.migrated_from_csv) {
      logEvent({ lead_id: l.lead_id, target_number: l.target_number, company_name: l.company_name, event_type: 'LEAD_DISCOVERED', channel: 'SYSTEM', actor: 'SYSTEM', payload: { source: 'kachmo_targets.csv' } });
    }
  }

  const preserved = plan.leads.length - plan.created;
  console.log(`✅ Migrated ${plan.leads.length} leads (${plan.created} new, ${preserved} existing with lead_id and human data preserved) → ${p.leads}`);
  return { total: plan.leads.length, created: plan.created, preserved };
}

if (process.argv[1]?.endsWith('migrate-csv-to-leads.ts')) {
  runCli(() => {
    runMigration({ force: process.argv.includes('--force') });
  });
}
