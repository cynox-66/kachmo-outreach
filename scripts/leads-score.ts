import type { KachmoLead, LeadPriority } from './lib/schema.js';
import { loadLeads, saveLeads, logEvent } from './lib/store.js';
import { isUrl } from './lib/contact.js';
import { isGenericDecisionMaker } from './leads-qualify.js';
import { runCli } from './lib/cli.js';

export const SCORE_BASIS =
  'HEURISTIC v2: regex signal categories over research text (mostly unverified legacy CSV). ' +
  'Not derived from Kachmo win/loss data. Unknown dimensions are excluded, not scored as zero.';

export const PRIORITY_THRESHOLDS = { 'A+': 85, A: 70, B: 50 } as const;
export const CONFIRMED_COMPLETENESS = 60;

const COMMERCIAL_SIGNALS: Array<[string, RegExp]> = [
  ['funding', /\b(YC|Y Combinator|pre-seed|seed|series [a-e]|raised|venture[- ]backed|backed by|funded)\b/i],
  ['scale', /₹\s?\d+(\.\d+)?\s?(cr|crore|l|lakh)\b|\$\s?\d+(\.\d+)?\s?(k|m|mm|million|bn|billion)\b|\b\d+\+?\s+(locations|stores|properties|clinics|centres|centers|outlets|offices|countries|staff|employees|people|artisans|instructors|suites)\b|\bmultiple (centers|centres|locations|clinics|stores)\b/i],
  ['recognition', /\b(award|awards|award-winning|winner|D&AD|Awwwards|Cannes|AD100|featured|Forbes|Vogue|Cond[eé] Nast|Johansens|Michelin|pencils?|biennale)\b/i],
  ['client_roster', /\b(clients?|worked with|commissioned|partnered with|brands? (like|including))\b|\b[A-Z][\w&'.-]+, [A-Z][\w&'.-]+(,| and) [A-Z][\w&'.-]+/],
  ['demand', /\b\d[\d,.]*\+?\s*(reviews|customers|users|members|students|patients|guests|downloads)\b|\b\d\.\d\s*(★|stars?|google rating|rating)/i],
];

const PAIN_SIGNALS: Array<[string, RegExp]> = [
  ['performance', /\b(slow|sluggish|heavy|laggy|load(ing)? times?|core web vitals|lighthouse|janky|unoptimi[sz]ed)\b/i],
  ['legacy', /\b(legacy|outdated|dated|generic template|wordpress|wix|squarespace|godaddy|static|low-res|jpe?g)\b/i],
  ['conversion', /\b(iframe|third-party|widget|OTA|no (online )?booking|form-only|contact form|waitlist|cta|drop-?off|gated)\b/i],
  ['no_presence', /\b(no website|no site|nxdomain|directory (listing|profiles?)|trade-directory|no web presence|does not have a website)\b/i],
  ['interaction_gap', /\b(no (interactive|3d|360|motion|animation)|lacks?\b.{0,24}\b(interactive|immersive|3d|360|motion|walkthrough)|without (an? )?(interactive|3d|360|motion)|static (screenshots|images|photos|renders|showcase))\b/i],
];

const AUTHORITY_TITLE = /\b(founder|co-founder|ceo|owner|managing director|md|principal|creative director|partner|proprietor|director|president)\b/i;

export interface ScoreCalculation {
  commercialFitScore: number | null;
  painScore: number | null;
  dmQualityScore: number | null;
  budgetScore: number | null;
  intentTriggerScore: number | null;
  kachmoScore: number | null;
  priority: LeadPriority | null;
  priorityConfidence: 'CONFIRMED' | 'PROVISIONAL' | null;
  signals: string[];
}

/** Urgency is kept separate so a missing or absent trigger can never lower commercial quality. */
function urgencyScore(lead: KachmoLead): number | null {
  const t = lead.trigger_event?.trim();
  if (!t || t === 'UNKNOWN') return null;
  if (t === 'NO_CLEAR_TRIGGER') return 0;
  return isUrl(lead.trigger_source) ? 100 : 50;
}

export function calculateLeadScores(lead: KachmoLead): ScoreCalculation {
  const intentTriggerScore = urgencyScore(lead);
  if (lead.research_state === 'DISQUALIFIED') {
    return { commercialFitScore: null, painScore: null, dmQualityScore: null, budgetScore: null, intentTriggerScore, kachmoScore: null, priority: 'DISQUALIFIED', priorityConfidence: null, signals: [] };
  }

  const dims: Array<{ earned: number; max: number }> = [];
  const signals: string[] = [];

  let commercialFitScore: number | null = null;
  if ((lead.commercial_validation_signal || '').trim().length >= 15) {
    const text = `${lead.commercial_validation_signal} ${lead.estimated_scale || ''}`;
    const hits = COMMERCIAL_SIGNALS.filter(([, re]) => re.test(text)).map(([n]) => n);
    commercialFitScore = Math.min(40, 16 + 8 * hits.length);
    signals.push(...hits.map(h => `commercial:${h}`));
    dims.push({ earned: commercialFitScore, max: 40 });
  }

  let painScore: number | null = null;
  if ((lead.observable_friction || '').trim().length >= 15) {
    const hits = PAIN_SIGNALS.filter(([, re]) => re.test(lead.observable_friction)).map(([n]) => n);
    painScore = Math.min(35, 14 + 7 * hits.length);
    signals.push(...hits.map(h => `pain:${h}`));
    dims.push({ earned: painScore, max: 35 });
  }

  let dmQualityScore: number | null = null;
  if (!isGenericDecisionMaker(lead.decision_maker_name)) {
    dmQualityScore = AUTHORITY_TITLE.test(lead.decision_maker_title || '') ? 15 : 8;
    dims.push({ earned: dmQualityScore, max: 15 });
  }

  let budgetScore: number | null = null;
  if (lead.budget_probability && lead.budget_probability !== 'UNKNOWN') {
    budgetScore = { VERY_HIGH: 10, HIGH: 8, MEDIUM: 5, LOW: 1 }[lead.budget_probability];
    dims.push({ earned: budgetScore, max: 10 });
  }

  const max = dims.reduce((s, d) => s + d.max, 0);
  const kachmoScore = max > 0 ? Math.round((dims.reduce((s, d) => s + d.earned, 0) / max) * 100) : null;

  let priority: LeadPriority | null = null;
  if (kachmoScore !== null) {
    priority = kachmoScore >= PRIORITY_THRESHOLDS['A+'] ? 'A+' : kachmoScore >= PRIORITY_THRESHOLDS.A ? 'A' : kachmoScore >= PRIORITY_THRESHOLDS.B ? 'B' : 'C';
  }
  const priorityConfidence = kachmoScore === null ? null : (lead.research_completeness_score ?? 0) >= CONFIRMED_COMPLETENESS ? 'CONFIRMED' : 'PROVISIONAL';

  return { commercialFitScore, painScore, dmQualityScore, budgetScore, intentTriggerScore, kachmoScore, priority, priorityConfidence, signals };
}

export function scoreLeads(): Record<string, number> {
  const leads = loadLeads();
  const counts: Record<string, number> = { 'A+': 0, A: 0, B: 0, C: 0, DISQUALIFIED: 0, UNSCORED: 0, PROVISIONAL: 0 };

  for (const lead of leads) {
    const s = calculateLeadScores(lead);
    const prev = lead.lead_priority;
    lead.commercial_fit_score = s.commercialFitScore;
    lead.pain_score_normalized = s.painScore;
    lead.decision_maker_quality_score = s.dmQualityScore;
    lead.budget_score = s.budgetScore;
    lead.intent_trigger_score = s.intentTriggerScore;
    lead.kachmo_score = s.kachmoScore;
    lead.lead_priority = s.priority;
    lead.priority_confidence = s.priorityConfidence;
    lead.score_basis = `${SCORE_BASIS} Signals: ${s.signals.join(', ') || 'none'}.`;
    lead.score_signals = s.signals;
    if (prev && prev !== s.priority) {
      logEvent({
        lead_id: lead.lead_id, target_number: lead.target_number, company_name: lead.company_name,
        event_type: 'PRIORITY_CHANGED', channel: 'SYSTEM', actor: 'SYSTEM',
        payload: { from: prev, to: s.priority, kachmo_score: s.kachmoScore },
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
