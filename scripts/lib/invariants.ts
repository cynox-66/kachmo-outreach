import type { KachmoLead } from './schema.js';
import { isUrl, phoneKey } from './contact.js';

/**
 * Contradictory or dangerous lead states. saveLeads() refuses to write a database containing any of these,
 * so an impossible state cannot be persisted by any script.
 */
export function findInvariantViolations(leads: KachmoLead[]): string[] {
  const v: string[] = [];
  for (const l of leads) {
    const id = `${l.target_number} ${l.company_name}`;
    for (const kind of ['phone', 'email'] as const) {
      const status = kind === 'phone' ? l.phone_status : l.email_status;
      const source = kind === 'phone' ? l.phone_source : l.email_source;
      const basis = kind === 'phone' ? l.phone_verification_basis : l.email_verification_basis;
      if (status === 'PUBLICLY_LISTED' && !isUrl(source)) v.push(`${id}: ${kind} PUBLICLY_LISTED without a source URL`);
      if (status === 'VERIFIED' && !basis?.trim()) v.push(`${id}: ${kind} VERIFIED without a verification basis`);
    }
    if ((l.call_attempts?.length ?? 0) > 0 && !phoneKey(l.decision_maker_phone)) v.push(`${id}: call attempts recorded but no phone`);
    if (l.whatsapp_basis && !phoneKey(l.decision_maker_phone)) v.push(`${id}: WhatsApp basis set but no phone`);
    if (l.whatsapp_outreach_status === 'SENT' && !l.whatsapp_basis) v.push(`${id}: WhatsApp SENT without a WhatsApp basis`);
    if (l.proposal_status === 'SENT' && !['BOOKED', 'DONE'].includes(l.meeting_status ?? '')) v.push(`${id}: proposal SENT without a meeting`);
    if (l.deal_stage === 'WON' && l.proposal_status !== 'SENT') v.push(`${id}: WON without a proposal`);
    if (l.deal_stage === 'LOST' && !l.lost_reason) v.push(`${id}: LOST without a lost_reason`);
    if (l.do_not_contact && l.research_state !== 'DISQUALIFIED') v.push(`${id}: do_not_contact but research_state is ${l.research_state}`);
    if (l.do_not_contact && l.research_state === 'DISQUALIFIED' && l.lead_priority !== 'DISQUALIFIED') v.push(`${id}: do_not_contact but priority ${l.lead_priority}`);
    if (l.research_state === 'OUTREACH_READY' && l.lead_priority === 'DISQUALIFIED') v.push(`${id}: OUTREACH_READY and DISQUALIFIED`);
  }
  return v;
}
