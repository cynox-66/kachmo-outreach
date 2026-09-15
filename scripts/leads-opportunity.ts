import type { ChannelType } from './lib/schema.js';
import { loadLeads, saveLeads, loadSuppression, paths } from './lib/store.js';
import { phoneEligibility, emailRoute, whatsappEligibility, outreachBlock } from './lib/contact.js';
import { parseTracker, EMAIL_SENT_STATUSES } from './lib/email-state.js';
import { runCli } from './lib/cli.js';

/** Archetype defaults. Deliberately labelled as defaults: the real scope comes from a conversation. */
const SCOPE_BY_ARCHETYPE: Record<string, { description: string; scope: string }> = {
  '1': { description: 'White-label front-end / motion engineering on the agency’s client projects', scope: 'Per-project build partner (white-label, NDA)' },
  '2': { description: 'Marketing-site or first-screen rebuild that explains the product faster', scope: 'Landing page / marketing site rebuild' },
  '3': { description: 'Interactive layer (motion, 3D, storytelling) on an existing brand or product site', scope: 'Interactive landing page / digital flagship' },
  '4': { description: 'Website rebuild around the booking / enquiry flow of a high-ticket service business', scope: 'Website rebuild with booking/enquiry flow' },
  '5': { description: 'First own website for a business currently trading through directories', scope: 'Small first website' },
  '6': { description: 'Premium website rebuild with enquiry/booking routing for an established Indian business', scope: 'Website rebuild (optionally with an interactive showcase)' },
};

export function evaluateOpportunities(): { ready: number; blocked: number } {
  const leads = loadLeads();
  const suppression = loadSuppression();
  const tracker = parseTracker(paths().tracker);
  let ready = 0;
  let blocked = 0;

  for (const lead of leads) {
    const ledger = tracker.get(lead.target_number);
    const block = outreachBlock(lead, suppression, ledger?.status ?? null);
    if (block.blocked) {
      lead.research_state = 'DISQUALIFIED';
      lead.lead_priority = 'DISQUALIFIED';
      lead.suppression_reason = block.reason;
      lead.recommended_channel = null;
      lead.secondary_channel = null;
      lead.channel_reason = `Blocked: ${block.reason}`;
      lead.next_action = 'None — do not contact';
      lead.next_action_date = null;
      blocked++;
      continue;
    }
    if (lead.research_state === 'DISQUALIFIED') continue;

    const isIndia = lead.location_country.toLowerCase() === 'india';
    const scope = SCOPE_BY_ARCHETYPE[lead.archetype_id];
    lead.opportunity_description = scope?.description ?? null;
    lead.recommended_scope = scope?.scope ?? null;
    if (lead.archetype_id === '5') {
      lead.estimated_project_value = null;
      lead.estimated_project_value_basis = 'Not estimated: Kachmo’s standard sprint band may exceed a newly-incorporated micro business’s budget (unverified).';
    } else {
      lead.estimated_project_value = isIndia ? '₹2.5L–₹5L' : '$3,000–$6,000';
      lead.estimated_project_value_basis = 'Kachmo standard sprint price band (OUTREACH_TRACKER.md rates) — NOT evidence of this prospect’s budget.';
    }
    lead.expected_value_confidence = 'LOW';

    // Channel strategy — contextual, and only over routes that are actually usable.
    const phoneOk = phoneEligibility(lead).ok;
    const email = emailRoute(lead);
    const waOk = whatsappEligibility(lead).ok;
    let primary: ChannelType | null = null;
    let secondary: ChannelType | null = null;
    let reason: string;
    if (isIndia && phoneOk) {
      primary = 'CALL';
      secondary = waOk ? 'WHATSAPP' : email.quality === 'DIRECT' ? 'EMAIL' : null;
      reason = 'Heuristic (not Kachmo data): India-based owner-led business with a sourced phone — call first; WhatsApp only with a recorded basis.';
    } else if (email.quality === 'DIRECT') {
      primary = 'EMAIL';
      secondary = phoneOk ? 'CALL' : null;
      reason = `Direct personal email on file (provenance ${lead.email_status}); send via the production Titan flow.`;
    } else if (phoneOk) {
      primary = 'CALL';
      reason = 'Sourced phone available; no direct email.';
    } else if (email.quality === 'GENERIC') {
      primary = 'EMAIL';
      reason = `Only a shared mailbox is known (${email.detail}); find a named route before relying on it.`;
    } else {
      reason = `No usable contact route (${email.detail}${lead.decision_maker_phone ? '; ' + phoneEligibility(lead).reason : ''}).`;
    }
    lead.recommended_channel = primary;
    lead.secondary_channel = secondary;
    lead.channel_reason = reason;
    lead.owner = primary === 'CALL' || isIndia ? 'AADI' : 'DEV';

    // Readiness: qualified, never touched on any channel, and a usable route for the primary channel.
    const touched =
      (ledger && ledger.status && ledger.status !== 'PENDING') ||
      lead.lead_state !== 'DISCOVERED' ||
      (lead.call_attempts?.length ?? 0) > 0 ||
      !!lead.whatsapp_outreach_status ||
      !!lead.response_status;
    const routeOk = primary === 'CALL' ? phoneOk : primary === 'EMAIL' ? email.quality === 'DIRECT' : false;
    if ((lead.research_state === 'QUALIFIED' || lead.research_state === 'OUTREACH_READY')) {
      lead.research_state = !touched && routeOk ? 'OUTREACH_READY' : 'QUALIFIED';
    }
    if (lead.research_state === 'OUTREACH_READY') ready++;

    const humanOwned = (lead.call_attempts?.length ?? 0) > 0 || lead.meeting_status || lead.proposal_status || lead.deal_stage || lead.response_status || lead.whatsapp_outreach_status;
    if (!humanOwned) {
      const status = ledger?.status ?? '';
      if (status === 'SCHEDULED') lead.next_action = 'Scheduled in production email queue (GitHub Actions cron)';
      else if (status === 'DRAFTED') lead.next_action = 'Drafted in Titan — Dev to review and send';
      else if (EMAIL_SENT_STATUSES.has(status)) lead.next_action = 'Watch Titan inbox; follow up on the OUTREACH_TRACKER.md due date';
      else if (lead.research_state === 'OUTREACH_READY') lead.next_action = primary === 'CALL' ? 'Aadi: call (AADI_DAILY_CALLS.md)' : 'Dev: write a personalised email via the Titan flow';
      else if (lead.research_state === 'RESEARCH_REQUIRED') lead.next_action = `Research: ${lead.missing_intelligence[0] ?? 'see RESEARCH_QUEUE.md'}`;
      else lead.next_action = routeOk ? 'Review before outreach' : 'Find a direct, sourced contact route';
    }
  }

  saveLeads(leads);
  console.log(`\n💼 Opportunity & Channel Strategy:`);
  console.log(`- Leads analysed: ${leads.length}`);
  console.log(`- OUTREACH_READY (qualified, untouched, usable route): ${ready}`);
  console.log(`- Blocked by suppression / opt-out: ${blocked}`);
  return { ready, blocked };
}

if (process.argv[1]?.endsWith('leads-opportunity.ts')) {
  runCli(() => {
    evaluateOpportunities();
  });
}
