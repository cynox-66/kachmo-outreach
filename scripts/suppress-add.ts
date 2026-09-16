import { loadLeads, saveLeads, addSuppression, logEvent, findLead, paths } from './lib/store.js';
import { readScheduledQueue } from './lib/email-state.js';
import { parseArgs, str, oneOf, fail, runCli } from './lib/cli.js';
import { planSuppression, scheduledQueueConflicts } from '../core/state/suppression-propagation.js';

// Suppression propagation rules live in core/state/suppression-propagation.ts. Re-exported for existing callers.
export { planSuppression, scheduledQueueConflicts } from '../core/state/suppression-propagation.js';

const USAGE = 'Usage: npm run suppress:add -- (--lead=<target> | --email=<addr> | --phone=<number> | --domain=<domain>) --reason="..." [--by=DEV|AADI]';

/**
 * Cross-channel opt-out. Also warns when the recipient is still in the production scheduled-queue.json,
 * which the GitHub Actions cron sends from and which does NOT read V2 suppression.
 */
export function suppressContact(argv: string[]): { added: boolean; affected: string[]; scheduledConflicts: string[] } {
  const args = parseArgs(argv, ['lead', 'email', 'phone', 'domain', 'reason', 'by']);
  const reason = str(args, 'reason');
  const by = oneOf(str(args, 'by') ?? 'DEV', ['DEV', 'AADI'] as const, 'by')!;
  if (!reason) fail(USAGE);

  const leads = loadLeads();
  const ident = str(args, 'lead');
  let lead = null;
  if (ident) {
    lead = findLead(leads, ident) ?? null;
    if (!lead) fail(`No lead matches --lead=${ident}.`);
  }
  const now = new Date().toISOString();
  const plan = planSuppression(leads, { reason, by, lead, email: str(args, 'email') ?? null, phone: str(args, 'phone') ?? null, domain: str(args, 'domain') ?? null }, now);
  if (plan.refusal) fail(plan.refusal === 'A suppression needs --lead, --email, --phone or --domain.' ? USAGE : plan.refusal);

  const entry = plan.entry!;
  const added = addSuppression(entry);
  for (const { lead: l, patch } of plan.affected) Object.assign(l, patch);
  if (plan.affected.length) saveLeads(leads);
  for (const { lead: l } of plan.affected) {
    logEvent({ lead_id: l.lead_id, target_number: l.target_number, company_name: l.company_name, event_type: 'SUPPRESSION_ADDED', channel: 'SYSTEM', actor: by, payload: { new_entry: added } });
  }

  const affectedTns = new Set(plan.affected.map(a => a.lead.target_number));
  const conflicts = scheduledQueueConflicts(readScheduledQueue(paths().scheduledQueue), entry, affectedTns);

  console.log(`🛡️  Suppression ${added ? 'added' : 'already existed'}; ${plan.affected.length} lead(s) flagged do_not_contact: ${[...affectedTns].join(', ') || 'none in database'}`);
  if (conflicts.length) {
    console.warn(
      `\n🚨 STILL IN THE PRODUCTION EMAIL QUEUE: ${conflicts.join(', ')}\n` +
        `   scheduled-queue.json is sent by the GitHub Actions cron, which does not read V2 suppression.\n` +
        `   Remove these entries from scheduled-queue.json on origin/main before the next cron run.`
    );
  }
  return { added, affected: [...affectedTns], scheduledConflicts: conflicts };
}

if (process.argv[1]?.endsWith('suppress-add.ts')) {
  runCli(() => {
    suppressContact(process.argv.slice(2));
  });
}
