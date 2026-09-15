import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { safeWriteJson } from './lib/safe-io.js';
import type { WhatsAppQueueItem } from './lib/schema.js';
import { loadLeads, loadSuppression, paths } from './lib/store.js';
import { parseTracker } from './lib/email-state.js';
import { runCli } from './lib/cli.js';
import { selectWhatsAppQueue, waLinkDigits } from '../core/queues/whatsapp.js';

/**
 * WhatsApp is draft → human review → human send. Nothing in this repository sends WhatsApp messages.
 * Eligibility, drafts and queue selection live in core/queues/whatsapp.ts.
 */
export { buildWhatsAppDraft, waLinkDigits } from '../core/queues/whatsapp.js';

export function generateWhatsAppQueue(): { total: number; items: WhatsAppQueueItem[]; excluded: Array<{ target_number: string; company: string; reason: string }> } {
  const p = paths();
  const leads = loadLeads();
  const suppression = loadSuppression();
  const tracker = parseTracker(p.tracker);
  const byTn = new Map(leads.map(l => [l.target_number, l]));

  const { items, excluded } = selectWhatsAppQueue(leads, suppression, tn => tracker.get(tn)?.status ?? null);

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
