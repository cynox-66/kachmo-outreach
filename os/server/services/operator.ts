import type { KachmoLead, QualificationGates, GateOutcome, ContactProvenance, ResearchState } from '@kachmo/core/leads/schema.js';
import type { TrackerRow } from '@kachmo/core/email-ledger/tracker.js';
import type { TodayItem, TodayKind } from '@kachmo/core/queues/today.js';
import type { EvidenceLevel } from '@kachmo/core/research/evidence.js';
import { CALL_OUTCOME_CHOICES, RESEARCH_CHOICES, STAGE_CHOICES, WHATSAPP_CHOICES } from '../../lib/choices';

export { CALL_OUTCOME_CHOICES, RESEARCH_CHOICES, STAGE_CHOICES, WHATSAPP_CHOICES };

/**
 * THE OPERATOR'S LANGUAGE (ADR-035).
 *
 * Every value the engine and the email ledger produce, translated into what an operator needs to read. Pure: it labels
 * values core already computed and never decides anything — eligibility, qualification, scoring and suppression stay
 * core's. A value without a label here is a test failure (tests/operator.ts), so a new engine value can never reach
 * the screen as an identifier.
 *
 * The one rule that is not about wording: nothing here may make a claim sound more certain than the engine says it
 * is. An UNVERIFIED claim is never "checked", a planned email is never "sent".
 */

export type Tone = 'stop' | 'act' | 'neutral' | 'done';

// ── Dates ────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const asUtcDay = (ymd: string): number => Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`);

/** Whole days from `a` to `b` (YYYY-MM-DD). Positive when `b` is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round((asUtcDay(b) - asUtcDay(a)) / DAY);
}

/** "Tue 15 Sep" for a calendar date. Returns the input unchanged when it is not a date. */
export function dayLabel(ymd: string | null | undefined): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return ymd ?? '';
  const t = asUtcDay(ymd);
  if (Number.isNaN(t)) return ymd;
  return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** "22 Sep, 14:05" in IST (where the studio works) for an instant. */
export function momentLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
}

/** "today", "yesterday", "3 days ago", "in 2 days" relative to `today` (YYYY-MM-DD). */
export function relativeDays(ymd: string, today: string): string {
  const n = daysBetween(ymd, today);
  if (n === 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n === -1) return 'tomorrow';
  return n > 0 ? `${n} days ago` : `in ${-n} days`;
}

// ── Labels for engine values ─────────────────────────────────────────────────

/** The eight qualification checks, in the words an operator uses. Keys are exactly core's gate keys (tested). */
export const GATE_LABELS: Record<keyof QualificationGates, string> = {
  gate_1_decision_maker: 'Named decision-maker',
  gate_2_contactability: 'A direct way to reach them',
  gate_3_commercial_proof: 'Proof they buy this kind of work',
  gate_4_digital_friction: 'A website problem we can fix',
  gate_5_location_timezone: 'Location and timezone',
  gate_6_budget_probability: 'Likely budget',
  gate_7_buying_intent: 'A reason to act now',
  gate_8_kachmo_fit: 'Right fit for Kachmo',
};

export const GATE_OUTCOME_LABELS: Record<GateOutcome, { label: string; meaning: string }> = {
  PASS: { label: 'Met', meaning: 'Satisfied — a source is recorded, or it can be checked structurally (like a timezone). A recorded source has not necessarily been opened.' },
  UNVERIFIED: { label: 'Claimed, no source', meaning: 'On file, but nobody recorded where it came from. Does not block — but do not state it as fact.' },
  PENDING: { label: 'Missing', meaning: 'Required information is missing. Research needed.' },
  UNKNOWN: { label: 'Not researched', meaning: 'Optional, and not researched yet. Never blocks.' },
  FAIL: { label: 'Fails', meaning: 'Evidence rules this company out on this check.' },
};

export const RESEARCH_STATE_LABELS: Record<ResearchState, string> = {
  DISCOVERED: 'Needs research',
  QUALIFICATION_PENDING: 'Needs research',
  RESEARCH_REQUIRED: 'Needs research',
  ENRICHED: 'Needs research',
  QUALIFIED: 'Qualified — no contact route yet',
  OUTREACH_READY: 'Ready to contact',
  DISQUALIFIED: 'Disqualified',
};

export const PROVENANCE_LABELS: Record<ContactProvenance, { label: string; usable: boolean; meaning: string }> = {
  PUBLICLY_LISTED: { label: 'Published by them', usable: true, meaning: 'They publish it themselves, and the page is recorded.' },
  VERIFIED: { label: 'Confirmed by us', usable: true, meaning: 'Someone here confirmed it, and how is recorded.' },
  UNVERIFIED: { label: 'Source unknown', usable: false, meaning: 'From earlier research; nobody recorded where it came from.' },
  INFERRED: { label: "Guessed — don't use", usable: false, meaning: 'Made up from a pattern (like name@company). Never used for outreach.' },
  INVALID: { label: 'Bounced or wrong', usable: false, meaning: 'It bounced or reached the wrong person.' },
  UNKNOWN: { label: 'None', usable: false, meaning: 'Nothing on file.' },
};

/** Titan's email-ledger statuses (OUTREACH_TRACKER.md). */
export const LEDGER_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Not written yet',
  DRAFTED: 'Email drafted',
  SCHEDULED: 'Email scheduled',
  SENT: 'Emailed',
  FOLLOW_UP_DUE: 'Follow-up due',
  FOLLOWED_UP: 'Followed up',
  REPLIED_WARM: 'Replied — interested',
  REPLIED_NOT_NOW: 'Replied — not now',
  REPLIED_NO: 'Replied — no',
  CALL_BOOKED: 'Call booked',
  PROPOSAL_SENT: 'Proposal sent',
  WON: 'Won',
  DISQUALIFIED: 'Not emailed (disqualified)',
};

