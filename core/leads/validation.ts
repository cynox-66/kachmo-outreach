import type { KachmoLead } from './schema.js';

export const PROVENANCE_VALUES: ReadonlySet<string> = new Set(['UNKNOWN', 'INFERRED', 'UNVERIFIED', 'PUBLICLY_LISTED', 'VERIFIED', 'INVALID']);
export const RESEARCH_STATE_VALUES: ReadonlySet<string> = new Set(['DISCOVERED', 'QUALIFICATION_PENDING', 'RESEARCH_REQUIRED', 'ENRICHED', 'QUALIFIED', 'DISQUALIFIED', 'OUTREACH_READY']);

/** Structural problems with one stored lead record. Never repairs, never substitutes defaults. */
export function leadRecordProblems(l: any, i: number): string[] {
  const at = `record #${i + 1}${l?.target_number ? ` (${l.target_number})` : ''}`;
  if (!l || typeof l !== 'object' || Array.isArray(l)) return [`${at}: not an object`];
  const out: string[] = [];
  for (const f of ['lead_id', 'target_number', 'company_name', 'lead_state']) {
    if (typeof l[f] !== 'string' || !l[f].trim()) out.push(`${at}: missing ${f}`);
  }
  if (!RESEARCH_STATE_VALUES.has(l.research_state)) out.push(`${at}: invalid research_state ${JSON.stringify(l.research_state)}`);
  for (const f of ['phone_status', 'email_status']) if (!PROVENANCE_VALUES.has(l[f])) out.push(`${at}: invalid ${f} ${JSON.stringify(l[f])}`);
  for (const f of ['missing_intelligence', 'research_sources']) if (!Array.isArray(l[f])) out.push(`${at}: ${f} must be an array`);
  return out;
}

/** The first duplicate identity (target_number, then lead_id, in record order), or null. */
export function duplicateLeadIdentity(leads: KachmoLead[]): string | null {
  const seenTn = new Set<string>();
  const seenId = new Set<string>();
  for (const l of leads) {
    if (seenTn.has(l.target_number)) return `Duplicate target_number ${l.target_number} in lead database.`;
    if (seenId.has(l.lead_id)) return `Duplicate lead_id ${l.lead_id} in lead database.`;
    seenTn.add(l.target_number);
    seenId.add(l.lead_id);
  }
  return null;
}

export type LeadDatabaseValidation =
  | { ok: true; leads: KachmoLead[] }
  | { ok: false; kind: 'NOT_ARRAY' | 'MALFORMED' | 'DUPLICATE'; problems: string[] };

/** Validates a parsed lead database in the same order the JSON store always has: shape → records → identities. */
export function validateLeadDatabase(parsed: unknown): LeadDatabaseValidation {
  if (!Array.isArray(parsed)) return { ok: false, kind: 'NOT_ARRAY', problems: [] };
  const problems = parsed.flatMap(leadRecordProblems);
  if (problems.length) return { ok: false, kind: 'MALFORMED', problems };
  const dup = duplicateLeadIdentity(parsed as KachmoLead[]);
  if (dup) return { ok: false, kind: 'DUPLICATE', problems: [dup] };
  return { ok: true, leads: parsed as KachmoLead[] };
}
