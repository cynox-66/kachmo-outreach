import { generateResearchQueue } from './leads-research-queue.js';
import { parseArgs, str, runCli } from './lib/cli.js';
import { priorityLabel } from './lib/text.js';

/**
 * Intelligence-GAP INSPECTOR. This command performs no research, fetches nothing and changes no lead.
 * It shows what is missing and how to record it once a human has found it.
 */
export function runEnrichmentAudit(argv: string[]): void {
  const args = parseArgs(argv, ['priority', 'target']);
  const priority = str(args, 'priority');
  const target = str(args, 'target');

  let items = generateResearchQueue().items;
  if (priority) items = items.filter(i => i.priority === priority.toUpperCase());
  if (target) items = items.filter(i => i.target_number === target.padStart(3, '0'));

  console.log('\n🔎 Intelligence gap report (no research is performed by this command)');
  console.log(`${items.length} matching leads with open research tasks\n`);
  for (const item of items.slice(0, 15)) {
    console.log(`[${item.target_number}] ${item.company} — ${priorityLabel(item.priority, item.priority_confidence)} · research ${item.research_completeness_score}% · ${item.owner}`);
    for (const t of item.specific_research_tasks) {
      console.log(`   • ${t.field}: ${t.task}`);
      console.log(`     record: ${t.record_with}`);
    }
    console.log('');
  }
  if (items.length > 15) console.log(`… and ${items.length - 15} more (RESEARCH_QUEUE.md)`);
}

if (process.argv[1]?.endsWith('leads-enrich.ts')) {
  runCli(() => runEnrichmentAudit(process.argv.slice(2)));
}