export const ledgerStatusLabel = (status: string | null | undefined): string =>
  status ? (LEDGER_STATUS_LABELS[status] ?? status.replace(/_/g, ' ').toLowerCase()) : 'Not in the email records';

export const EVIDENCE_LEVEL_LABELS: Record<EvidenceLevel, string> = {
  SUPPORTED: 'Checked',
  RETRIEVED: 'Page fetched, not checked',
  URL_SHAPED: 'Source recorded, not checked',
  CLAIMED: 'No source',
  NONE: 'No source',
  CONTRADICTED: 'A source disagrees',
};

/** What a missing research field means, as the thing to go and find. Keys are core's research task fields (tested). */
export const RESEARCH_TASK_LABELS: Record<string, string> = {
  direct_contact_route: 'a direct email or phone for the decision-maker',
  phone_source: 'where their phone number is published',
  email_source: 'where their email address is published',
  decision_maker_name: "the decision-maker's name",
  decision_maker_source: 'a source for the decision-maker',
  observable_friction: 'a website problem we can fix',
  website_friction_source: 'a source for the website problem',
  commercial_validation_signal: 'proof they buy this kind of work',
  commercial_signal_source: 'a source for that proof',
  kachmo_solution_angle: 'how Kachmo would help',
  kachmo_fit_review: 'a fit decision',
  location_timezone: 'their timezone',
  trigger_event: 'a reason to act now',
  trigger_source: 'a source for the reason to act now',
  budget_probability: 'a budget signal',
  budget_probability_source: 'a source for the budget signal',
  technology_stack: 'their website technology',
  technology_source: 'a source for their technology',
  frontend_team_status: 'whether they have their own frontend team',
};

export const researchTaskLabel = (field: string): string => RESEARCH_TASK_LABELS[field] ?? field.replace(/_/g, ' ');

/**
 * The engine's stored next_action phrases, in operator words. Several were written for the builders ("Watch Titan
 * inbox; follow up on the OUTREACH_TRACKER.md due date", "Research: decision_maker_source"). Anything not recognised
 * is a human-written next step and is shown exactly as recorded.
 */
export function nextActionLabel(raw: string | null | undefined): string | null {
  const a = raw?.trim();
  if (!a) return null;
  const research = a.match(/^Research: ([a-z_]+)(?:,.*)?$/);
  if (research) return `Find ${researchTaskLabel(research[1])}`;
  if (/^Watch Titan inbox/i.test(a)) return 'Watch for a reply; send the one follow-up when it is due';
  if (/^Drafted in Titan/i.test(a)) return 'An email is drafted — Dev reviews it and sends it';
  if (/^Scheduled in production email queue/i.test(a)) return 'Scheduled — it sends automatically';
  if (/via the Titan flow/i.test(a)) return 'Dev writes them a personal email';
  if (/^None — do not contact$/i.test(a)) return 'None — do not contact';
  return a;
}

/** Lead fields as nouns, for evidence and history lines. */
const FIELD_NOUNS: Record<string, string> = {
  decision_maker_name: 'the decision-maker',
  decision_maker_email: 'the email address',
  decision_maker_phone: 'the phone number',
  commercial_validation_signal: 'the proof they buy this kind of work',
  observable_friction: 'the website problem',
  trigger_event: 'the reason to act now',
  budget_probability: 'the budget signal',
  current_framework: 'the website technology',
  frontend_team_status: 'the frontend team',
  timezone: 'the timezone',
  whatsapp_basis: 'the WhatsApp permission',
  kachmo_fit_confirmed_by: 'the fit decision',
  company_name: 'the company name',
  website_url: 'the website',
};
export const fieldNoun = (field: string): string => FIELD_NOUNS[field] ?? researchTaskLabel(field);

// ── Claims and how far each one has been verified ────────────────────────────

export type Verification = 'CHECKED' | 'FETCHED' | 'SOURCED' | 'UNSOURCED' | 'CONTRADICTED';

export const VERIFICATION: Record<Verification, { mark: string; label: string; note: string }> = {
  CHECKED: { mark: '●', label: 'Checked', note: 'A person matched this to its source.' },
  FETCHED: { mark: '◐', label: 'Page fetched, not checked', note: 'The source page was retrieved; nobody has confirmed it says this yet.' },
  SOURCED: { mark: '◐', label: 'Source recorded, not checked', note: 'A source is recorded; nobody has opened it to confirm.' },
  UNSOURCED: { mark: '○', label: 'No source', note: 'From earlier research with no source. Don’t quote it as fact.' },
  CONTRADICTED: { mark: '✕', label: 'A source disagrees', note: 'Someone found a source that contradicts this. Treat it as wrong until corrected.' },
};

/**
 * How far a claim has actually been verified. Claim-level evidence, when there is any, is more specific than the gate
 * outcome and wins; otherwise the gate outcome decides. v1.0 PASS means a source is *recorded* — never that it was
 * checked — so PASS alone is SOURCED, not CHECKED.
 */
export function verificationFor(outcome: GateOutcome | string | null | undefined, evidence?: { level: EvidenceLevel; contradicted: boolean } | null): Verification {
  if (evidence?.contradicted) return 'CONTRADICTED';
  if (evidence?.level === 'SUPPORTED') return 'CHECKED';
  if (evidence?.level === 'RETRIEVED') return 'FETCHED';
  if (evidence?.level === 'URL_SHAPED') return 'SOURCED';
  return outcome === 'PASS' ? 'SOURCED' : 'UNSOURCED';
}

