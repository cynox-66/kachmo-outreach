import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { safeWriteJson } from './lib/safe-io.js';
import { loadLeads, readEvents, paths } from './lib/store.js';
import { parseTracker } from './lib/email-state.js';
import { todayIst } from './lib/geo.js';
import { runCli } from './lib/cli.js';
import { buildWeeklyReport } from '../core/reports/weekly.js';

// The funnel derivation lives in core/reports/weekly.ts; this script loads the inputs and renders the files.
export { buildWeeklyReport, ratio, MIN_SAMPLE } from '../core/reports/weekly.js';
export type { Ratio, WeeklyReport } from '../core/reports/weekly.js';

export function generateWeeklyReport() {
  const p = paths();
  const report = buildWeeklyReport({
    today: todayIst(),
    generatedAt: new Date().toISOString(),
    leads: loadLeads(),
    events: readEvents(),
    tracker: parseTracker(p.tracker),
  });
  safeWriteJson(p.weeklyReport, report);

  const { funnel, conversions, channels, archetypes, objections: objectionCounts, lost_reasons: lostCounts, won_deals: wonDeals } = report;
  const md = [
    `# Weekly Outbound Report: ${report.week.start} → ${report.week.end}`,
    '',
    `> ${report.sources}`,
    `> ${report.note}`,
    '',
    '## Funnel (all time)',
    '| Stage | Count |',
    '| :-- | --: |',
    ...funnel.map(f => `| ${f.stage} | ${f.count} |`),
    '',
    '## Stage conversion',
    ...conversions.map(c => `- ${c.from} → ${c.to}: ${c.display}`),
    '',
    '## Channels',
    '| Channel | Attempted | Responded | Positive |',
    '| :-- | --: | :-- | :-- |',
    ...channels.map(c => `| ${c.channel} | ${c.attempted} | ${c.responded.display} | ${c.positive.display} |`),
    '',
    '## Archetypes (counts only)',
    '| Archetype | Leads | Contacted | Responded | Meetings | Won |',
    '| :-- | --: | --: | --: | --: | --: |',
    ...archetypes.map(a => `| ${a.archetype} | ${a.leads} | ${a.contacted} | ${a.responded} | ${a.meetings} | ${a.won} |`),
    '',
    '## Objections (from logged calls)',
    ...(Object.keys(objectionCounts).length ? Object.entries(objectionCounts).map(([k, v]) => `- ${k}: ${v}`) : ['- None logged yet.']),
    '',
    '## Lost reasons',
    ...(Object.keys(lostCounts).length ? Object.entries(lostCounts).map(([k, v]) => `- ${k}: ${v}`) : ['- None.']),
    '',
    '## Won deals',
    ...(wonDeals.length
      ? wonDeals.map(d => `- ${d.target} ${d.company}: ${d.value_as_recorded ?? 'value not recorded'} (arch ${d.archetype_id}, via ${d.channel ?? 'unknown'})`)
      : ['- None yet.']),
    '',
    '## This week',
    `- Emails sent (per tracker): ${report.this_week.emails_sent}`,
    ...Object.entries(report.this_week.events).map(([k, v]) => `- ${k}: ${v}`),
    '',
  ].join('\n');
  writeFileSync(resolve(process.cwd(), 'WEEKLY_OUTBOUND_REPORT.md'), md, 'utf-8');

  const n = (stage: string) => funnel.find(f => f.stage.startsWith(stage))?.count ?? 0;
  console.log(`\n📊 Weekly report → WEEKLY_OUTBOUND_REPORT.md (contacted ${n('Contacted')}, responded ${n('Responded')}, meetings ${n('Meeting')}, won ${n('Won')})`);
  return report;
}

if (process.argv[1]?.endsWith('analytics-weekly.ts')) {
  runCli(() => {
    generateWeeklyReport();
  });
}
