import { findDuplicates, type DuplicateFinding } from '../core/leads/dedupe.js';
import { loadLeads, saveLeads, logEvent } from './lib/store.js';
import { runCli } from './lib/cli.js';

// Duplicate detection lives in core/leads/dedupe.ts. Re-exported for existing callers.
export { normalizeCompanyName, findDuplicates, type DuplicateFinding } from '../core/leads/dedupe.js';

/** Report by default. --apply only flags `possible_duplicate_of`; records are never deleted or merged. */
export function deduplicateLeads(apply = false): DuplicateFinding[] {
  const leads = loadLeads();
  const findings = findDuplicates(leads);
  console.log(`\n🔍 Duplicate check: ${leads.length} leads, ${findings.length} possible duplicate(s)`);
  for (const f of findings) console.log(`   ${f.target_number} ${f.company} ↔ ${f.duplicate_of}: ${f.reason}`);

  if (apply && findings.length) {
    for (const f of findings) {
      const l = leads.find(x => x.target_number === f.target_number)!;
      if (l.possible_duplicate_of === f.duplicate_of) continue;
      l.possible_duplicate_of = f.duplicate_of;
      l.duplicate_reason = f.reason;
      logEvent({ lead_id: l.lead_id, target_number: l.target_number, company_name: l.company_name, event_type: 'DUPLICATE_FLAGGED', channel: 'SYSTEM', actor: 'SYSTEM', payload: { duplicate_of: f.duplicate_of, reason: f.reason } });
    }
    saveLeads(leads);
    console.log('   Flagged on the lead records (nothing deleted). Resolve by hand.');
  } else if (findings.length) {
    console.log('   Report only. Re-run with --apply to flag them on the records (nothing is ever deleted).');
  }
  return findings;
}

if (process.argv[1]?.endsWith('leads-dedupe.ts')) {
  runCli(() => {
    deduplicateLeads(process.argv.includes('--apply'));
  });
}
