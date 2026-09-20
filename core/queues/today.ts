import type { CallingCard, KachmoLead, ResearchQueueItem, SuppressionEntry, WhatsAppQueueItem } from '../leads/schema.js';
import type { TrackerRow } from '../email-ledger/tracker.js';
import { outreachBlock } from '../suppression/match.js';
import { isFollowUpDue, isEmailFollowUpDue, isReplyWaiting, isPositiveWithoutMeeting } from './work-rules.js';

/**
 * THE TODAY WORK LIST (Phase C, ADR-028).
 *
 * One ordered list of what is owed today, derived on every read from state that already exists — the canonical leads,
 * the suppression list, Titan's ledger, and the call / WhatsApp / research selectors core already runs. Nothing here
 * is stored, snoozed or assigned: a work item exists exactly as long as the state that implies it.
 *
 * Every item says WHY it is on the list (the stored facts it was derived from) and WHO owes it (the lead's owner, or
 * the channel's owner). No item ever performs or schedules outreach: it points at the page where a human does.
 * A lead blocked from outreach (`outreachBlock`) never appears in an outreach item.
 */

export const TODAY_KINDS = [
  'REPLY_WAITING',
  'POSITIVE_NO_MEETING',
  'FOLLOW_UP_DUE',
  'EMAIL_FOLLOW_UP_DUE',
  'WHATSAPP_TO_SEND',
  'CALL_READY',
  'WHATSAPP_TO_APPROVE',
  'EVIDENCE_CONTRADICTION',
  'CANDIDATE_REVIEW',
  'EVIDENCE_RECHECK',
  'EVIDENCE_REVIEW',
  'RESEARCH',
] as const;
export type TodayKind = (typeof TODAY_KINDS)[number];

export interface TodayItem {
  kind: TodayKind;
  leadId: string | null;
  targetNumber: string;
  company: string;
  /** Who owes this: the lead's owner, or the owner of the channel the work happens in. */
  owner: 'DEV' | 'AADI';
  /** YYYY-MM-DD the work fell due, when the source records one. */
  due: string | null;
  overdue: boolean;
  priority: string;
  score: number | null;
  /** The stored facts this item was derived from, as `field: value` statements — never a contact value. */
  why: string[];
  /** Where the work happens. Email work happens in Titan, never in the OS. */
  where: 'OS' | 'TITAN';
  /** The record the work is about when it is not the lead itself (a candidate id, an evidence id). */
  ref: string | null;
}

/** A research candidate waiting for a human decision (read by the caller from its store). */
export interface CandidateToReview {
  id: string;
  company: string;
  status: string;
  createdOn: string;
}

/**
 * A claim whose evidence needs a person (read by the caller from its store):
 *   RETRIEVED       the page was fetched and nobody has checked it against the claim yet
 *   SOURCE_CHANGED  the page changed after someone checked it, so the check no longer describes it (ADR-031)
 *   CONTRADICTED    a person recorded that the source contradicts the claim — the lead record may be wrong
 */
export interface EvidenceToReview {
  evidenceId: string;
  leadId: string;
  field: string;
  fetchedOn: string;
  state?: 'RETRIEVED' | 'SOURCE_CHANGED' | 'CONTRADICTED';
}

export interface TodayInput {
  today: string;
  leads: KachmoLead[];
  suppression: SuppressionEntry[];
  tracker: Map<string, TrackerRow>;
  callCards: CallingCard[];
  whatsappItems: WhatsAppQueueItem[];
  researchItems: ResearchQueueItem[];
  /** How many research items to include (the top of core's research order). */
  researchLimit?: number;
  candidates?: CandidateToReview[];
  evidence?: EvidenceToReview[];
}

const PRIORITY_RANK: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3, UNSCORED: 4, DISQUALIFIED: 5 };