export interface ClaimView {
  key: string;
  label: string;
  value: string;
  verification: Verification;
  gate: keyof QualificationGates;
}

/**
 * The claims behind "why them", each with its verification. Only claims that are actually on file are returned — an
 * empty field is research to do, not a claim.
 */
export function whyClaims(
  lead: KachmoLead,
  gates: QualificationGates,
  coverage?: Array<{ gate: string; level: EvidenceLevel; contradicted: boolean }> | null
): ClaimView[] {
  const cov = (g: keyof QualificationGates) => coverage?.find(c => c.gate === g) ?? null;
  const rows: Array<[string, string, string | null | undefined, keyof QualificationGates]> = [
    ['commercial', 'Proof they buy this kind of work', lead.commercial_validation_signal, 'gate_3_commercial_proof'],
    ['friction', 'A website problem we can fix', lead.observable_friction, 'gate_4_digital_friction'],
    ['trigger', 'A reason to act now', lead.why_now ?? (lead.trigger_event && lead.trigger_event !== 'NO_CLEAR_TRIGGER' ? lead.trigger_event : null), 'gate_7_buying_intent'],
  ];
  return rows
    .filter(([, , value]) => !!value && !!String(value).trim())
    .map(([key, label, value, gate]) => ({ key, label, value: String(value).trim(), verification: verificationFor(gates[gate], cov(gate)), gate }));
}

// ── Email records: planned is never "sent" ───────────────────────────────────

export interface EmailDates {
  /** The date column read the way the status means it. */
  kind: 'PLANNED' | 'SENT' | null;
  date: string | null;
  followUpDue: string | null;
  /** A planned email whose date has passed and still has not gone out. */
  late: boolean;
  lateDays: number;
}

const PRE_SEND = new Set(['SCHEDULED', 'DRAFTED', 'PENDING']);

export function emailDates(row: Pick<TrackerRow, 'status' | 'sent_date' | 'follow_up_due'> | null | undefined, today: string): EmailDates {
  if (!row) return { kind: null, date: null, followUpDue: null, late: false, lateDays: 0 };
  const date = row.sent_date && /^\d{4}-\d{2}-\d{2}/.test(row.sent_date) ? row.sent_date.slice(0, 10) : null;
  if (PRE_SEND.has(row.status)) {
    const lateDays = date ? daysBetween(date, today) : 0;
    return { kind: date ? 'PLANNED' : null, date, followUpDue: null, late: row.status === 'SCHEDULED' && !!date && lateDays > 0, lateDays: Math.max(0, lateDays) };
  }
  if (row.status === 'DISQUALIFIED') return { kind: null, date: null, followUpDue: null, late: false, lateDays: 0 };
  const due = row.follow_up_due && /^\d{4}-\d{2}-\d{2}/.test(row.follow_up_due) ? row.follow_up_due.slice(0, 10) : null;
  return { kind: date ? 'SENT' : null, date, followUpDue: due, late: false, lateDays: 0 };
}

// ── The company's status, in one label and one sentence ─────────────────────

export interface OperatorStatus {
  key: string;
  label: string;
  tone: Tone;
  sentence: string;
}

/** Why a company is blocked, in words (core's outreachBlock reasons are field-and-value statements). */
export function blockSentence(reason: string | null | undefined): string {
  const r = (reason ?? '').trim();
  if (!r) return 'They must not be contacted.';
  if (/OUTREACH_TRACKER\.md status is REPLIED_NO|response_status is REPLIED_NO/.test(r)) return 'They replied no to our email.';
  if (/is (DO_NOT_CONTACT|OPT_OUT|UNSUBSCRIBED)\b/.test(r)) return 'They asked not to be contacted.';
  const m = r.match(/^(lead_id|target_number|email|phone|domain) match — (.*)$/);
  if (m) {
    const by = { lead_id: 'this company', target_number: 'this company', email: 'their email address', phone: 'their phone number', domain: 'their website domain' }[m[1] as 'email'];
    return `On the do-not-contact list (${by}): ${m[2]}`;
  }
  if (r === 'do_not_contact flag set') return 'Marked do not contact.';
  return r;
}

