import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { safeReadJson, safeWriteJson } from './lib/safe-io.js';
import type { KachmoLead, ResearchQueueItem, ResearchTask } from './lib/schema.js';
import { loadLeads, loadSuppression, paths } from './lib/store.js';
import { outreachBlock } from './lib/contact.js';
import { parseTracker } from './lib/email-state.js';
import { short, priorityLabel, signalSummary } from './lib/text.js';
import { runCli } from './lib/cli.js';

const FIELD_ORDER = [
  'direct_contact_route', 'phone_source', 'email_source', 'decision_maker_name', 'decision_maker_source',
  'observable_friction', 'website_friction_source', 'commercial_validation_signal', 'commercial_signal_source',
  'kachmo_solution_angle', 'kachmo_fit_review', 'location_timezone', 'trigger_event', 'trigger_source',
  'budget_probability', 'budget_probability_source', 'technology_stack', 'technology_source', 'frontend_team_status',
];

export function taskFor(field: string, lead: KachmoLead): ResearchTask | null {
  const rec = (a: string) => `npm run leads:record -- --lead=${lead.target_number} ${a}`;
  const dm = lead.decision_maker_name || 'the decision maker';
  const key = FIELD_ORDER.find(f => field.startsWith(f));
  switch (key) {
    case 'direct_contact_route':
      return {
        field: key,
        task: `Find a direct route to ${dm}: a personal work email or a publicly listed phone. Now: ${field.match(/\((.*)\)/)?.[1] ?? 'none'}.`,
        evidence_needed: 'The page where the email/phone is published (official site, Google Business Profile, directory). Never guess first@domain patterns.',
        record_with: rec('--field=email --value=<email> --status=PUBLICLY_LISTED --source=<url>'),
      };
    case 'phone_source':
      return {
        field: key,
        task: `Find where ${lead.decision_maker_phone} is published. If you cannot find it, do NOT call it.`,
        evidence_needed: 'Official contact page, Google Business Profile, or directory listing showing this exact number and who it belongs to.',
        record_with: `${rec('--field=phone --status=PUBLICLY_LISTED --source=<url>')}   (or --status=INVALID if it is not theirs)`,
      };
    case 'email_source':
      return {
        field: key,
        task: `Find where ${lead.decision_maker_email} is published, or confirm it (e.g. a reply came from it).`,
        evidence_needed: 'Page publishing the address, or a received reply.',
        record_with: rec('--field=email --status=PUBLICLY_LISTED --source=<url>   (or --status=VERIFIED --basis="replied on <date>")'),
      };
    case 'decision_maker_name':
      return {
        field: key,
        task: `Identify the named founder / MD / owner of ${lead.company_name} (currently "${lead.decision_maker_name || 'none'}").`,
        evidence_needed: 'About/team page, LinkedIn profile, or company registry officer listing naming the person and role.',
        record_with: rec('--field=decision-maker --value="Full Name" --title="Role" --source=<url>'),
      };
    case 'decision_maker_source':
      return {
        field: key,
        task: `Confirm ${dm} is still ${lead.decision_maker_title} at ${lead.company_name}.`,
        evidence_needed: 'A current company page or LinkedIn profile showing this role.',
        record_with: rec('--field=decision-maker --source=<url>'),
      };
    case 'observable_friction':
    case 'website_friction_source':
      return {
        field: key,
        task: `Open ${lead.website_url} on a phone and a laptop and confirm: "${short(lead.observable_friction) || 'describe the concrete problem'}".`,
        evidence_needed: 'Your own check of the live site today (source = the page you checked). Update the text if it is no longer true.',
        record_with: rec('--field=friction-source --source=<page url> [--value="updated observation"]'),
      };
    case 'commercial_validation_signal':
    case 'commercial_signal_source':
      return {
        field: key,
        task: `Find a source for: "${short(lead.commercial_validation_signal) || 'evidence the business makes real money'}".`,
        evidence_needed: 'Case study page, press article, funding announcement, awards page, or review profile.',
        record_with: rec('--field=commercial-source --source=<url>'),
      };
    case 'kachmo_solution_angle':
      return {
        field: key,
        task: `Write one sentence on what Kachmo would actually build for ${lead.company_name}.`,
        evidence_needed: 'Grounded in the friction you confirmed on their site.',
        record_with: rec('--field=fit --value=CONFIRMED --by=DEV --basis="<angle>"'),
      };
    case 'kachmo_fit_review':
      return {
        field: key,
        task: `2-minute judgement: would Kachmo genuinely sell "${short(lead.kachmo_solution_angle, 16)}" and would this business plausibly pay for it?`,
        evidence_needed: 'Human judgement after looking at the site and the business.',
        record_with: rec('--field=fit --value=CONFIRMED --by=DEV   (or --value=REJECTED --basis="why")'),
      };
    case 'location_timezone':
      return {
        field: key,
        task: `Confirm the operating city/timezone for ${lead.company_name} ("${lead.location_city}, ${lead.location_country}").`,
        evidence_needed: 'Address on the website or Google Business Profile.',
        record_with: rec('--field=timezone --value=<IANA e.g. America/Los_Angeles> --source=<url>'),
      };
    case 'trigger_event':
    case 'trigger_source':
      return {
        field: key,
        task: 'Check the last ~6 months for a why-now trigger (launch, funding, new location, rebrand, hiring). If none, record NO_CLEAR_TRIGGER — that is a valid result and does not lower the score.',
        evidence_needed: 'News, LinkedIn/Instagram posts, careers page, funding databases.',
        record_with: rec('--field=trigger --value="<what happened>" --source=<url>   (or --value=NO_CLEAR_TRIGGER)'),
      };
    case 'budget_probability':
    case 'budget_probability_source':
      return {
        field: key,
        task: 'Look for evidence of budget capacity. Leave UNKNOWN if there is none — do not guess.',
        evidence_needed: 'Funding news, number of locations, LinkedIn headcount, pricing page, past agency work.',
        record_with: rec('--field=budget --value=HIGH|MEDIUM|LOW --basis="<evidence>" --source=<url>'),
      };
    case 'technology_stack':
    case 'technology_source':
      return {
        field: key,
        task: `Identify the CMS / framework behind ${lead.website_url}.`,
        evidence_needed: 'View source, Wappalyzer or BuiltWith result.',
        record_with: rec(`--field=tech --value="<e.g. WordPress + Elementor>" --source=${lead.website_url}`),
      };
    case 'frontend_team_status':
      return {
        field: key,
        task: `Does ${lead.company_name} have in-house front-end / creative developers?`,
        evidence_needed: 'Team page, careers page, LinkedIn employee titles.',
        record_with: rec('--field=frontend-team --value=NO_FRONTEND_TEAM|SMALL_INTERNAL_TEAM|LARGE_INTERNAL_TEAM --source=<url>'),
      };
    default:
      return null;
  }
}

