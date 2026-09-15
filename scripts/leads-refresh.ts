import { qualifyLeads } from './leads-qualify.js';
import { scoreLeads } from './leads-score.js';
import { evaluateOpportunities } from './leads-opportunity.js';
import { generateResearchQueue } from './leads-research-queue.js';
import { runCli } from './lib/cli.js';

/** The pipeline steps depend on each other's output, so they always run in this order. */
export function refreshLeads(): void {
  qualifyLeads();
  scoreLeads();
  evaluateOpportunities();
  generateResearchQueue();
}

if (process.argv[1]?.endsWith('leads-refresh.ts')) {
  runCli(refreshLeads);
}
