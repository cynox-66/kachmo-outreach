/**
 * Applies a core/ LeadDecision to the JSON store. This is the only place a decision becomes a write.
 *
 * Order matters and is fail-closed: refusals stop before anything is touched, the lead and suppression list are
 * persisted before any event is appended, and an event marked `only_if_suppression_added` is skipped when the
 * suppression list already held an equivalent entry.
 */
import type { KachmoLead } from '../../core/leads/schema.js';
import type { LeadDecision } from '../../core/state/decision.js';
import { addSuppression, logEvent, saveLeads } from './store.js';
import { fail } from './cli.js';

export function applyDecision(leads: KachmoLead[], lead: KachmoLead, decision: LeadDecision): void {
  if (decision.refusal) fail(decision.refusal);
  for (const w of decision.warnings) console.warn(`⚠️  ${w}`);

  Object.assign(lead, decision.patch);

  let suppressionAdded = false;
  if (decision.suppression) suppressionAdded = addSuppression(decision.suppression);

  saveLeads(leads);

  for (const e of decision.events) {
    const { only_if_suppression_added, ...event } = e;
    if (only_if_suppression_added && !suppressionAdded) continue;
    logEvent(event);
  }
}
