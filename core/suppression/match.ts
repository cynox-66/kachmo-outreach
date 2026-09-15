import type { KachmoLead, SuppressionEntry } from '../leads/schema.js';
import { normalizeEmail, phoneKey, normalizeDomain } from '../contact/provenance.js';

export function checkSuppression(lead: KachmoLead, entries: SuppressionEntry[]): { suppressed: boolean; reason: string | null } {
  const email = normalizeEmail(lead.decision_maker_email);
  const phones = [lead.decision_maker_phone, lead.whatsapp_number, lead.decision_maker_whatsapp].map(phoneKey).filter(Boolean);
  const domains = new Set([normalizeDomain(lead.website_url), email ? normalizeDomain(email) : null].filter(Boolean));

  for (const entry of entries) {
    const why = (k: string) => ({ suppressed: true, reason: `${k} match — ${entry.reason}` });
    if (entry.lead_id && entry.lead_id === lead.lead_id) return why('lead_id');
    if (entry.target_number && entry.target_number === lead.target_number) return why('target_number');
    if (entry.email && email && normalizeEmail(entry.email) === email) return why('email');
    const ep = phoneKey(entry.phone);
    if (ep && phones.includes(ep)) return why('phone');
    const ed = normalizeDomain(entry.domain);
    if (ed && domains.has(ed)) return why('domain');
  }
  return { suppressed: false, reason: null };
}

/** Any of these values on any status field (or the email ledger) blocks every channel. */
export const OUTREACH_BLOCKING_STATUSES: ReadonlySet<string> = new Set(['DO_NOT_CONTACT', 'OPT_OUT', 'REPLIED_NO', 'UNSUBSCRIBED']);

/**
 * The single outreach block check used by every queue and every logging path.
 * `emailLedgerStatus` is the lead's current status in OUTREACH_TRACKER.md, if known.
 * There is deliberately no parameter that can switch this check off.
 */
export function outreachBlock(
  lead: KachmoLead,
  suppression: SuppressionEntry[],
  emailLedgerStatus?: string | null
): { blocked: boolean; reason: string | null } {
  if (lead.do_not_contact) return { blocked: true, reason: lead.suppression_reason || 'do_not_contact flag set' };
  for (const [field, value] of [
    ['call_status', lead.call_status],
    ['whatsapp_outreach_status', lead.whatsapp_outreach_status],
    ['email_outreach_status', lead.email_outreach_status],
    ['response_status', lead.response_status],
    ['lead_state', lead.lead_state],
    ['OUTREACH_TRACKER.md status', emailLedgerStatus],
  ] as const) {
    if (value && OUTREACH_BLOCKING_STATUSES.has(value)) return { blocked: true, reason: `${field} is ${value}` };
  }
  const s = checkSuppression(lead, suppression);
  return { blocked: s.suppressed, reason: s.reason };
}

/** Structural problems in a parsed suppression list (already known to be an array). Empty = well-formed. */
export function suppressionEntryProblems(list: unknown[]): string[] {
  return list.flatMap((e, i) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return [`entry #${i + 1}: not an object`];
    const x = e as Record<string, unknown>;
    const hasId = ['lead_id', 'target_number', 'email', 'phone', 'domain'].some(k => typeof x[k] === 'string' && (x[k] as string).trim());
    return hasId ? [] : [`entry #${i + 1}: has no lead_id/target_number/email/phone/domain`];
  });
}

/** True when `entry` would duplicate `existing` (same lead_id, target, email, phone key or domain). */
export function isEquivalentSuppression(existing: SuppressionEntry, entry: SuppressionEntry): boolean {
  const same = (a?: string | null, b?: string | null, norm: (x?: string | null) => string | null = x => x ?? null) =>
    !!a && !!b && norm(a) === norm(b);
  return (
    same(existing.lead_id, entry.lead_id) ||
    same(existing.target_number, entry.target_number) ||
    same(existing.email, entry.email, normalizeEmail) ||
    same(existing.phone, entry.phone, phoneKey) ||
    same(existing.domain, entry.domain, normalizeDomain)
  );
}
