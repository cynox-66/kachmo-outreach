import type { AnalyticsEvent, KachmoLead } from '../leads/schema.js';
import type { TrackerRow } from '../email-ledger/tracker.js';
import { EMAIL_POSITIVE_STATUSES, EMAIL_REPLY_STATUSES, EMAIL_SENT_STATUSES } from '../email-ledger/tracker.js';
import { addDays } from '../geo/timezone.js';

/** Below this sample size a ratio is shown as k/n only — no percentage, no conclusions. */
export const MIN_SAMPLE = 20;

export interface Ratio {
  from: string;
  to: string;
  k: number;
  n: number;
  display: string;
}

export const ratio = (from: string, to: string, k: number, n: number): Ratio => ({
  from,
  to,
  k,
  n,
  display: n === 0 ? '—' : n < MIN_SAMPLE ? `${k}/${n} (n<${MIN_SAMPLE}: too few to interpret)` : `${k}/${n} (${Math.round((k / n) * 100)}%)`,
});

/** Call outcomes where nobody was actually spoken to. */
const CALL_NO_CONVERSATION = ['NO_ANSWER', 'VOICEMAIL', 'WRONG_NUMBER', 'GATEKEEPER'];

export interface WeeklyReportInput {
  today: string;
  generatedAt: string;
  leads: KachmoLead[];
  events: AnalyticsEvent[];
  tracker: Map<string, TrackerRow>;
}

export type WeeklyReport = ReturnType<typeof buildWeeklyReport>;

/**
 * The outbound funnel, measured — never estimated.
 *
 * Email numbers come from the production ledger (OUTREACH_TRACKER.md); calls, WhatsApp and pipeline come from the
 * lead database and the event log. No probability or expected revenue is produced: `conversion_probability` stays
 * UNKNOWN by design, and any ratio below MIN_SAMPLE is reported as a raw count so a handful of results cannot be
 * read as a rate.
 */
