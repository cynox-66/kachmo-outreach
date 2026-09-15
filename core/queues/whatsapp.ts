import type { KachmoLead, SuppressionEntry, WhatsAppQueueItem } from '../leads/schema.js';
import { whatsappEligibility } from '../contact/provenance.js';
import { outreachBlock } from '../suppression/match.js';
import { short, greetName, lowerFirst, wordCount } from '../util/text.js';

/**
 * WhatsApp is draft → human review → human send. Nothing in core/ (or anywhere in this repository) sends WhatsApp
 * messages. A lead appears in the queue only with a sourced/verified phone AND a recorded WhatsApp basis.
 */
const LEAVES_QUEUE = new Set(['SENT', 'REPLIED', 'OPT_OUT', 'REJECTED']);

export function buildWhatsAppDraft(lead: KachmoLead): string {
  const greet = greetName(lead.decision_maker_name);
  const angle = lowerFirst(short(lead.kachmo_solution_angle, 18));
  if (lead.whatsapp_basis === 'PERMISSION_GIVEN_ON_CALL') {
    return `Hi ${greet}, Aadi from Kachmo Studios here. Thanks for the call earlier. As promised, the idea for ${lead.company_name} in one line: ${angle}. Happy to send a short walkthrough if useful. If it's not relevant, just say so and I won't follow up.`;
  }
  return `Hi, this is Aadi from Kachmo Studios, a small web studio in Pune. I had one specific idea for ${lead.company_name}'s website: ${angle}. Would ${greet} be open to a two-minute look? If this isn't relevant, reply STOP and we won't message again.`;
}

export function waLinkDigits(phone: string, country: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (country.toLowerCase() === 'india') {
    if (d.length === 11 && d.startsWith('0')) d = `91${d.slice(1)}`;
    if (d.length === 10) d = `91${d}`;
  }
  return d;
}

export interface WhatsAppQueueExclusion {
  target_number: string;
  company: string;
  reason: string;
}

/** The WhatsApp human-review queue. Leads with a phone that are excluded are listed with the reason. Pure. */
export function selectWhatsAppQueue(
  leads: KachmoLead[],
  suppression: SuppressionEntry[],
  ledgerStatusOf: (targetNumber: string) => string | null
): { items: WhatsAppQueueItem[]; excluded: WhatsAppQueueExclusion[] } {
  const items: WhatsAppQueueItem[] = [];
  const excluded: WhatsAppQueueExclusion[] = [];

  for (const lead of leads) {
    const skip = (reason: string) => lead.decision_maker_phone && excluded.push({ target_number: lead.target_number, company: lead.company_name, reason });
    if (lead.research_state === 'DISQUALIFIED') { skip('disqualified'); continue; }
    const block = outreachBlock(lead, suppression, ledgerStatusOf(lead.target_number));
    if (block.blocked) { skip(`suppressed: ${block.reason}`); continue; }
    if (lead.whatsapp_outreach_status && LEAVES_QUEUE.has(lead.whatsapp_outreach_status)) { skip(`WhatsApp ${lead.whatsapp_outreach_status}`); continue; }
    const wa = whatsappEligibility(lead);
    if (!wa.ok) { skip(wa.reason); continue; }

    const draft = buildWhatsAppDraft(lead);
    items.push({
      lead_id: lead.lead_id,
      target_number: lead.target_number,
      company_name: lead.company_name,
      decision_maker_name: lead.decision_maker_name,
      whatsapp_number: lead.decision_maker_phone!,
      whatsapp_basis: lead.whatsapp_basis!,
      priority: lead.lead_priority,
      kachmo_score: lead.kachmo_score,
      message_draft: draft,
      word_count: wordCount(draft),
      outreach_angle: lead.kachmo_solution_angle,
      status: lead.whatsapp_outreach_status === 'APPROVED' ? 'APPROVED' : 'PENDING_HUMAN_REVIEW',
    });
  }
  return { items, excluded };
}