const PRIORITY_RANK: Record<string, number> = { 'A+': 1, A: 2, B: 3, C: 4 };

export function generateResearchQueue(): { items: ResearchQueueItem[] } {
  const p = paths();
  const leads = loadLeads();
  const suppression = loadSuppression();
  const tracker = parseTracker(p.tracker);
  const existing = safeReadJson<ResearchQueueItem[]>(p.researchQueue, []);
  const existingById = new Map((Array.isArray(existing) ? existing : []).map(i => [i.lead_id, i]));
  const now = new Date().toISOString();

  const items: ResearchQueueItem[] = [];
  for (const lead of leads) {
    if (lead.research_state === 'DISQUALIFIED') continue;
    if (outreachBlock(lead, suppression, tracker.get(lead.target_number)?.status ?? null).blocked) continue;
    const tasks = lead.missing_intelligence
      .map(f => taskFor(f, lead))
      .filter((t): t is ResearchTask => !!t)
      .filter((t, i, arr) => arr.findIndex(x => x.task === t.task) === i)
      .sort((a, b) => FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field));
    if (!tasks.length) continue;

    const prev = existingById.get(lead.lead_id);
    items.push({
      lead_id: lead.lead_id,
      target_number: lead.target_number,
      company: lead.company_name,
      priority: lead.lead_priority ?? 'UNSCORED',
      priority_confidence: lead.priority_confidence ?? null,
      kachmo_score: lead.kachmo_score,
      research_completeness_score: lead.research_completeness_score,
      missing_fields: [...lead.missing_intelligence],
      specific_research_tasks: tasks,
      owner: lead.owner ?? (lead.archetype_id === '6' ? 'AADI' : 'DEV'),
      status: prev?.status ?? 'PENDING',
      created_at: prev?.created_at ?? now,
      updated_at: now,
    });
  }

  // Potentially excellent but under-researched first; within a tier, missing contact route first.
  const needsContact = (i: ResearchQueueItem) => i.specific_research_tasks.some(t => ['direct_contact_route', 'phone_source'].includes(t.field));
  items.sort(
    (a, b) =>
      (PRIORITY_RANK[a.priority] ?? 5) - (PRIORITY_RANK[b.priority] ?? 5) ||
      Number(needsContact(b)) - Number(needsContact(a)) ||
      (b.kachmo_score ?? -1) - (a.kachmo_score ?? -1) ||
      a.target_number.localeCompare(b.target_number)
  );

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
