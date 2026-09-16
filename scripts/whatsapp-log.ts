import { loadLeads, loadSuppression, findLead, paths } from './lib/store.js';
import { applyDecision } from './lib/apply.js';
import { parseTracker } from './lib/email-state.js';
import { todayIst } from './lib/geo.js';
import { parseArgs, str, oneOf, fail, runCli } from './lib/cli.js';
import { generateWhatsAppQueue } from './queue-whatsapp.js';
import { decideWhatsAppTransition, WHATSAPP_STATUSES } from '../core/state/whatsapp.js';

// The WhatsApp state machine lives in core/state/whatsapp.ts. Re-exported for existing callers.
export { decideWhatsAppTransition, WHATSAPP_STATUSES, WHATSAPP_TERMINAL_OUTREACH } from '../core/state/whatsapp.js';

const USAGE = `Usage: npm run whatsapp:log -- --lead=<target|lead_id> --status=<${WHATSAPP_STATUSES.join('|')}> [--by=DEV|AADI] [--notes="..."]`;

/** Records human review and human sends. This never sends anything. */
export function logWhatsApp(argv: string[]): void {
  const args = parseArgs(argv, ['lead', 'status', 'by', 'notes']);
  const ident = str(args, 'lead');
  const status = oneOf(str(args, 'status'), WHATSAPP_STATUSES, 'status');
  if (!ident || !status) fail(USAGE);
  const by = oneOf(str(args, 'by') ?? 'AADI', ['DEV', 'AADI'] as const, 'by')!;

  const leads = loadLeads();
  const lead = findLead(leads, ident);
  if (!lead) fail(`No lead matches --lead=${ident}.`);

  const decision = decideWhatsAppTransition(
    lead,
    { status, by, notes: str(args, 'notes') ?? null },
    {
      today: todayIst(),
      now: new Date().toISOString(),
      suppression: loadSuppression(),
      ledgerStatus: parseTracker(paths().tracker).get(lead.target_number)?.status ?? null,
    }
  );

  applyDecision(leads, lead, decision);
  console.log(`✅ ${decision.summary}`);
  generateWhatsAppQueue();
}

if (process.argv[1]?.endsWith('whatsapp-log.ts')) {
  runCli(() => logWhatsApp(process.argv.slice(2)));
}
