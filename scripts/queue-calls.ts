import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { safeWriteJson } from './lib/safe-io.js';
import type { CallingCard } from './lib/schema.js';
import { loadLeads, loadSuppression, paths } from './lib/store.js';
import { parseTracker } from './lib/email-state.js';
import { todayIst } from './lib/geo.js';
import { short, priorityLabel, signalSummary } from './lib/text.js';
import { runCli } from './lib/cli.js';
import { selectCallQueue } from '../core/queues/calls.js';

// Call eligibility, call cards and queue ordering live in core/queues/calls.ts. Re-exported for existing callers.
export { MAX_UNANSWERED_ATTEMPTS, MIN_HOURS_BETWEEN_ATTEMPTS, callEligibility, buildCallCard } from '../core/queues/calls.js';

export function generateCallingQueue(): { total: number; cards: CallingCard[]; excluded: Array<{ target_number: string; company: string; reason: string }> } {
  const p = paths();
  const leads = loadLeads();
  const suppression = loadSuppression();
  const tracker = parseTracker(p.tracker);
  const today = todayIst();

  const { cards, excluded } = selectCallQueue(leads, suppression, tn => tracker.get(tn)?.status ?? null, today);
  const generatedAt = new Date().toISOString();
  safeWriteJson(p.callingQueue, { generated_at: generatedAt, cards, excluded });

  const md: string[] = [
    '# Aadi: Calls',
    '',
    `> Generated ${generatedAt} (IST date ${today}). **Regenerate before calling** (\`npm run queue:calls\`); an old copy can include someone who has since opted out.`,
    `> Only phones with a recorded public source or a verified basis are listed. ${cards.length} to call.`,
    '',
  ];
  if (!cards.length) md.push('**No callable leads right now.** See the exclusions below: most need a phone source recorded first (RESEARCH_QUEUE.md).', '');
  for (const c of cards) {
    md.push(
      `## ${c.target_number} · ${c.company_name}: ${c.decision_maker_name} (${c.decision_maker_title})`,
      `📞 \`${c.phone_number}\` · ${c.phone_status} (${c.phone_source}) · ${c.location_city}${c.previous_attempts ? ` · ${c.previous_attempts} previous attempt(s)` : ''}`,
      `Priority ${priorityLabel(c.priority, c.priority_confidence)} · signals: ${signalSummary(c.score_signals)} · research ${c.research_completeness_score}% · ${c.archetype}`,
      '',
      `**Why them:** ${short(c.commercial_signal, 30)}${c.commercial_signal_verified ? '' : ' _(unverified)_'}`,
      `**Friction:** ${short(c.observable_friction, 30)}${c.friction_verified ? '' : ' _(unverified: check first)_'}`,
      `**Angle:** ${short(c.kachmo_angle, 30)}`,
      c.why_now ? `**Why now:** ${c.why_now}` : '**Why now:** none known (fine, don’t invent one)',
      `**Goal:** ${c.call_objective}`,
      '',
      `**Before dialling:**`,
      ...c.verify_before_call.map(v => `- [ ] ${v}`),
      '',
      `**Open:** "${c.recommended_opening}"`,
      `**Bridge:** "${c.bridge}"`,
      `**Ask:**`,
      ...c.discovery_questions.map((q, i) => `${i + 1}. ${q}`),
      `**If they say…**`,
      ...c.objections.map(o => `- "${o.objection}" → "${o.response}"`),
      `**Don’t:** ${c.what_not_to_say.join(' · ')}`,
      '',
      `**Log it:** \`${c.log_command}\``,
      '',
      '---',
      ''
    );
  }
  if (excluded.length) {
    md.push('## Not callable (phone on file but excluded)', '', '| Target | Company | Why |', '| :-- | :-- | :-- |');
    for (const x of excluded) md.push(`| ${x.target_number} | ${x.company} | ${x.reason} |`);
    md.push('');
  }
  writeFileSync(resolve(process.cwd(), 'AADI_DAILY_CALLS.md'), md.join('\n'), 'utf-8');

  console.log(`\n📞 Calling queue: ${cards.length} callable, ${excluded.length} with a phone but excluded → AADI_DAILY_CALLS.md`);
  return { total: cards.length, cards, excluded };
}

if (process.argv[1]?.endsWith('queue-calls.ts')) {
  runCli(() => {
    generateCallingQueue();
  });
}
