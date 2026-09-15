import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { safeReadJson, safeWriteJson } from './lib/safe-io.js';
import type { ResearchQueueItem } from './lib/schema.js';
import { loadLeads, loadSuppression, paths } from './lib/store.js';
import { parseTracker } from './lib/email-state.js';
import { priorityLabel, signalSummary } from './lib/text.js';
import { runCli } from './lib/cli.js';
import { buildResearchQueue } from '../core/research/tasks.js';

// Research task rules live in core/research/tasks.ts. Re-exported for existing callers.
export { taskFor } from '../core/research/tasks.js';

export function generateResearchQueue(): { items: ResearchQueueItem[] } {
  const p = paths();
  const leads = loadLeads();
  const suppression = loadSuppression();
  const tracker = parseTracker(p.tracker);
  const existing = safeReadJson<ResearchQueueItem[]>(p.researchQueue, []);
  const existingById = new Map((Array.isArray(existing) ? existing : []).map(i => [i.lead_id, i]));
  const now = new Date().toISOString();

  const items = buildResearchQueue(leads, suppression, tn => tracker.get(tn)?.status ?? null, existingById, now);

  safeWriteJson(p.researchQueue, items);
  const leadById = new Map(leads.map(l => [l.lead_id, l]));

  const md: string[] = [
    '# Research Queue',
    '',
    `> Generated ${now}. ${items.length} leads have open research tasks. Regenerate with \`npm run leads:research-queue\`.`,
    '> This queue lists what to find out. The engine does not research anything by itself: record what you find with `npm run leads:record`, then `npm run leads:refresh`.',
    '',
    '| # | Target | Company | Priority | Research | Top task | Owner | Status |',
    '| --: | :-- | :-- | :-- | --: | :-- | :-- | :-- |',
    ...items.map(
      (i, n) =>
        `| ${n + 1} | ${i.target_number} | ${i.company} | ${priorityLabel(i.priority, i.priority_confidence)} | ${i.research_completeness_score}% | ${i.specific_research_tasks[0].field} | ${i.owner} | ${i.status} |`
    ),
    '',
    '## Next 25 in detail',
    '',
  ];
  for (const [n, i] of items.slice(0, 25).entries()) {
    md.push(`### ${n + 1}. [${i.target_number}] ${i.company} — ${priorityLabel(i.priority, i.priority_confidence)} · signals: ${signalSummary(leadById.get(i.lead_id)?.score_signals)} · research ${i.research_completeness_score}% · ${i.owner}`);
    for (const t of i.specific_research_tasks.slice(0, 4)) {
      md.push(`- [ ] **${t.field}**: ${t.task}`, `  - Evidence: ${t.evidence_needed}`, `  - Record: \`${t.record_with}\``);
    }
    if (i.specific_research_tasks.length > 4) md.push(`- …${i.specific_research_tasks.length - 4} more in database/research-queue.json`);
    md.push('');
  }
  writeFileSync(resolve(process.cwd(), 'RESEARCH_QUEUE.md'), md.join('\n'), 'utf-8');

  console.log(`\n📋 Research queue: ${items.length} leads with open tasks → RESEARCH_QUEUE.md`);
  return { items };
}

if (process.argv[1]?.endsWith('leads-research-queue.ts')) {
  runCli(() => {
    generateResearchQueue();
  });
}
