import type { Actor, KachmoLead, SuppressionEntry } from '../leads/schema.js';
import { normalizeDomain, normalizeEmail, phoneKey } from '../contact/provenance.js';
import { checkSuppression } from '../suppression/match.js';
import { doNotContactPatch, type DomainEvent } from './decision.js';

export interface SuppressionRequest {
  reason: string;
  by: Extract<Actor, 'DEV' | 'AADI'>;
  /** Suppress a known lead and every identifier on it. */
  lead?: KachmoLead | null;
  /** Or suppress a bare identifier. At least one must be given when `lead` is absent. */
  email?: string | null;
  phone?: string | null;
  domain?: string | null;
}

export interface SuppressionPlan {
  refusal: string | null;
  entry: SuppressionEntry | null;
  /** Leads in the database the new entry matches, each with the patch that flags it do-not-contact. */
  affected: Array<{ lead: KachmoLead; patch: Partial<KachmoLead> }>;
  /** Events to append — one per affected lead, only when the entry was actually inserted. */
  events: DomainEvent[];
}

/**
 * Builds the suppression entry and works out which stored leads it reaches.
 *
 * A suppression is the one operation in the system that must never be partially applied: the entry, the
 * do-not-contact flag on every matching lead and the audit events are decided here together, so a caller cannot
 * add the entry while leaving a matching lead callable.
 */
export function planSuppression(leads: KachmoLead[], req: SuppressionRequest, now: string): SuppressionPlan {
  const empty = (refusal: string): SuppressionPlan => ({ refusal, entry: null, affected: [], events: [] });
  if (!req.reason) return empty('A suppression requires --reason="..."');

  let entry: SuppressionEntry;
  if (req.lead) {
    const lead = req.lead;
    entry = {
      lead_id: lead.lead_id,
      target_number: lead.target_number,
      company_name: lead.company_name,
      email: normalizeEmail(lead.decision_maker_email) ?? undefined,
      phone: lead.decision_maker_phone ?? undefined,
      domain: normalizeDomain(lead.website_url) ?? undefined,
      reason: req.reason,
      suppressed_at: now,
      source: `suppress:add (${req.by})`,
    };
  } else {
    const { email, phone, domain } = req;
    if (!email && !phone && !domain) return empty('A suppression needs --lead, --email, --phone or --domain.');
    if (email && !normalizeEmail(email)) return empty(`Not a valid email: ${email}`);
    if (phone && !phoneKey(phone)) return empty(`Not a valid phone: ${phone}`);
    if (domain && !normalizeDomain(domain)) return empty(`Not a suppressible company domain: ${domain} (freemail/platform domains are refused)`);
    entry = {
      email: email ? normalizeEmail(email)! : undefined,
      phone: phone ?? undefined,
      domain: domain ? normalizeDomain(domain)! : undefined,
      reason: req.reason,
      suppressed_at: now,
      source: `suppress:add (${req.by})`,
    };
  }

  const affected = leads
    .filter(l => checkSuppression(l, [entry]).suppressed)
    .map(lead => ({ lead, patch: { ...doNotContactPatch(req.reason), updated_at: now } }));

  return { refusal: null, entry, affected, events: [] };
}

/**
 * Whether a production email still queued for sending is reached by a suppression.
 *
 * This is the Titan boundary check: scheduled-queue.json is dispatched by the GitHub Actions cron, which reads the
 * committed suppression list, not the hosted database. A suppression that matches a queued recipient is therefore
 * not yet effective — the caller must surface it.
 */
export function scheduledQueueConflicts(
  queued: Array<{ targetNumber: string; to: string }>,
  entry: SuppressionEntry,
  affectedTargetNumbers: ReadonlySet<string>
): string[] {
  return queued
    .filter(
      s =>
        affectedTargetNumbers.has(s.targetNumber) ||
        (!!entry.email && normalizeEmail(s.to) === entry.email) ||
        (!!entry.domain && normalizeDomain(s.to) === entry.domain)
    )
    .map(s => s.targetNumber);
}
