import type { KachmoLead } from '../leads/schema.js';
import type { TrackerRow } from '../email-ledger/tracker.js';

/**
 * WORK-SELECTION RULES — the single definition of "who is owed what today".
 *
 * The war room (`reports/war-room.ts`, string output for the markdown report) and the Today work list
 * (`queues/today.ts`, structured output for the application) select work with exactly these predicates, so the two
 * can never disagree. Pure: `blocked` is supplied by the caller (it is `outreachBlock` against the live suppression
 * list and ledger), and every "due" rule is a date comparison against `today` (YYYY-MM-DD).
 */

/** A stored date on or before today. */
export const isDue = (date: string | null | undefined, today: string): boolean => !!date && date <= today;

/** A human-scheduled next step (a callback, a meeting) has come due on a lead that may still be contacted. */
export function isFollowUpDue(lead: KachmoLead, today: string, blocked: boolean): boolean {
  return isDue(lead.next_action_date, today) && !blocked && lead.research_state !== 'DISQUALIFIED';
}

/** Titan's ledger shows a first email sent and its single follow-up now due, not yet sent, on a reachable lead. */
export function isEmailFollowUpDue(row: TrackerRow, lead: KachmoLead | undefined, today: string, blocked: boolean): boolean {
  return row.status === 'SENT' && isDue(row.follow_up_due, today) && !blocked && !lead?.email_follow_up_sent_at;
}

/** Someone replied by email and has not been answered. */
export const isReplyWaiting = (row: TrackerRow): boolean => row.status === 'REPLIED_WARM' || row.status === 'REPLIED_NOT_NOW';

/** Interest was recorded but nothing is scheduled. */
export const isPositiveWithoutMeeting = (lead: KachmoLead): boolean => lead.response_status === 'REPLIED_POSITIVE' && !lead.meeting_status && !lead.deal_stage;
