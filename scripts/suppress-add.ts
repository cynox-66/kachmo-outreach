import type { SuppressionEntry } from './lib/schema.js';
import { loadLeads, saveLeads, addSuppression, logEvent, findLead, paths } from './lib/store.js';
import { checkSuppression, normalizeEmail, normalizeDomain, phoneKey } from './lib/contact.js';
import { readScheduledQueue } from './lib/email-state.js';
import { parseArgs, str, oneOf, fail, runCli } from './lib/cli.js';

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
  const now = new Date().toISOString();
  let entry: SuppressionEntry;
  const ident = str(args, 'lead');
  if (ident) {
    const lead = findLead(leads, ident);
    if (!lead) fail(`No lead matches --lead=${ident}.`);
    entry = {
      lead_id: lead.lead_id, target_number: lead.target_number, company_name: lead.company_name,
      email: normalizeEmail(lead.decision_maker_email) ?? undefined, phone: lead.decision_maker_phone ?? undefined,
      domain: normalizeDomain(lead.website_url) ?? undefined, reason, suppressed_at: now, source: `suppress:add (${by})`,
    };
  } else {
    const email = str(args, 'email');
    const phone = str(args, 'phone');
    const domain = str(args, 'domain');
    if (!email && !phone && !domain) fail(USAGE);
    if (email && !normalizeEmail(email)) fail(`Not a valid email: ${email}`);
    if (phone && !phoneKey(phone)) fail(`Not a valid phone: ${phone}`);
    if (domain && !normalizeDomain(domain)) fail(`Not a suppressible company domain: ${domain} (freemail/platform domains are refused)`);
    entry = {
      email: email ? normalizeEmail(email)! : undefined, phone, domain: domain ? normalizeDomain(domain)! : undefined,
      reason, suppressed_at: now, source: `suppress:add (${by})`,
    };
  }

  const added = addSuppression(entry);
  const affected = leads.filter(l => checkSuppression(l, [entry]).suppressed);
  for (const l of affected) {
    l.do_not_contact = true;
    l.suppression_reason = reason;
    l.research_state = 'DISQUALIFIED';
    l.lead_priority = 'DISQUALIFIED';
    l.whatsapp_basis = null;
    l.whatsapp_basis_source = null;
    l.next_action = 'None — do not contact';
    l.next_action_date = null;
    l.updated_at = now;
  }
  if (affected.length) saveLeads(leads);
  for (const l of affected) {
    logEvent({ lead_id: l.lead_id, target_number: l.target_number, company_name: l.company_name, event_type: 'SUPPRESSION_ADDED', channel: 'SYSTEM', actor: by, payload: { new_entry: added } });
  }

  const affectedTns = new Set(affected.map(l => l.target_number));
  const scheduledConflicts = readScheduledQueue(paths().scheduledQueue)
    .filter(s => affectedTns.has(s.targetNumber) || (entry.email && normalizeEmail(s.to) === entry.email) || (entry.domain && normalizeDomain(s.to) === entry.domain))
    .map(s => s.targetNumber);

  console.log(`🛡️  Suppression ${added ? 'added' : 'already existed'}; ${affected.length} lead(s) flagged do_not_contact: ${[...affectedTns].join(', ') || 'none in database'}`);
  if (scheduledConflicts.length) {
    console.warn(
      `\n🚨 STILL IN THE PRODUCTION EMAIL QUEUE: ${scheduledConflicts.join(', ')}\n` +
        `   scheduled-queue.json is sent by the GitHub Actions cron, which does not read V2 suppression.\n` +
        `   Remove these entries from scheduled-queue.json on origin/main before the next cron run.`
    );
  }
  return { added, affected: [...affectedTns], scheduledConflicts };
}

if (process.argv[1]?.endsWith('suppress-add.ts')) {
  runCli(() => {
    suppressContact(process.argv.slice(2));
  });
}