export function operatorStatus(input: {
  lead: KachmoLead;
  ledger: Pick<TrackerRow, 'status' | 'sent_date' | 'follow_up_due'> | null;
  blocked: { blocked: boolean; reason: string | null };
  queued: boolean;
  today: string;
}): OperatorStatus {
  const { lead, ledger, blocked, queued, today } = input;
  if (blocked.blocked) return { key: 'DO_NOT_CONTACT', label: 'Do not contact', tone: 'stop', sentence: blockSentence(blocked.reason) };
  if (lead.deal_stage === 'WON') return { key: 'WON', label: 'Won', tone: 'done', sentence: `Won${lead.deal_value ? ` · ${lead.deal_value}` : ''}.` };
  if (lead.deal_stage === 'LOST') return { key: 'LOST', label: 'Lost', tone: 'neutral', sentence: `Lost${lead.lost_reason ? ` (${lead.lost_reason.toLowerCase().replace(/_/g, ' ')})` : ''}.` };
  if (lead.proposal_status === 'SENT') return { key: 'PROPOSAL_SENT', label: 'Proposal sent', tone: 'neutral', sentence: 'A proposal has been sent.' };
  if (lead.meeting_status === 'BOOKED') return { key: 'MEETING_BOOKED', label: 'Meeting booked', tone: 'act', sentence: `A meeting is booked${lead.next_action_date ? ` for ${dayLabel(lead.next_action_date)}` : ''}.` };
  if (lead.meeting_status === 'DONE') return { key: 'MET', label: 'Met', tone: 'neutral', sentence: 'You have met. Next is usually a proposal.' };
  if (lead.response_status === 'REPLIED_POSITIVE') return { key: 'INTERESTED', label: 'Replied — interested', tone: 'act', sentence: 'They are interested. No meeting is booked yet.' };
  if (lead.response_status === 'REPLIED_NOT_NOW') return { key: 'NOT_NOW', label: 'Replied — not now', tone: 'neutral', sentence: `Not now${lead.next_action_date ? `; check in again ${dayLabel(lead.next_action_date)}` : ''}.` };
  if (lead.response_status === 'NOT_INTERESTED') return { key: 'NOT_INTERESTED', label: 'Not interested', tone: 'neutral', sentence: 'They said they are not interested.' };
  if (lead.whatsapp_outreach_status === 'REPLIED' || lead.response_status === 'REPLIED') return { key: 'REPLIED', label: 'Replied', tone: 'act', sentence: 'They replied. Answer them personally.' };

  const status = ledger?.status ?? null;
  const d = emailDates(ledger, today);
  if (status === 'REPLIED_WARM') return { key: 'REPLIED_EMAIL', label: 'Replied — interested', tone: 'act', sentence: 'They replied to our email with interest. Answer from the studio inbox.' };
  if (status === 'REPLIED_NOT_NOW') return { key: 'NOT_NOW', label: 'Replied — not now', tone: 'neutral', sentence: 'They replied to our email: not now.' };
  if (status === 'CALL_BOOKED') return { key: 'MEETING_BOOKED', label: 'Call booked', tone: 'act', sentence: 'A call is booked (from the email records).' };
  if (status === 'PROPOSAL_SENT') return { key: 'PROPOSAL_SENT', label: 'Proposal sent', tone: 'neutral', sentence: 'A proposal has been sent (from the email records).' };
  if (status === 'WON') return { key: 'WON', label: 'Won', tone: 'done', sentence: 'Won (from the email records).' };
  if (status === 'FOLLOWED_UP' || (status && ['SENT', 'FOLLOW_UP_DUE'].includes(status) && lead.email_follow_up_sent_at)) {
    return { key: 'FOLLOWED_UP', label: 'Followed up', tone: 'neutral', sentence: `Emailed${d.date ? ` ${dayLabel(d.date)}` : ''} and followed up once. No more emails; wait for a reply.` };
  }
  if (status === 'SENT' || status === 'FOLLOW_UP_DUE') {
    if (d.followUpDue && d.followUpDue <= today) {
      const late = daysBetween(d.followUpDue, today);
      return { key: 'FOLLOW_UP_DUE', label: 'Follow-up due', tone: 'act', sentence: `Emailed ${dayLabel(d.date)}. The one follow-up was due ${dayLabel(d.followUpDue)}${late > 0 ? ` (${relativeDays(d.followUpDue, today)})` : ''}.` };
    }
    return { key: 'EMAILED', label: 'Emailed', tone: 'neutral', sentence: `Emailed ${dayLabel(d.date)}.${d.followUpDue ? ` Follow-up due ${dayLabel(d.followUpDue)}.` : ''}` };
  }
  if (status === 'SCHEDULED' || queued) {
    if (d.late) return { key: 'SCHEDULED_LATE', label: 'Email not sent yet', tone: 'act', sentence: `Scheduled for ${dayLabel(d.date)} but it has not gone out (${d.lateDays} day${d.lateDays === 1 ? '' : 's'} late).` };
    return { key: 'SCHEDULED', label: 'Email scheduled', tone: 'neutral', sentence: d.date ? `Scheduled to send automatically on ${dayLabel(d.date)}.` : 'In the automatic email queue.' };
  }
  if (status === 'DRAFTED') return { key: 'DRAFTED', label: 'Email drafted', tone: 'neutral', sentence: 'An email is drafted in the studio inbox but not sent.' };
  if (lead.whatsapp_outreach_status === 'SENT') return { key: 'WHATSAPP_SENT', label: 'WhatsApp sent', tone: 'neutral', sentence: 'A WhatsApp message was sent. Wait for a reply.' };
  if (lead.whatsapp_outreach_status === 'APPROVED') return { key: 'WHATSAPP_TO_SEND', label: 'WhatsApp to send', tone: 'act', sentence: 'A WhatsApp message is approved and waiting to be sent from a phone.' };
  if (lead.call_status === 'CALLBACK' && lead.next_action_date) return { key: 'CALL_BACK', label: 'Call back', tone: 'act', sentence: `They asked for a call back on ${dayLabel(lead.next_action_date)}.` };

  switch (lead.research_state) {
    case 'OUTREACH_READY':
      return { key: 'READY', label: 'Ready to contact', tone: 'act', sentence: 'Qualified, with a usable way to reach them.' };
    case 'QUALIFIED':
      return { key: 'QUALIFIED', label: 'Qualified — no contact route yet', tone: 'neutral', sentence: 'Qualified, but there is no usable email or phone for the decision-maker yet.' };
    case 'DISQUALIFIED':
      return { key: 'DISQUALIFIED', label: 'Disqualified', tone: 'neutral', sentence: lead.disqualification_reasons?.length ? `Ruled out: ${lead.disqualification_reasons[0]}` : 'Ruled out by the qualification checks.' };
    default:
      return { key: 'NEEDS_RESEARCH', label: 'Needs research', tone: 'neutral', sentence: 'Some required facts are missing before anyone should contact them.' };
  }
}

