import 'server-only';
import { emailRoute, phoneEligibility, whatsappEligibility } from '@kachmo/core/contact/provenance.js';
import type { Actor } from '../authz/authorize';
import type { CanonicalSnapshot } from '../repo/canonical';
import { getServer } from '../auth/instance';
import { evidenceForLead, type EvidenceView } from '../evidence/store';
import { coverageForLead } from '../evidence/coverage';
import { getLeadDetail, type LeadDetail } from './leads';
import { getLeadTimeline, type TimelineEntry } from './timeline';
import { senderStatus, type QueuedEmailView } from './sender';
import { scrubContactValues } from './contacts';
import { recordFieldForTask } from './research-queue';
import { ledgerAsOf } from '../repo/titan-ledger';
import {
  PROVENANCE_LABELS,
  blockSentence,
  dayLabel,
  emailDates,
  nextActionLabel,
  researchTaskLabel,
  verificationFor,
  whyClaims,
  type ClaimView,
  type EmailDates,
  type OperatorStatus,
  type Verification,
} from './operator';

/**
 * THE COMPANY PAGE, AS ONE VIEW MODEL (docs/OPERATOR_EXPERIENCE.md §4.3).
 *
 * Everything the page renders, assembled on the server from values core already computed: the lead detail (gates,
 * scores, provenance, tasks), claim evidence and its coverage, the email records, the queued email, and the history.
 * The page itself decides nothing — it lays this out. Contact values are revealed or masked here, once.
 */

export interface RouteLine {
  channel: 'Email' | 'Phone' | 'WhatsApp';
  /** The value to show: the real value for roles that may see it, a mask otherwise, or null when none is on file. */
  value: string | null;
  usable: boolean;
  /** "Published by them", "General inbox — not the decision-maker", "No phone on file" … */
  says: string;
  /** The recorded source, scrubbed for roles that may not see contact values. */
  source: string | null;
}

export interface NextStep {
  text: string;
  detail: string | null;
  /** Which record form, if any, carries it out in the app. */
  record: 'research' | 'pipeline' | 'call' | 'whatsapp' | null;
  /** Research form field to open, when record is research. */
  field: string | null;
}

export interface CompanyView {
  detail: LeadDetail;
  status: OperatorStatus;
  block: { blocked: boolean; sentence: string | null };
  claims: ClaimView[];
  decisionMaker: { name: string; title: string | null; verification: Verification } | null;
  routes: RouteLine[];
  email: { dates: EmailDates; statusLabel: string | null; queued: QueuedEmailView | null; seesEmail: boolean; asOf: string | null };
  next: NextStep;
  timeline: TimelineEntry[];
  evidence: EvidenceView[];
  coverage: Awaited<ReturnType<typeof coverageForLead>> | null;
}

function nextStepFor(v: { status: OperatorStatus; detail: LeadDetail; queued: boolean; dates: EmailDates }): NextStep {
  const { status, detail } = v;
  const none = (text: string, extra: string | null = null): NextStep => ({ text, detail: extra, record: null, field: null });
  switch (status.key) {
    case 'DO_NOT_CONTACT':
      return none('Don’t contact them.', 'They are on the do-not-contact list for every channel.');
    case 'SCHEDULED':
      return none('Nothing for you to do — the email sends automatically.', 'It goes out on a weekday morning in their city, from the studio inbox.');
    case 'SCHEDULED_LATE':
      return none('The scheduled email is late. Tell Dev.', 'The automatic sender has not sent it. Read it below before it goes out — it may need updating.');
    case 'DRAFTED':
      return none('An email is drafted in the studio inbox, not sent.', 'Dev reviews and sends it from the studio inbox.');
    case 'FOLLOW_UP_DUE':
      return none('Send the one follow-up from the studio inbox.', 'One follow-up only. It is recorded in the email records when it is sent.');
    case 'EMAILED':
      return none(v.dates.followUpDue ? `Wait for a reply. The follow-up is due ${dayLabel(v.dates.followUpDue)}.` : 'Wait for a reply.');
    case 'FOLLOWED_UP':
      return none('Wait for a reply. No more emails.');
    case 'REPLIED_EMAIL':
      return { text: 'Answer their reply from the studio inbox.', detail: 'Then record what they said here.', record: 'pipeline', field: null };
    case 'INTERESTED':
      return { text: 'Book a meeting.', detail: 'Record it here once it is booked.', record: 'pipeline', field: null };
    case 'MEETING_BOOKED':
    case 'MET':
    case 'PROPOSAL_SENT':
      return { text: status.key === 'PROPOSAL_SENT' ? 'Follow the proposal through.' : 'Prepare for the meeting.', detail: null, record: 'pipeline', field: null };
    case 'WHATSAPP_TO_SEND':
      return { text: 'Send the approved WhatsApp message from your phone.', detail: 'Then record that it was sent.', record: 'whatsapp', field: null };
    case 'CALL_BACK':
      return { text: v.detail.lead.next_action_date ? `Call them back on ${dayLabel(v.detail.lead.next_action_date)}.` : 'Call them back.', detail: null, record: 'call', field: null };
    case 'READY':
      return { text: 'Contact them.', detail: detail.opportunity.channel ? `Recommended: ${detail.opportunity.channel.toLowerCase()}${detail.opportunity.reason ? ` — ${detail.opportunity.reason}` : ''}.` : null, record: null, field: null };
    default: {
      const task = detail.researchTasks[0];
      if (task && status.key !== 'DISQUALIFIED' && status.key !== 'WON' && status.key !== 'LOST') {
        return { text: `Find ${researchTaskLabel(task.field)}.`, detail: detail.researchTasks.length > 1 ? `${detail.researchTasks.length - 1} more thing${detail.researchTasks.length === 2 ? '' : 's'} to find after that.` : null, record: 'research', field: recordFieldForTask(task.field) };
      }
      const stored = nextActionLabel(detail.row.nextAction);
      return none(stored ?? 'Nothing is due.');
    }
  }
}