export function buildWeeklyReport(input: WeeklyReportInput) {
  const { today, leads, events, tracker } = input;
  const weekStart = addDays(today, -6);

  const emailSent = new Set<string>();
  const emailReplied = new Set<string>();
  const emailPositive = new Set<string>();
  let emailsThisWeek = 0;
  for (const [tn, row] of tracker) {
    if (EMAIL_SENT_STATUSES.has(row.status)) {
      emailSent.add(tn);
      if (row.sent_date && row.sent_date >= weekStart && row.sent_date <= today) emailsThisWeek++;
    }
    if (EMAIL_REPLY_STATUSES.has(row.status)) emailReplied.add(tn);
    if (EMAIL_POSITIVE_STATUSES.has(row.status)) emailPositive.add(tn);
  }

  const attempts = leads.flatMap(l => (l.call_attempts ?? []).map(a => ({ ...a, tn: l.target_number })));
  const called = new Set(attempts.map(a => a.tn));
  const connected = new Set(attempts.filter(a => !CALL_NO_CONVERSATION.includes(a.outcome)).map(a => a.tn));
  const callPositive = new Set(attempts.filter(a => a.outcome === 'INTERESTED' || a.outcome === 'MEETING_BOOKED').map(a => a.tn));

  const waSent = new Set(events.filter(e => e.event_type === 'WHATSAPP_SENT' && e.target_number).map(e => e.target_number!));
  const waReplied = new Set(
    leads.filter(l => l.whatsapp_outreach_status === 'REPLIED' || (l.whatsapp_outreach_status === 'OPT_OUT' && waSent.has(l.target_number))).map(l => l.target_number)
  );

  const union = (...sets: Set<string>[]) => new Set(sets.flatMap(s => [...s]));
  const contacted = union(emailSent, called, waSent);
  const responded = union(emailReplied, connected, waReplied, new Set(leads.filter(l => l.response_status).map(l => l.target_number)));
  const meetings = union(
    new Set(leads.filter(l => l.meeting_status).map(l => l.target_number)),
    new Set([...tracker.values()].filter(r => ['CALL_BOOKED', 'PROPOSAL_SENT', 'WON'].includes(r.status)).map(r => r.target_number))
  );
  const proposals = union(
    new Set(leads.filter(l => l.proposal_status === 'SENT').map(l => l.target_number)),
    new Set([...tracker.values()].filter(r => ['PROPOSAL_SENT', 'WON'].includes(r.status)).map(r => r.target_number))
  );
  const won = union(
    new Set(leads.filter(l => l.deal_stage === 'WON').map(l => l.target_number)),
    new Set([...tracker.values()].filter(r => r.status === 'WON').map(r => r.target_number))
  );
  const researched = leads.filter(l => l.research_completeness_score >= 60).length;
  const qualified = leads.filter(l => l.research_state === 'QUALIFIED' || l.research_state === 'OUTREACH_READY').length;

  const funnel = [
    { stage: 'Leads in database', count: leads.length },
    { stage: 'Researched (completeness ≥ 60%)', count: researched },
    { stage: 'Qualified (no blocking gate)', count: qualified },
    { stage: 'Contacted (any channel)', count: contacted.size },
    { stage: 'Responded / conversation', count: responded.size },
    { stage: 'Meeting', count: meetings.size },
    { stage: 'Proposal sent', count: proposals.size },
    { stage: 'Won', count: won.size },
  ];
  const conversions = [
    ratio('contacted', 'responded', responded.size, contacted.size),
    ratio('responded', 'meeting', meetings.size, responded.size),
    ratio('meeting', 'proposal', proposals.size, meetings.size),
    ratio('proposal', 'won', won.size, proposals.size),
  ];
  const channels = [
    { channel: 'EMAIL', attempted: emailSent.size, responded: ratio('sent', 'replied', emailReplied.size, emailSent.size), positive: ratio('sent', 'positive', emailPositive.size, emailSent.size) },
    { channel: 'CALL', attempted: called.size, responded: ratio('called', 'connected', connected.size, called.size), positive: ratio('called', 'interested/meeting', callPositive.size, called.size) },
    { channel: 'WHATSAPP', attempted: waSent.size, responded: ratio('sent', 'replied', waReplied.size, waSent.size), positive: ratio('sent', 'positive', 0, 0) },
  ];

  const archetypes = [...new Set(leads.map(l => l.archetype_id))].sort().map(id => {
    const ls = leads.filter(l => l.archetype_id === id);
    const has = (s: Set<string>) => ls.filter(l => s.has(l.target_number)).length;
    return {
      archetype: `${id}: ${ls[0].raw_archetype_id?.replace(/^\d+:\s*/, '') ?? ls[0].archetype_label}`,
      leads: ls.length,
      contacted: has(contacted),
      responded: has(responded),
      meetings: has(meetings),
      won: has(won),
    };
  });

  const objectionCounts: Record<string, number> = {};
  for (const a of attempts) if (a.objection_category) objectionCounts[a.objection_category] = (objectionCounts[a.objection_category] ?? 0) + 1;
  const lostCounts: Record<string, number> = {};
  for (const l of leads) if (l.deal_stage === 'LOST' && l.lost_reason) lostCounts[l.lost_reason] = (lostCounts[l.lost_reason] ?? 0) + 1;
  const wonDeals = leads
    .filter(l => l.deal_stage === 'WON')
    .map(l => {
      const ev = events.find(e => e.event_type === 'DEAL_WON' && e.lead_id === l.lead_id);
      return { target: l.target_number, company: l.company_name, value_as_recorded: l.deal_value, archetype_id: l.archetype_id, channel: (ev?.payload.channel as string) ?? null };
    });
  const weekEvents: Record<string, number> = {};
  for (const e of events) {
    if (e.timestamp.slice(0, 10) >= weekStart && e.event_type !== 'QUALIFICATION_CHANGED' && e.event_type !== 'PRIORITY_CHANGED') {
      weekEvents[e.event_type] = (weekEvents[e.event_type] ?? 0) + 1;
    }
  }

  return {
    week: { start: weekStart, end: today },
    generated_at: input.generatedAt,
    sources: 'Email: OUTREACH_TRACKER.md (production ledger, local copy). Calls/WhatsApp/pipeline: database + analytics/events.jsonl.',
    funnel,
    conversions,
    channels,
    archetypes,
    objections: objectionCounts,
    recent_objections: attempts.filter(a => a.objection).slice(-10).map(a => ({ target: a.tn, category: a.objection_category, text: a.objection })),
    lost_reasons: lostCounts,
    won_deals: wonDeals,
    this_week: { emails_sent: emailsThisWeek, events: weekEvents },
    conversion_probability: 'UNKNOWN' as const,
    note: `No probabilities or expected revenue are estimated. Ratios below n=${MIN_SAMPLE} are shown as raw counts only.`,
  };
}