/** Status keys an operator can filter the company list by, in the order they are offered. */
export const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'act', label: 'Needs you' },
  { key: 'READY', label: 'Ready to contact' },
  { key: 'FOLLOW_UP_DUE', label: 'Follow-up due' },
  { key: 'SCHEDULED_ANY', label: 'Email scheduled' },
  { key: 'EMAILED_ANY', label: 'Emailed' },
  { key: 'REPLIED_ANY', label: 'Replied / in conversation' },
  { key: 'NEEDS_RESEARCH', label: 'Needs research' },
  { key: 'QUALIFIED', label: 'Qualified — no contact route yet' },
  { key: 'DO_NOT_CONTACT', label: 'Do not contact' },
  { key: 'DISQUALIFIED', label: 'Disqualified' },
];

export function statusMatches(filter: string, s: OperatorStatus): boolean {
  switch (filter) {
    case 'act':
      return s.tone === 'act';
    case 'SCHEDULED_ANY':
      return s.key === 'SCHEDULED' || s.key === 'SCHEDULED_LATE' || s.key === 'DRAFTED';
    case 'EMAILED_ANY':
      return s.key === 'EMAILED' || s.key === 'FOLLOW_UP_DUE' || s.key === 'FOLLOWED_UP';
    case 'REPLIED_ANY':
      return ['INTERESTED', 'NOT_NOW', 'NOT_INTERESTED', 'REPLIED', 'REPLIED_EMAIL', 'MEETING_BOOKED', 'MET', 'PROPOSAL_SENT', 'WON', 'LOST'].includes(s.key);
    default:
      return s.key === filter;
  }
}

// ── Today's work items, as sentences ─────────────────────────────────────────

export type Urgency = 'now' | 'today' | 'later';

export const KIND_URGENCY: Record<TodayKind, Urgency> = {
  REPLY_WAITING: 'now',
  POSITIVE_NO_MEETING: 'now',
  EVIDENCE_CONTRADICTION: 'now',
  FOLLOW_UP_DUE: 'today',
  EMAIL_FOLLOW_UP_DUE: 'today',
  WHATSAPP_TO_SEND: 'today',
  CALL_READY: 'today',
  WHATSAPP_TO_APPROVE: 'today',
  CANDIDATE_REVIEW: 'later',
  EVIDENCE_RECHECK: 'later',
  EVIDENCE_REVIEW: 'later',
  RESEARCH: 'later',
};

export interface WorkLine {
  /** One short phrase naming the work, e.g. "Follow up by email". */
  what: string;
  /** One sentence of plain facts, built from the same stored values the engine selected the item with. */
  sentence: string;
  /** The button: what happens when it is pressed. Never "send": the app sends nothing. */
  action: string;
  urgency: Urgency;
}

const factAfter = (why: string[], prefix: string): string | null => {
  const f = why.find(w => w.startsWith(prefix));
  return f ? f.slice(prefix.length).trim() : null;
};

/**
 * Translates one Today item. The item's `why` facts are core's `field: value` statements; they are read back here as
 * data (dates, counts, fields) and never shown raw.
 */
export function describeWork(item: TodayItem, ctx: { today: string; ledger?: Pick<TrackerRow, 'status' | 'sent_date' | 'follow_up_due'> | null; nextAction?: string | null }): WorkLine {
  const urgency = KIND_URGENCY[item.kind];
  switch (item.kind) {
    case 'REPLY_WAITING':
      return {
        what: 'Reply waiting',
        sentence: `${ctx.ledger?.status === 'REPLIED_NOT_NOW' ? 'They replied to our email: not now.' : 'They replied to our email with interest.'} Answer from the studio inbox.`,
        action: 'Open company',
        urgency,
      };
    case 'POSITIVE_NO_MEETING':
      return { what: 'Book a meeting', sentence: 'They said they are interested, and no meeting is booked yet.', action: 'Open company', urgency };
    case 'FOLLOW_UP_DUE': {
      const due = item.due ?? factAfter(item.why, 'next_action_date:');
      const what = nextActionLabel(ctx.nextAction) ?? nextActionLabel(factAfter(item.why, 'next_action:')) ?? 'Follow up';
      return { what, sentence: due ? `Due ${dayLabel(due)}${due < ctx.today ? ` (${relativeDays(due, ctx.today)})` : ''}.` : 'Due today.', action: 'Open company', urgency };
    }
    case 'EMAIL_FOLLOW_UP_DUE': {
      const d = emailDates(ctx.ledger ?? null, ctx.today);
      const due = item.due ?? d.followUpDue;
      const late = due && due < ctx.today ? ` (${relativeDays(due, ctx.today)})` : '';
      return {
        what: 'Follow up by email',
        sentence: `Emailed ${d.date ? dayLabel(d.date) : 'earlier'}. The one follow-up was due ${due ? dayLabel(due) : 'now'}${late}. Send it from the studio inbox.`,
        action: 'Open company',
        urgency,
      };
    }
    case 'WHATSAPP_TO_SEND':
      return { what: 'Send the WhatsApp message', sentence: 'Approved. Send it from your phone, then record that it was sent.', action: 'Open WhatsApp', urgency };
    case 'CALL_READY': {
      const attempts = Number(factAfter(item.why, 'previous call attempts:') ?? 0);
      return { what: 'Call them', sentence: `Their number is published or confirmed.${attempts ? ` ${attempts} earlier attempt${attempts === 1 ? '' : 's'}.` : ''}`, action: 'Open call card', urgency };
    }
    case 'WHATSAPP_TO_APPROVE':
      return { what: 'Review a WhatsApp draft', sentence: 'A message is drafted. Approve or reject it — approving sends nothing.', action: 'Review draft', urgency };
    case 'EVIDENCE_CONTRADICTION': {
      const field = factAfter(item.why, 'claim:');
      return { what: 'A source disagrees', sentence: `Someone found a source that contradicts ${field ? fieldNoun(field) : 'a fact'} on file. Correct it or reject the claim.`, action: 'Open company', urgency };
    }
    case 'CANDIDATE_REVIEW': {
      const on = factAfter(item.why, 'extracted:');
      return { what: 'Review a suggested company', sentence: `Suggested by research${on ? ` on ${dayLabel(on)}` : ''}. Decide whether to add it to the list.`, action: 'Review', urgency };
    }
    case 'EVIDENCE_RECHECK': {
      const field = factAfter(item.why, 'claim:');
      return { what: 'Re-check a source', sentence: `The page behind ${field ? fieldNoun(field) : 'a fact'} changed after it was checked.`, action: 'Open company', urgency };
    }
    case 'EVIDENCE_REVIEW': {
      const field = factAfter(item.why, 'claim:');
      return { what: 'Check a source', sentence: `The page behind ${field ? fieldNoun(field) : 'a fact'} was fetched. Check it says what we recorded.`, action: 'Open company', urgency };
    }
    case 'RESEARCH': {
      const next = factAfter(item.why, 'next task:');
      const open = Number(factAfter(item.why, 'open tasks:') ?? 0);
      return { what: 'Research', sentence: `Find ${next ? researchTaskLabel(next) : 'the missing facts'}${open > 1 ? ` (and ${open - 1} more thing${open - 1 === 1 ? '' : 's'})` : ''}.`, action: 'Add research', urgency };
    }
  }
}

