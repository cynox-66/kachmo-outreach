import { evaluateLeadGates, applyQualification } from '../core/qualification/gates.js';
import { loadLeads, saveLeads, loadSuppression, paths, logEvent } from './lib/store.js';
import { parseTracker } from './lib/email-state.js';
import { runCli } from './lib/cli.js';

// The 8-gate evaluation (Methodology v1.0) lives in core/qualification. Re-exported for existing callers.
export { evaluateLeadGates, isGenericDecisionMaker } from '../core/qualification/gates.js';

export function qualifyLeads(): Record<string, number> {
  const leads = loadLeads();
  const suppression = loadSuppression();
  const tracker = parseTracker(paths().tracker);
  const counts: Record<string, number> = { QUALIFIED: 0, RESEARCH_REQUIRED: 0, DISQUALIFIED: 0 };
  const now = new Date().toISOString();

  for (const lead of leads) {
    const r = evaluateLeadGates(lead, suppression, tracker.get(lead.target_number)?.status ?? null);
    const { previousState, changed } = applyQualification(lead, r, now);
    if (changed) {
      logEvent({
        lead_id: lead.lead_id, target_number: lead.target_number, company_name: lead.company_name,
        event_type: 'QUALIFICATION_CHANGED', channel: 'SYSTEM', actor: 'SYSTEM',
        payload: { from: previousState, to: r.state, reasons: r.reasons },
      });
    }
    counts[r.state]++;
  }

  saveLeads(leads);

  console.log(`\n⚖️  8-Gate Qualification:`);
  console.log(`- Leads evaluated: ${leads.length}`);
  console.log(`- QUALIFIED (no blocking gate; UNVERIFIED claims allowed): ${counts.QUALIFIED}`);
  console.log(`- RESEARCH_REQUIRED (a required fact is missing): ${counts.RESEARCH_REQUIRED}`);
  console.log(`- DISQUALIFIED (evidence-based FAIL or outreach blocked): ${counts.DISQUALIFIED}`);
  return counts;
}

if (process.argv[1]?.endsWith('leads-qualify.ts')) {
  runCli(() => {
    qualifyLeads();
  });
}
