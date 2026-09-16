import type { Actor, KachmoLead, SuppressionEntry } from '../leads/schema.js';
import { normalizeEmail, whatsappEligibility } from '../contact/provenance.js';
import { outreachBlock } from '../suppression/match.js';
import { addDays } from '../geo/timezone.js';
import { appendNote, doNotContactPatch, eventSubject, refuse, type DomainEvent, type LeadDecision } from './decision.js';

export const WHATSAPP_STATUSES = ['APPROVED', 'REJECTED', 'SENT', 'REPLIED', 'OPT_OUT'] as const;
export type WhatsAppLogStatus = (typeof WHATSAPP_STATUSES)[number];

/** Statuses after which a draft may no longer be approved, rejected or re-sent. */
export const WHATSAPP_TERMINAL_OUTREACH: ReadonlySet<string> = new Set(['SENT', 'REPLIED']);

const EVENT_FOR_STATUS = {
  APPROVED: 'WHATSAPP_APPROVED',
  REJECTED: 'WHATSAPP_REJECTED',
  SENT: 'WHATSAPP_SENT',
  REPLIED: 'REPLY_RECEIVED',
  OPT_OUT: 'OPT_OUT',
} as const;

export interface WhatsAppLogInput {
  status: WhatsAppLogStatus;
  by: Extract<Actor, 'DEV' | 'AADI'>;
  notes?: string | null;
}

export interface WhatsAppLogContext {
  today: string;
  now: string;
  suppression: SuppressionEntry[];
  ledgerStatus: string | null;
}

/**
 * The WhatsApp state machine. It records human review and human sends; nothing here sends anything.
 *
 * The approval boundary is enforced twice on purpose: a draft must be APPROVED before SENT, and eligibility and
 * suppression are re-checked at send time, because the lead may have changed between approval and sending.
 */
export function decideWhatsAppTransition(lead: KachmoLead, input: WhatsAppLogInput, ctx: WhatsAppLogContext): LeadDecision {
  const { status, by } = input;
  const tn = lead.target_number;
  const block = outreachBlock(lead, ctx.suppression, ctx.ledgerStatus);
  const current = lead.whatsapp_outreach_status;
  const done = WHATSAPP_TERMINAL_OUTREACH.has(current ?? '');

  const patch: Partial<KachmoLead> = {};
  let suppression: SuppressionEntry | null = null;

  switch (status) {
    case 'APPROVED': {
      if (block.blocked) return refuse(`${tn} is suppressed (${block.reason}).`);
      if (done) return refuse(`${tn} WhatsApp is already ${current}.`);
      const e = whatsappEligibility(lead);
      if (!e.ok) return refuse(`${tn} is not eligible for WhatsApp: ${e.reason}`);
      patch.whatsapp_outreach_status = 'APPROVED';
      break;
    }
    case 'REJECTED':
      if (done) return refuse(`${tn} WhatsApp is already ${current}.`);
      patch.whatsapp_outreach_status = 'REJECTED';
      break;
    case 'SENT': {
      if (done) return refuse(`${tn} is already SENT; not logging a duplicate send.`);
      if (current !== 'APPROVED') return refuse(`${tn} is not APPROVED (status: ${current ?? 'none'}). A draft must be approved before it is sent.`);
      if (block.blocked) return refuse(`${tn} is suppressed (${block.reason}). Do not send.`);
      const e = whatsappEligibility(lead);
      if (!e.ok) return refuse(`${tn} is no longer eligible for WhatsApp: ${e.reason}`);
      patch.whatsapp_outreach_status = 'SENT';
      patch.last_contacted_at = ctx.now;
      patch.next_action = 'Wait for a WhatsApp reply (no second unsolicited message)';
      patch.next_action_date = addDays(ctx.today, 4);
      break;
    }
    case 'REPLIED':
      if (current !== 'SENT') return refuse(`${tn}: REPLIED requires a SENT message (status: ${current ?? 'none'}).`);
      patch.whatsapp_outreach_status = 'REPLIED';
      patch.response_status = lead.response_status ?? 'REPLIED';
      patch.next_action = 'Reply personally on WhatsApp';
      patch.next_action_date = ctx.today;
      break;
    case 'OPT_OUT': {
      const reason = `Opted out on WhatsApp ${ctx.today}`;
      patch.whatsapp_outreach_status = 'OPT_OUT';
      Object.assign(patch, doNotContactPatch(reason));
      suppression = {
        lead_id: lead.lead_id,
        target_number: tn,
        company_name: lead.company_name,
        phone: lead.decision_maker_phone ?? undefined,
        email: normalizeEmail(lead.decision_maker_email) ?? undefined,
        reason,
        suppressed_at: ctx.now,
        source: `whatsapp:log (${by})`,
      };
      break;
    }
  }

  if (input.notes) patch.notes = appendNote(lead.notes, ctx.today, `whatsapp/${by}`, input.notes);
  patch.updated_at = ctx.now;

  const events: DomainEvent[] = [
    { ...eventSubject(lead), event_type: EVENT_FOR_STATUS[status], channel: 'WHATSAPP', actor: by, payload: { status } },
  ];

  return { refusal: null, warnings: [], patch, suppression, events, summary: `${tn} ${lead.company_name}: WhatsApp ${status}` };
}