export async function getCompany(identifier: string, actor: Actor, snap: CanonicalSnapshot, today: string): Promise<CompanyView | null> {
  const detail = await getLeadDetail(identifier, actor, snap);
  if (!detail) return null;
  const { lead, row, contacts } = detail;
  const postgres = detail.version !== null;
  const db = postgres ? getServer().db : null;

  const [evidence, coverage] = db
    ? await Promise.all([evidenceForLead(db, lead.lead_id), coverageForLead(db, lead, detail.qualificationGates)])
    : [[] as EvidenceView[], null];

  const trackerRow = snap.tracker.get(lead.target_number) ?? null;
  const timeline = db ? await getLeadTimeline(lead, 200, { ledger: trackerRow, today }) : [];

  const seesEmail = actor.permissions.has('email.view_ledger') || actor.permissions.has('outreach.email');
  const queued = seesEmail ? senderStatus(snap, actor, today).queued.find(q => q.targetNumber === lead.target_number) ?? null : null;
  const dates = emailDates(trackerRow, today);

  const cov = coverage?.coverage.find(c => c.gate === 'gate_1_decision_maker') ?? null;
  const decisionMaker = lead.decision_maker_name?.trim()
    ? { name: lead.decision_maker_name.trim(), title: lead.decision_maker_title?.trim() || null, verification: verificationFor(detail.qualificationGates.gate_1_decision_maker, cov) }
    : null;

  const reveal = contacts.revealed;
  const scrub = (text: string | null) => (text && !reveal ? scrubContactValues(text, lead) : text);
  const route = emailRoute(lead);
  const emailSays: Record<string, string> = {
    NONE: 'No email on file',
    INVALID: 'Bounced — don’t use',
    INFERRED: 'Guessed from a pattern — don’t use',
    NO_CONTACT: 'A support or no-reply inbox — don’t use',
    GENERIC: 'A shared inbox, not the decision-maker',
    UNSOURCED_FREEMAIL: 'A personal address with no source — check before use',
    // "Their own address" is the engine's routing judgement; the provenance is stated with it, and an unknown source
    // is spelled out rather than left to sit beside a tick (audit B1's rule applied to contacts).
    DIRECT: `Their own address · ${(PROVENANCE_LABELS[lead.email_status]?.usable ? PROVENANCE_LABELS[lead.email_status].label : `${PROVENANCE_LABELS[lead.email_status]?.label ?? lead.email_status}, so check it before relying on it`)}`,
  };
  const phone = phoneEligibility(lead);
  const wa = whatsappEligibility(lead);
  const routes: RouteLine[] = [
    { channel: 'Email', value: contacts.email.present ? (contacts.email.visible ? contacts.email.value : contacts.email.masked) : null, usable: row.contactability.emailable, says: emailSays[route.quality] ?? route.detail, source: scrub(contacts.email.source) },
    {
      channel: 'Phone',
      value: contacts.phone.present ? (contacts.phone.visible ? contacts.phone.value : contacts.phone.masked) : null,
      usable: row.contactability.callable,
      says: !contacts.phone.present ? 'No phone on file' : phone.ok ? `Can call · ${PROVENANCE_LABELS[lead.phone_status]?.label}` : `Can’t call yet · ${PROVENANCE_LABELS[lead.phone_status]?.label ?? lead.phone_status}`,
      source: scrub(contacts.phone.source),
    },
    { channel: 'WhatsApp', value: null, usable: row.contactability.whatsapp, says: wa.ok ? 'Allowed — they advertise it or agreed on a call' : 'Not allowed — no confirmed number and permission', source: null },
  ];

  return {
    detail,
    status: row.status,
    block: { blocked: row.suppressed, sentence: row.suppressed ? blockSentence(row.blockReason) : null },
    claims: whyClaims(lead, detail.qualificationGates, coverage?.coverage ?? null),
    decisionMaker,
    routes,
    email: { dates, statusLabel: trackerRow ? trackerRow.status : null, queued, seesEmail, asOf: ledgerAsOf() },
    next: nextStepFor({ status: row.status, detail, queued: row.queued, dates }),
    timeline,
    evidence,
    coverage,
  };
}
