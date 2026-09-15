import type { KachmoLead } from './lib/schema.js';
import { loadLeads, saveLeads, logEvent } from './lib/store.js';
import { normalizeDomain, normalizeEmail, classifyEmail, phoneKey } from './lib/contact.js';
import { runCli } from './lib/cli.js';

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

/** Report by default. --apply only flags `possible_duplicate_of`; records are never deleted or merged. */
export function deduplicateLeads(apply = false): DuplicateFinding[] {
  const leads = loadLeads();
  const findings = findDuplicates(leads);
  console.log(`\n🔍 Duplicate check: ${leads.length} leads, ${findings.length} possible duplicate(s)`);
  for (const f of findings) console.log(`   ${f.target_number} ${f.company} ↔ ${f.duplicate_of}: ${f.reason}`);

  if (apply && findings.length) {
    for (const f of findings) {
      const l = leads.find(x => x.target_number === f.target_number)!;
      if (l.possible_duplicate_of === f.duplicate_of) continue;
      l.possible_duplicate_of = f.duplicate_of;
      l.duplicate_reason = f.reason;
      logEvent({ lead_id: l.lead_id, target_number: l.target_number, company_name: l.company_name, event_type: 'DUPLICATE_FLAGGED', channel: 'SYSTEM', actor: 'SYSTEM', payload: { duplicate_of: f.duplicate_of, reason: f.reason } });
    }
    saveLeads(leads);
    console.log('   Flagged on the lead records (nothing deleted). Resolve by hand.');
  } else if (findings.length) {
    console.log('   Report only. Re-run with --apply to flag them on the records (nothing is ever deleted).');
  }
  return findings;
}

if (process.argv[1]?.endsWith('leads-dedupe.ts')) {
  runCli(() => {
    deduplicateLeads(process.argv.includes('--apply'));
  });
}