/** Deterministic order: kind, then overdue first, then due date, then priority, then score, then target number. */
export function compareToday(a: TodayItem, b: TodayItem): number {
  return (
    TODAY_KINDS.indexOf(a.kind) - TODAY_KINDS.indexOf(b.kind) ||
    Number(b.overdue) - Number(a.overdue) ||
    (a.due ?? '9999-99-99').localeCompare(b.due ?? '9999-99-99') ||
    (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
    (b.score ?? -1) - (a.score ?? -1) ||
    a.targetNumber.localeCompare(b.targetNumber)
  );
}

export function buildTodayList(input: TodayInput): TodayItem[] {
  const { today, leads, suppression, tracker } = input;
  const byTn = new Map(leads.map(l => [l.target_number, l]));
  const blocked = (l?: KachmoLead) => !!l && outreachBlock(l, suppression, tracker.get(l.target_number)?.status ?? null).blocked;
  const ownerOf = (l: KachmoLead | undefined, fallback: 'DEV' | 'AADI'): 'DEV' | 'AADI' => (l?.owner === 'AADI' || l?.owner === 'DEV' ? l.owner : fallback);
  const base = (kind: TodayKind, l: KachmoLead | undefined, tn: string, owner: 'DEV' | 'AADI', due: string | null, why: string[], where: 'OS' | 'TITAN' = 'OS'): TodayItem => ({
    kind,
    leadId: l?.lead_id ?? null,
    targetNumber: tn,
    company: l?.company_name ?? '',
    owner,
    due,
    overdue: !!due && due < today,
    priority: l?.lead_priority ?? 'UNSCORED',
    score: l?.kachmo_score ?? null,
    why,
    where,
    ref: null,
  });
  const items: TodayItem[] = [];
  const rows = [...tracker.values()];

  // Email replies and follow-ups: the work happens in Titan, which owns email. Dev owns the email channel.
  for (const r of rows.filter(isReplyWaiting)) {
    const l = byTn.get(r.target_number);
    items.push(base('REPLY_WAITING', l, r.target_number, 'DEV', null, [`OUTREACH_TRACKER.md status: ${r.status}`], 'TITAN'));
  }
  for (const r of rows) {
    const l = byTn.get(r.target_number);
    if (isEmailFollowUpDue(r, l, today, blocked(l))) {
      items.push(base('EMAIL_FOLLOW_UP_DUE', l, r.target_number, 'DEV', r.follow_up_due, [`OUTREACH_TRACKER.md status: SENT on ${r.sent_date ?? '—'}`, `follow_up_due: ${r.follow_up_due}`], 'TITAN'));
    }
  }

  for (const l of leads) {
    if (isPositiveWithoutMeeting(l) && !blocked(l)) {
      items.push(base('POSITIVE_NO_MEETING', l, l.target_number, ownerOf(l, 'DEV'), null, ['response_status: REPLIED_POSITIVE', 'meeting_status: none']));
    }
    if (isFollowUpDue(l, today, blocked(l))) {
      items.push(base('FOLLOW_UP_DUE', l, l.target_number, ownerOf(l, 'DEV'), l.next_action_date, [`next_action: ${l.next_action ?? '—'}`, `next_action_date: ${l.next_action_date}`]));
    }
  }

  // Call and WhatsApp work comes from core's own selectors, which already applied eligibility and suppression.
  // The calling and WhatsApp channels are Aadi's, as the war room assigns them.
  for (const c of input.callCards) {
    const l = byTn.get(c.target_number);
    if (blocked(l)) continue;
    items.push(base('CALL_READY', l, c.target_number, 'AADI', null, [`phone_status: ${c.phone_status}`, `recommended_channel: ${l?.recommended_channel ?? '—'}`, `previous call attempts: ${c.previous_attempts}`]));
  }
  for (const w of input.whatsappItems) {
    const l = byTn.get(w.target_number);
    if (blocked(l)) continue;
    if (w.status === 'APPROVED') items.push(base('WHATSAPP_TO_SEND', l, w.target_number, 'AADI', null, ['whatsapp_outreach_status: APPROVED', `whatsapp_basis: ${w.whatsapp_basis}`]));
    else if (w.status === 'PENDING_HUMAN_REVIEW') items.push(base('WHATSAPP_TO_APPROVE', l, w.target_number, 'AADI', null, ['a WhatsApp draft awaits human review', `whatsapp_basis: ${w.whatsapp_basis}`]));
  }

  // Human checkpoints on research: candidates are approved by an approver (the DEV role); evidence belongs to the lead's owner.
  for (const c of input.candidates ?? []) {
    items.push({ ...base('CANDIDATE_REVIEW', undefined, '—', 'DEV', null, [`candidate status: ${c.status}`, `extracted: ${c.createdOn}`]), company: c.company, ref: c.id });
  }
  const byId = new Map(leads.map(l => [l.lead_id, l]));
  for (const e of input.evidence ?? []) {
    const l = byId.get(e.leadId);
    if (!l) continue;
    const kind: TodayKind = e.state === 'CONTRADICTED' ? 'EVIDENCE_CONTRADICTION' : e.state === 'SOURCE_CHANGED' ? 'EVIDENCE_RECHECK' : 'EVIDENCE_REVIEW';
    const why =
      e.state === 'CONTRADICTED'
        ? [`claim: ${e.field}`, 'a person recorded that the source contradicts this claim', 'correct the lead record, or reject the claim']
        : e.state === 'SOURCE_CHANGED'
          ? [`claim: ${e.field}`, `source re-fetched ${e.fetchedOn} and its content changed`, 'the earlier check no longer describes the page']
          : [`claim: ${e.field}`, `source retrieved: ${e.fetchedOn}`, 'level: RETRIEVED — not yet checked by a person'];
    items.push({ ...base(kind, l, l.target_number, ownerOf(l, 'DEV'), null, why), ref: e.evidenceId });
  }

  // Research: the top of core's research queue (already ordered, already excludes blocked and disqualified leads).
  for (const r of input.researchItems.slice(0, input.researchLimit ?? 10)) {
    const l = byTn.get(r.target_number);
    items.push(base('RESEARCH', l, r.target_number, r.owner, null, [`research_completeness: ${r.research_completeness_score}%`, `next task: ${r.specific_research_tasks[0]?.field ?? '—'}`, `open tasks: ${r.specific_research_tasks.length}`]));
  }

  return items.sort(compareToday);
}