// ── Refusals, in words ───────────────────────────────────────────────────────

/**
 * core's refusals were written for the command line ("--stage=X requires --channel"). They reach operators through
 * the forms, so they are translated here — core, and its golden-pinned wording, stay unchanged.
 */
const REFUSALS: Array<[RegExp, string]> = [
  [/changed since you opened it|changed while this write was being made/i, 'This company changed since you opened it. Reload the page and check before recording again — nothing was saved.'],
  [/requires --channel/, 'Say how they got in touch (email, call, WhatsApp…).'],
  [/--stage=LOST requires --reason/, 'Say why it was lost.'],
  [/--(callback-)?date must be YYYY-MM-DD/, 'Pick the date with the date picker.'],
  [/--whatsapp-ok needs a connected call/, 'WhatsApp permission can only be recorded for a call where you actually spoke to them.'],
  [/--confirmed-identity needs a connected call/, 'You can only confirm who you spoke to on a call that connected.'],
  [/--field=(email|phone) requires --status/, 'Say where it came from: published by them, confirmed by us, source unknown, or bounced/wrong.'],
  // Matched without quoting core's rule text (scripts/__tests__/core-extraction.ts keeps rule wording in core only).
  [/^PUBLICLY_LISTED requires/, 'Add the link to the page where they publish it.'],
  [/^VERIFIED requires/, 'Say how you confirmed it.'],
  [/BUSINESS_LISTED_WHATSAPP requires --source/, 'Add the link to the page where they advertise WhatsApp on this number.'],
  [/PERMISSION_GIVEN_ON_CALL requires --basis/, 'Say when and how they agreed to WhatsApp.'],
  [/--source must be a full http\(s\) URL/, 'The source must be a full web address starting with https://'],
  [/--field=decision-maker requires --source/, 'Add the link to a page that shows this person and their role.'],
  [/--field=(commercial-source|friction-source) requires --source/, 'Add the link to the page that shows it.'],
  [/--field=budget requires --basis/, 'Say what the budget signal is.'],
  [/--field=budget requires --value/, 'Choose very high, high, medium, low or unknown.'],
  [/--field=fit requires --value/, 'Choose confirmed or rejected.'],
  [/--value=REJECTED requires --basis/, 'Say why it is not a fit.'],
  [/--field=frontend-team requires --value/, 'Choose no frontend team, small team, large team or unclear.'],
  [/--field=tech requires --value/, 'Say which CMS or framework.'],
  [/--field=timezone requires --value|Unknown IANA timezone/, 'Use a timezone like Europe/London or America/New_York.'],
  [/--field=trigger requires --value/, 'Say what happened (or that there is no clear trigger).'],
  [/--field=whatsapp-basis requires --value/, 'Choose why WhatsApp is OK: they advertise it, or they agreed on a call.'],
  [/Invalid --[a-z-]+=/, 'That choice is not allowed here.'],
  [/has no phone on file/, 'There is no phone number on file. Record the number first (Research I found → Their phone number).'],
  [/has no (email|phone) on file; pass --value/, 'Type the value — there is none on file to update.'],
  [/Not a valid email/, 'That is not a valid email address.'],
  [/Not a valid phone number/, 'That is not a valid phone number (it needs at least 10 digits).'],
  [/is suppressed \(([^)]*)\)/, 'This company is on the do-not-contact list, so this was refused.'],
  [/deal is already closed/, 'This deal is already closed; a closed deal cannot be reopened.'],
  [/no booked meeting recorded/, 'Record the meeting first.'],
  [/: no meeting recorded\./, 'Record a meeting before a proposal.'],
  [/: no proposal recorded\./, 'Record the proposal before marking it won.'],
  [/is not APPROVED/, 'The draft has to be approved before it can be recorded as sent.'],
  [/is already SENT/, 'This message is already recorded as sent.'],
  [/WhatsApp is already/, 'This WhatsApp message is already finished (sent or replied).'],
  [/REPLIED requires a SENT message/, 'A reply can only be recorded after the message was sent.'],
  [/not eligible for WhatsApp|no longer eligible for WhatsApp/, 'WhatsApp can’t be used for this company: there is no confirmed number and permission to use it.'],
  [/single-bump protocol|already shows FOLLOWED_UP|follow-up already sent/, 'The one follow-up has already been sent. No more emails.'],
  [/does not show a sent email/, 'The email records do not show a sent email for this company.'],
  [/Email follow-ups are sent and recorded by Titan/, 'Email follow-ups are recorded by the email tools, not here.'],
  [/not bound to an engine actor/, 'Your account is not set up to record changes yet. Ask an owner (Dev) to set it up.'],
  [/KACHMO_APP_WRITES|accepts no lead writes|not a production build|KACHMO_APP_WRITES_HOST|write target cannot be verified/, 'Recording is switched off right now, so nothing was saved.'],
  [/^Not permitted:/, 'Your role cannot do this.'],
  [/Missing lead version/, 'This page is out of date. Reload it and try again.'],
  [/Missing or invalid lead/, 'This company could not be found. Reload the page.'],
];

