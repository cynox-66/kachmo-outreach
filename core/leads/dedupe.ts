import type { KachmoLead } from './schema.js';
import { normalizeDomain, normalizeEmail, classifyEmail, phoneKey } from '../contact/provenance.js';

/** Strips accents and legal suffixes only. Words like "studio" or "design" are part of the name. */
export function normalizeCompanyName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(ltd|limited|inc|llc|llp|pvt|private|gmbh|plc|co)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export interface DuplicateFinding {
  target_number: string;
  company: string;
  duplicate_of: string;
  reason: string;
}

/**
 * Possible duplicates for human review. Shared mailboxes (info@, hello@) are ignored, and two people at
 * the same company are flagged rather than merged: a domain match means "check", never "delete".
 */
export function findDuplicates(leads: KachmoLead[]): DuplicateFinding[] {
  const seen = new Map<string, string>();
  const out: DuplicateFinding[] = [];
  for (const l of [...leads].sort((a, b) => a.target_number.localeCompare(b.target_number))) {
    const name = normalizeCompanyName(l.company_name);
    const keys: Array<[string, string | null]> = [
      ['domain', normalizeDomain(l.website_url)],
      ['email', classifyEmail(l.decision_maker_email) === 'PERSONAL' ? normalizeEmail(l.decision_maker_email) : null],
      ['phone', phoneKey(l.decision_maker_phone)],
      ['linkedin', l.decision_maker_linkedin ? l.decision_maker_linkedin.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '') : null],
      ['company name', name.length >= 4 ? name : null],
    ];
    const hit = keys.find(([k, v]) => v && seen.has(`${k}:${v}`));
    if (hit) out.push({ target_number: l.target_number, company: l.company_name, duplicate_of: seen.get(`${hit[0]}:${hit[1]}`)!, reason: `same ${hit[0]} (${hit[1]})` });
    for (const [k, v] of keys) if (v && !seen.has(`${k}:${v}`)) seen.set(`${k}:${v}`, l.target_number);
  }
  return out;
}
