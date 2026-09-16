import type { Actor, EventType, KachmoLead, LostReason, SuppressionEntry } from '../leads/schema.js';
import { LOST_REASONS } from '../leads/schema.js';
import { outreachBlock } from '../suppression/match.js';
import { EMAIL_SENT_STATUSES } from '../email-ledger/tracker.js';
import { addDays } from '../geo/timezone.js';
import { appendNote, eventSubject, refuse, type DomainEvent, type LeadDecision } from './decision.js';

export const PIPELINE_STAGES = [
  'FOLLOW_UP_SENT',
  'REPLIED_POSITIVE',
  'REPLIED_NOT_NOW',
  'NOT_INTERESTED',
  'MEETING_BOOKED',
  'MEETING_DONE',
  'PROPOSAL_SENT',
  'WON',
  'LOST',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PIPELINE_CHANNELS = ['EMAIL', 'CALL', 'WHATSAPP', 'LINKEDIN', 'OTHER'] as const;
export type PipelineChannel = (typeof PIPELINE_CHANNELS)[number];

/** Stages that record a prospect response, so channel attribution is required. */
export const STAGES_NEEDING_CHANNEL: ReadonlySet<string> = new Set(['REPLIED_POSITIVE', 'REPLIED_NOT_NOW', 'NOT_INTERESTED', 'MEETING_BOOKED']);
/** Stages that constitute further engagement, so a suppressed lead must not reach them. */
export const ENGAGING_STAGES: ReadonlySet<string> = new Set(['FOLLOW_UP_SENT', 'REPLIED_POSITIVE', 'MEETING_BOOKED', 'MEETING_DONE', 'PROPOSAL_SENT', 'WON']);
/** Channels that count as having touched the prospect. */
const CONTACT_CHANNELS: ReadonlySet<string> = new Set(['EMAIL', 'CALL', 'WHATSAPP']);

export interface PipelineLogInput {
  stage: PipelineStage;
  by: Extract<Actor, 'DEV' | 'AADI'>;
  channel?: PipelineChannel | null;
  value?: string | null;
  reason?: LostReason | null;
  date?: string | null;
  notes?: string | null;
}

export interface PipelineLogContext {
  today: string;
  now: string;
  suppression: SuppressionEntry[];
  ledgerStatus: string | null;
}

/** Flag-level rules that hold before any lead is loaded. Returns a refusal reason or null. */
export function pipelineLogInputProblem(input: PipelineLogInput): string | null {
  if (input.date && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return '--date must be YYYY-MM-DD';
  if (STAGES_NEEDING_CHANNEL.has(input.stage) && !input.channel) return `--stage=${input.stage} requires --channel (for channel attribution).`;
  return null;
}

/**
 * Sales-stage transitions with enforced ordering: meeting → proposal → won. A closed deal is terminal, the
 * single-bump email protocol is enforced against both the lead record and the production email ledger, and a
 * suppressed lead cannot be advanced through any engaging stage.
 */
export function decidePipelineTransition(lead: KachmoLead, input: PipelineLogInput, ctx: PipelineLogContext): LeadDecision {
  const problem = pipelineLogInputProblem(input);
  if (problem) return refuse(problem);

  const { stage, by } = input;
  const channel = input.channel ?? null;
  const value = input.value ?? null;
  const reason = input.reason ?? null;
  const date = input.date ?? null;
  const tn = lead.target_number;

  if (lead.deal_stage === 'WON' || lead.deal_stage === 'LOST') return refuse(`${tn} deal is already closed (${lead.deal_stage}).`);
  const block = outreachBlock(lead, ctx.suppression, ctx.ledgerStatus);
  if (block.blocked && ENGAGING_STAGES.has(stage)) {
    return refuse(`${tn} is suppressed (${block.reason}). If they re-engaged on their own, remove the suppression deliberately first.`);
  }

  const patch: Partial<KachmoLead> = {};
  let eventType: EventType;
  switch (stage) {
    case 'FOLLOW_UP_SENT':
      if (!EMAIL_SENT_STATUSES.has(ctx.ledgerStatus ?? '')) {
        return refuse(`${tn}: OUTREACH_TRACKER.md does not show a sent email (status: ${ctx.ledgerStatus ?? 'none'}).`);
      }
      if (ctx.ledgerStatus === 'FOLLOWED_UP') return refuse(`${tn}: OUTREACH_TRACKER.md already shows FOLLOWED_UP (single-bump protocol).`);
      if (lead.email_follow_up_sent_at) return refuse(`${tn}: follow-up already sent on ${lead.email_follow_up_sent_at} (single-bump protocol).`);
      patch.email_follow_up_sent_at = ctx.today;
      patch.next_action = 'Wait for a reply (no further bumps)';
      patch.next_action_date = null;
      eventType = 'FOLLOW_UP_SENT';
      break;
    case 'REPLIED_POSITIVE':
      patch.response_status = 'REPLIED_POSITIVE';
      patch.lead_temperature = 'HOT';
      patch.next_action = 'Reply and propose a 15-minute call';
      patch.next_action_date = ctx.today;
      eventType = 'REPLY_RECEIVED';
      break;
    case 'REPLIED_NOT_NOW':
      patch.response_status = 'REPLIED_NOT_NOW';
      patch.lead_temperature = 'WARM';
      patch.next_action = 'Check in again';
      patch.next_action_date = date ?? addDays(ctx.today, 60);
      eventType = 'REPLY_RECEIVED';
      break;
    case 'NOT_INTERESTED':
      patch.response_status = 'NOT_INTERESTED';
      patch.lead_temperature = 'COLD';
      patch.next_action = 'None (not interested)';
      patch.next_action_date = null;
      eventType = 'REPLY_RECEIVED';
      break;
    case 'MEETING_BOOKED':
      patch.meeting_status = 'BOOKED';
      patch.lead_temperature = 'HOT';
      patch.next_action = 'Prepare for the meeting';
      patch.next_action_date = date ?? null;
      eventType = 'MEETING_BOOKED';
      break;
    case 'MEETING_DONE':
      if (lead.meeting_status !== 'BOOKED') return refuse(`${tn}: no booked meeting recorded. Log MEETING_BOOKED first.`);
      patch.meeting_status = 'DONE';
      patch.next_action = 'Send proposal or follow-up';
      patch.next_action_date = addDays(ctx.today, 2);
      eventType = 'MEETING_DONE';
      break;
    case 'PROPOSAL_SENT':
      if (lead.meeting_status !== 'BOOKED' && lead.meeting_status !== 'DONE') {
        return refuse(`${tn}: no meeting recorded. A proposal requires MEETING_BOOKED or MEETING_DONE first.`);
      }
      patch.proposal_status = 'SENT';
      if (value) patch.deal_value = value;
      patch.next_action = 'Follow up on the proposal';
      patch.next_action_date = addDays(ctx.today, 5);
      eventType = 'PROPOSAL_SENT';
      break;
    case 'WON':
      if (lead.proposal_status !== 'SENT') return refuse(`${tn}: no proposal recorded. WON requires PROPOSAL_SENT first.`);
      patch.deal_stage = 'WON';
      if (value) patch.deal_value = value;
      patch.next_action = 'Kick off the project';
      patch.next_action_date = null;
      eventType = 'DEAL_WON';
      break;
    case 'LOST':
      if (!reason) return refuse(`--stage=LOST requires --reason=${LOST_REASONS.join('|')}`);
      patch.deal_stage = 'LOST';
      patch.lost_reason = reason;
      patch.next_action = 'None (lost)';
      patch.next_action_date = null;
      eventType = 'DEAL_LOST';
      break;
  }

  if (channel && CONTACT_CHANNELS.has(channel)) patch.last_contacted_at = lead.last_contacted_at ?? ctx.now;
  if (input.notes) patch.notes = appendNote(lead.notes, ctx.today, `${stage}/${by}`, input.notes);
  patch.updated_at = ctx.now;

  const events: DomainEvent[] = [
    {
      ...eventSubject(lead),
      event_type: eventType,
      channel: channel ?? (stage === 'FOLLOW_UP_SENT' ? 'EMAIL' : 'OTHER'),
      actor: by,
      payload: { stage, channel: channel ?? null, value: value ?? null, lost_reason: reason ?? null, archetype_id: lead.archetype_id },
    },
  ];

  return { refusal: null, warnings: [], patch, suppression: null, events, summary: `${tn} ${lead.company_name}: ${stage}. Next: ${patch.next_action}` };
}
