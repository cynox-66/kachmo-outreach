import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { safeWriteJson } from './lib/safe-io.js';
import type { KachmoLead, WhatsAppQueueItem } from './lib/schema.js';
import { loadLeads, loadSuppression, paths } from './lib/store.js';
import { whatsappEligibility, outreachBlock } from './lib/contact.js';
import { parseTracker } from './lib/email-state.js';
import { short, greetName, lowerFirst, wordCount } from './lib/text.js';
import { runCli } from './lib/cli.js';

/**
 * WhatsApp is draft → human review → human send. Nothing in this repository sends WhatsApp messages.
 * A lead appears here only with a sourced/verified phone AND a recorded WhatsApp basis.
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

export function generateWhatsAppQueue(): { total: number; items: WhatsAppQueueItem[]; excluded: Array<{ target_number: string; company: string; reason: string }> } {
  const p = paths();
  const leads = loadLeads();
  const suppression = loadSuppression();
  const tracker = parseTracker(p.tracker);

  const items: WhatsAppQueueItem[] = [];
  const excluded: Array<{ target_number: string; company: string; reason: string }> = [];
  const byTn = new Map(leads.map(l => [l.target_number, l]));

  for (const lead of leads) {
    const skip = (reason: string) => lead.decision_maker_phone && excluded.push({ target_number: lead.target_number, company: lead.company_name, reason });
    if (lead.research_state === 'DISQUALIFIED') { skip('disqualified'); continue; }
    const block = outreachBlock(lead, suppression, tracker.get(lead.target_number)?.status ?? null);
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

  const generatedAt = new Date().toISOString();
  safeWriteJson(p.whatsappQueue, { generated_at: generatedAt, items, excluded });

  const md: string[] = [
    '# WhatsApp Review Queue',
    '',
    `> Generated ${generatedAt}. **Human review and human send only.** Nothing here is sent automatically.`,
    '> Listed only when the phone is sourced/verified AND there is a WhatsApp basis (business advertises WhatsApp, or permission given on a call).',
    '> Edit the draft freely before sending. A chat link appears only after approval.',
    '',
  ];
  if (!items.length) md.push('**Nothing to review.** Normal path: Aadi calls, asks "can I WhatsApp you the idea?", and logs `--whatsapp-ok`.', '');
  for (const i of items) {
    const lead = byTn.get(i.target_number)!;
    md.push(
      `## ${i.target_number} · ${i.company_name}: ${i.decision_maker_name}`,
      `\`${i.whatsapp_number}\` · basis: ${i.whatsapp_basis} · ${i.word_count} words · **${i.status}**`,
      '',
      '```text',
      i.message_draft,
      '```',
      ''
    );
    if (i.status === 'APPROVED') {
      md.push(
        `**Link generated ${generatedAt.slice(0, 10)}. If today is later, regenerate (\`npm run queue:whatsapp\`) before sending.**`,
        `[Open chat with this draft](https://wa.me/${waLinkDigits(i.whatsapp_number, lead.location_country)}?text=${encodeURIComponent(i.message_draft)}): send it yourself, then:`,
        `\`npm run whatsapp:log -- --lead=${i.target_number} --status=SENT --by=AADI\``
      );
    } else {
      md.push(
        `Approve: \`npm run whatsapp:log -- --lead=${i.target_number} --status=APPROVED --by=DEV\` · Reject: \`--status=REJECTED\``
      );
    }
    md.push('', '---', '');
  }
  writeFileSync(resolve(process.cwd(), 'WHATSAPP_QUEUE.md'), md.join('\n'), 'utf-8');

  console.log(`\n💬 WhatsApp review queue: ${items.length} (${items.filter(i => i.status === 'APPROVED').length} approved) → WHATSAPP_QUEUE.md`);
  return { total: items.length, items, excluded };
}

if (process.argv[1]?.endsWith('queue-whatsapp.ts')) {
  runCli(() => {
    generateWhatsAppQueue();
  });
}
