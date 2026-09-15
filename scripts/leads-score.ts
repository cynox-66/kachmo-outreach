import { calculateLeadScores, applyScores, PRIORITY_THRESHOLDS, CONFIRMED_COMPLETENESS } from '../core/scoring/score.js';
import { loadLeads, saveLeads, logEvent } from './lib/store.js';
import { runCli } from './lib/cli.js';

// Heuristic scoring (Methodology v1.0) lives in core/scoring. Re-exported for existing callers.
export { SCORE_BASIS, PRIORITY_THRESHOLDS, CONFIRMED_COMPLETENESS, calculateLeadScores, type ScoreCalculation } from '../core/scoring/score.js';

export function scoreLeads(): Record<string, number> {
  const leads = loadLeads();
  const counts: Record<string, number> = { 'A+': 0, A: 0, B: 0, C: 0, DISQUALIFIED: 0, UNSCORED: 0, PROVISIONAL: 0 };

  for (const lead of leads) {
    const s = calculateLeadScores(lead);
    const { previousPriority, changed } = applyScores(lead, s);
    if (changed) {
      logEvent({
        lead_id: lead.lead_id, target_number: lead.target_number, company_name: lead.company_name,
        event_type: 'PRIORITY_CHANGED', channel: 'SYSTEM', actor: 'SYSTEM',
        payload: { from: previousPriority, to: s.priority, kachmo_score: s.kachmoScore },
      });
    }
    counts[s.priority ?? 'UNSCORED']++;
    if (s.priorityConfidence === 'PROVISIONAL') counts.PROVISIONAL++;
  }

  saveLeads(leads);

  console.log(`\n🎯 Heuristic Commercial Scoring (not empirical):`);
  console.log(`- Leads scored: ${leads.length}`);
  console.log(`- A+ ≥${PRIORITY_THRESHOLDS['A+']}: ${counts['A+']} | A ≥${PRIORITY_THRESHOLDS.A}: ${counts.A} | B ≥${PRIORITY_THRESHOLDS.B}: ${counts.B} | C: ${counts.C}`);
  console.log(`- DISQUALIFIED: ${counts.DISQUALIFIED} | UNSCORED: ${counts.UNSCORED}`);
  console.log(`- PROVISIONAL (research completeness < ${CONFIRMED_COMPLETENESS}%): ${counts.PROVISIONAL}`);
  return counts;
}

if (process.argv[1]?.endsWith('leads-score.ts')) {
  runCli(() => {
    scoreLeads();
  });
}