export function humanizeRefusal(message: string | null | undefined): string {
  const m = (message ?? '').trim();
  if (!m) return 'Nothing was saved.';
  for (const [re, text] of REFUSALS) if (re.test(m)) return text;
  // Unknown wording: drop command-line syntax and a leading target number rather than show it.
  return m.replace(/^\d{3}\s*[:(]?\s*/, '').replace(/--[a-z-]+(=\S+)?/g, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * core's success summaries were also written for the CLI ("101 Spin: NO_ANSWER. Next: Retry call (2026-09-24)",
 * "… Run "npm run leads:refresh" to re-qualify" — which is wrong in the app, where re-evaluation happens in the same
 * write). Translated here; unknown wording passes through without its command-line instructions.
 */
export function humanizeSuccess(message: string | null | undefined): string {
  const m = (message ?? '').trim();
  let r = m.match(/^Recorded ([a-z-]+) for \d{3} /);
  if (r) return `Recorded: ${RESEARCH_CHOICES[r[1]]?.label ?? r[1]}. The company was re-checked with it.`;
  r = m.match(/^\d{3} .*?: WhatsApp ([A-Z_]+)$/);
  if (r) return `Recorded: ${WHATSAPP_CHOICES[r[1]]?.label ?? r[1].toLowerCase()}.`;
  r = m.match(/^\d{3} .*?: ([A-Z_]+)\. Next: (.*?)(?: \((\d{4}-\d{2}-\d{2})\))?$/);
  if (r) {
    const label = CALL_OUTCOME_CHOICES[r[1]]?.label ?? STAGE_CHOICES[r[1]]?.label ?? r[1].toLowerCase().replace(/_/g, ' ');
    const next = r[2] && r[2] !== 'undefined' && r[2] !== 'null' ? ` Next: ${r[2]}${r[3] ? ` (${dayLabel(r[3])})` : ''}.` : '';
    return `Recorded: ${label}.${next}`;
  }
  if (/^(Suppression recorded|An equivalent suppression already existed)/.test(m)) {
    const queued = /Still queued for email/.test(m);
    return (
      (m.startsWith('An equivalent') ? 'They were already on the do-not-contact list; this company is now marked too.' : 'Added to the do-not-contact list.') +
      ' Nobody will contact them again on any channel.' +
      (queued ? ' They were in the automatic email queue, so automatic email is now on hold for everyone until Dev removes them from the queue.' : '')
    );
  }
  return m.replace(/Run "npm run[^"]*"[^.]*\.?/g, '').replace(/\s{2,}/g, ' ').trim();
}

/** Why core left a company out of the call or WhatsApp queue, in words (core's reasons are rule statements). */
export function humanizeExclusion(reason: string | null | undefined): string {
  const r = (reason ?? '').trim();
  let m: RegExpMatchArray | null;
  if (r === 'disqualified') return 'Ruled out by the qualification checks.';
  if ((m = r.match(/^suppressed: (.*)$/))) return `Do not contact — ${blockSentence(m[1]).replace(/^./, c => c.toLowerCase())}`;
  if ((m = r.match(/phone provenance is (\w+)/))) {
    return (
      { UNVERIFIED: 'The number’s source is unknown — record where they publish it.', INFERRED: 'The number was guessed — don’t use it.', INVALID: 'The number is wrong or bounced.', UNKNOWN: 'No usable number yet.' }[m[1]] ??
      'The number isn’t usable yet.'
    );
  }
  if (r === 'no phone on file') return 'No phone number on file.';
  if (/PUBLICLY_LISTED but phone_source is not a URL/.test(r)) return 'Marked as published, but the link to where is missing.';
  if (/VERIFIED but no verification basis/.test(r)) return 'Marked as confirmed, but how it was confirmed isn’t recorded.';
  if (r === 'already in the sales pipeline') return 'Already in a conversation (a meeting, proposal or deal).';
  if (/^already responded/.test(r)) return 'They have already responded.';
  if ((m = r.match(/^asked to be contacted later \((.*)\)$/))) return `They asked to be contacted later${/^\d{4}-/.test(m[1]) ? ` (${dayLabel(m[1])})` : ''}.`;
  if ((m = r.match(/^earlier call outcome (\w+)$/))) return `An earlier call ended: ${(CALL_OUTCOME_CHOICES[m[1]]?.label ?? m[1]).toLowerCase()}.`;
  if (/wrong number; record the correct one first/.test(r)) return 'The last call reached a wrong number. Record the right one first.';
  if ((m = r.match(/^called within the last (\d+)h$/))) return `Called within the last ${m[1]} hours.`;
  if ((m = r.match(/^callback scheduled for (.*)$/))) return `Call back ${/^\d{4}-/.test(m[1]) ? `on ${dayLabel(m[1])}` : 'later'}.`;
  if ((m = r.match(/^(\d+) unanswered attempts/))) return `${m[1]} calls went unanswered — calling has stopped.`;
  if ((m = r.match(/^next attempt on (.*)$/))) return `Next try ${dayLabel(m[1])}.`;
  if ((m = r.match(/^research_state (\w+)$/))) return `Not ready yet: ${(RESEARCH_STATE_LABELS[m[1] as ResearchState] ?? m[1]).toLowerCase()}.`;
  if ((m = r.match(/^WhatsApp (\w+)$/))) return `WhatsApp already ${m[1].toLowerCase().replace(/_/g, ' ')}.`;
  if (/^no WhatsApp basis/.test(r)) return 'No permission to use WhatsApp yet — they must advertise it, or agree on a call.';
  if (/BUSINESS_LISTED_WHATSAPP requires/.test(r)) return 'Marked as advertised on WhatsApp, but the link is missing.';
  if (/PERMISSION_GIVEN_ON_CALL requires/.test(r)) return 'Marked as agreed on a call, but when isn’t recorded.';
  return r;
}

// ── History ──────────────────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  LEAD_DISCOVERED: 'Added to the list',
  QUALIFICATION_CHANGED: 'Qualification re-checked',
  PRIORITY_CHANGED: 'Priority changed',
  RESEARCH_RECORDED: 'Research recorded',
  CONTACT_PROVENANCE_UPDATED: 'Contact details updated',
  CALL_ATTEMPTED: 'Call',
  CALL_CONNECTED: 'Call connected',
  WHATSAPP_APPROVED: 'WhatsApp draft approved',
  WHATSAPP_REJECTED: 'WhatsApp draft rejected',
  WHATSAPP_SENT: 'WhatsApp sent',
  REPLY_RECEIVED: 'Reply received',
  FOLLOW_UP_SCHEDULED: 'Next step scheduled',
  FOLLOW_UP_SENT: 'Follow-up sent',
  OPT_OUT: 'Asked not to be contacted',
  SUPPRESSION_ADDED: 'Added to the do-not-contact list',
  MEETING_BOOKED: 'Meeting booked',
  MEETING_DONE: 'Meeting happened',
  PROPOSAL_SENT: 'Proposal sent',
  DEAL_WON: 'Deal won',
  DEAL_LOST: 'Deal lost',
  DUPLICATE_FLAGGED: 'Flagged as a possible duplicate',
  // audit actions that describe something that happened to the company
  'lead.call_logged': 'Call recorded',
  'lead.whatsapp_transitioned': 'WhatsApp recorded',
  'lead.pipeline_transitioned': 'Deal stage recorded',
  'lead.research_recorded': 'Research recorded',
  'lead.reevaluated': 'Qualification refreshed',
  'lead.reverted': 'A change was reverted',
  'lead.write_refused': 'A change was refused',
  'lead.ownership_violation': 'A change was refused',
  'suppression.created': 'Added to the do-not-contact list',
  'suppression.create_duplicate': 'Do-not-contact recorded again',
  'research.candidate_imported': 'Added from research',
  'ledger.historical_send_reconciled': 'Email sent by hand (recorded later)',
  'ledger.external_send_recorded': 'Email sent by hand (recorded later)',
  // entries read from the email records (Titan's ledger), which hold dates but no times
  EMAIL_SENT: 'Email sent',
  EMAIL_SCHEDULED: 'Email scheduled',
  EMAIL_DRAFTED: 'Email drafted',
  EMAIL_FOLLOWED_UP: 'Follow-up email sent',
};

/**
 * Entries an operator does not need by default: the engine re-scoring a lead, and the audit record of a write whose
 * domain event is already in the history (the audit row is the same act, seen from the security log). Nothing is
 * dropped — they appear under "Show system changes".
 */
const SYSTEM_EVENTS = new Set([
  'QUALIFICATION_CHANGED',
  'PRIORITY_CHANGED',
  'FOLLOW_UP_SCHEDULED',
  'CALL_CONNECTED',
  'lead.call_logged',
  'lead.whatsapp_transitioned',
  'lead.pipeline_transitioned',
  'lead.research_recorded',
  'lead.reevaluated',
  'lead.write_refused',
  'lead.ownership_violation',
  'suppression.created',
  'suppression.create_duplicate',
  'research.candidate_imported',
]);

export const eventLabel = (kind: string): string => EVENT_LABELS[kind] ?? kind.replace(/[._]/g, ' ').toLowerCase();
/** True for entries an operator normally doesn't need: engine re-scoring, and audit echoes of an event already shown. */
export const isSystemEvent = (kind: string): boolean => SYSTEM_EVENTS.has(kind);
export const knownEventKinds = (): string[] => Object.keys(EVENT_LABELS);

/** The engine actor as a person. */
export const actorName = (actor: string | null | undefined): string =>
  actor === 'DEV' ? 'Dev' : actor === 'AADI' ? 'Aadi' : actor === 'SYSTEM' ? 'System' : (actor ?? '—');
