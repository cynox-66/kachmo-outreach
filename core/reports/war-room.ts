import type { CallingCard, KachmoLead, ResearchQueueItem, SuppressionEntry, WhatsAppQueueItem } from '../leads/schema.js';
import type { TrackerRow, ScheduledEmail } from '../email-ledger/tracker.js';
import { outreachBlock } from '../suppression/match.js';
import { priorityLabel } from '../util/text.js';
import { isFollowUpDue, isEmailFollowUpDue, isReplyWaiting, isPositiveWithoutMeeting } from '../queues/work-rules.js';

export interface WarRoomSummary {
  date: string;
  generated_at: string;
  alerts: string[];
  aadi: { calls: string[]; follow_ups_due: string[]; whatsapp_to_send: string[]; whatsapp_to_approve: string[] };
  dev: {
    email_follow_ups_due: string[];
    replies_to_answer: string[];
    positive_without_meeting: string[];
    scheduled_emails_local: string[];
    next_email_candidates: string[];
    follow_ups_due: string[];
  };
  pipeline: { meetings_booked: string[]; proposals_out: string[]; won: string[] };
  research_next: string[];
  lead_base: Record<string, number>;
}

export interface WarRoomInput {
  today: string;
  generatedAt: string;
  leads: KachmoLead[];
  suppression: SuppressionEntry[];
  tracker: Map<string, TrackerRow>;
  scheduled: ScheduledEmail[];
  callCards: CallingCard[];
  whatsappItems: WhatsAppQueueItem[];
  researchItems: ResearchQueueItem[];
  /** Alerts the caller gathered from its environment (stale git state, unreadable files, queue issues, invariants). */
  alerts: string[];
}

const label = (l: Pick<KachmoLead, 'target_number' | 'company_name'>) => `${l.target_number} ${l.company_name}`;

/** How many leads sit in each state. The denominator every other number in the war room is read against. */
export function leadBaseCounts(leads: KachmoLead[]): Record<string, number> {
  const aOrAPlus = (l: KachmoLead) => l.lead_priority === 'A+' || l.lead_priority === 'A';
  return {
    total: leads.length,
    outreach_ready: leads.filter(l => l.research_state === 'OUTREACH_READY').length,
    qualified: leads.filter(l => l.research_state === 'QUALIFIED').length,
    research_required: leads.filter(l => l.research_state === 'RESEARCH_REQUIRED').length,
    disqualified: leads.filter(l => l.research_state === 'DISQUALIFIED').length,
    a_or_a_plus: leads.filter(aOrAPlus).length,
    a_or_a_plus_provisional: leads.filter(l => aOrAPlus(l) && l.priority_confidence === 'PROVISIONAL').length,
  };
}

/**
 * The daily operating picture: what each person owes today, derived only from stored state.
 *
 * Pure: the caller loads the files, runs the queue generators and collects environment alerts. Every "due" rule
 * here is date-comparison against `today`; a suppressed or disqualified lead never appears in a work list.
 */
export function buildWarRoomSummary(input: WarRoomInput): WarRoomSummary {
  const { today, leads, suppression, tracker } = input;
  const byTn = new Map(leads.map(l => [l.target_number, l]));
  const blocked = (l?: KachmoLead) => !!l && outreachBlock(l, suppression, tracker.get(l.target_number)?.status ?? null).blocked;
  const followUps = leads.filter(l => isFollowUpDue(l, today, blocked(l)));
  const trackerRows = [...tracker.values()];

  return {
    date: today,
    generated_at: input.generatedAt,
    alerts: input.alerts,
    aadi: {
      calls: input.callCards.map(c => `${c.target_number} ${c.company_name} (${c.decision_maker_name})`),
      follow_ups_due: followUps.filter(l => l.owner === 'AADI').map(l => `${label(l)}: ${l.next_action} (due ${l.next_action_date})`),
      whatsapp_to_send: input.whatsappItems.filter(i => i.status === 'APPROVED').map(i => `${i.target_number} ${i.company_name}`),
      whatsapp_to_approve: input.whatsappItems.filter(i => i.status === 'PENDING_HUMAN_REVIEW').map(i => `${i.target_number} ${i.company_name}`),
    },
    dev: {
      email_follow_ups_due: trackerRows
        .filter(r => isEmailFollowUpDue(r, byTn.get(r.target_number), today, blocked(byTn.get(r.target_number))))
        .map(r => `${r.target_number} ${byTn.get(r.target_number)?.company_name ?? ''} (due ${r.follow_up_due})`),
      replies_to_answer: trackerRows
        .filter(isReplyWaiting)
        .map(r => `${r.target_number} ${byTn.get(r.target_number)?.company_name ?? ''} (${r.status})`),
      positive_without_meeting: leads.filter(isPositiveWithoutMeeting).map(label),
      scheduled_emails_local: input.scheduled.map(s => `${s.targetNumber} ${s.companyName}`),
      next_email_candidates: leads
        .filter(l => l.research_state === 'OUTREACH_READY' && l.recommended_channel === 'EMAIL')
        .sort((a, b) => (b.kachmo_score ?? -1) - (a.kachmo_score ?? -1))
        .slice(0, 5)
        .map(l => `${label(l)}: ${priorityLabel(l.lead_priority, l.priority_confidence)}`),
      follow_ups_due: followUps.filter(l => l.owner !== 'AADI').map(l => `${label(l)}: ${l.next_action} (due ${l.next_action_date})`),
    },
    pipeline: {
      meetings_booked: leads.filter(l => l.meeting_status === 'BOOKED').map(l => `${label(l)}${l.next_action_date ? ` on ${l.next_action_date}` : ''}`),
      proposals_out: leads.filter(l => l.proposal_status === 'SENT' && !l.deal_stage).map(l => `${label(l)}${l.deal_value ? ` (${l.deal_value})` : ''}`),
      won: leads.filter(l => l.deal_stage === 'WON').map(l => `${label(l)}${l.deal_value ? ` (${l.deal_value})` : ''}`),
    },
    research_next: input.researchItems
      .slice(0, 5)
      .map(i => `${i.target_number} ${i.company} [${i.priority}${i.priority_confidence === 'PROVISIONAL' ? ' prov.' : ''}]: ${i.specific_research_tasks[0].task}`),
    lead_base: leadBaseCounts(leads),
  };
}

/** The alert raised when the local checkout is behind the branch the Titan cron pushes to. */
export const staleRepoAlert = (behind: number): string =>
  `Local repo is ${behind} commit(s) behind origin (as of the last git fetch). The cron pushes queue/tracker updates, so local email state is stale. ` +
  `Pull before trusting email numbers. Do NOT run send:titan or dispatch:cron locally until you have.`;
