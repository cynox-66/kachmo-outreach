import { applyOpportunity } from '../core/leads/opportunity.js';
import { loadLeads, saveLeads, loadSuppression, paths } from './lib/store.js';
import { parseTracker } from './lib/email-state.js';
import { runCli } from './lib/cli.js';

/** Opportunity, channel strategy, readiness and next action per lead. The rules live in core/leads/opportunity.ts. */
export function evaluateOpportunities(): { ready: number; blocked: number } {
  const leads = loadLeads();
  const suppression = loadSuppression();
  const tracker = parseTracker(paths().tracker);
  let ready = 0;
  let blocked = 0;

  for (const lead of leads) {
    const outcome = applyOpportunity(lead, suppression, tracker.get(lead.target_number)?.status ?? null);
    if (outcome === 'BLOCKED') blocked++;
    else if (outcome === 'OUTREACH_READY') ready++;
  }

  saveLeads(leads);
  console.log(`\n💼 Opportunity & Channel Strategy:`);
  console.log(`- Leads analysed: ${leads.length}`);
  console.log(`- OUTREACH_READY (qualified, untouched, usable route): ${ready}`);
  console.log(`- Blocked by suppression / opt-out: ${blocked}`);
  return { ready, blocked };
}

if (process.argv[1]?.endsWith('leads-opportunity.ts')) {
  runCli(() => {
    evaluateOpportunities();
  });
}
