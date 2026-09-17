import type { ContactProvenance, KachmoLead, ResearchSource } from '../leads/schema.js';
import { leadFromCsvRow } from '../leads/csv.js';
import { claimValue, evidenceLevelFor, REQUIRED_CANDIDATE_FIELDS, type ResearchCandidate } from './candidate.js';

/**
 * CANDIDATE → CANONICAL LEAD.
 *
 * The last step of the research pipeline, and the only place a researched candidate becomes a lead the outreach
 * engine can act on. Pure and deterministic, so what gets written is decided by testable rules rather than by
 * whatever the caller happened to pass.
 *
 * Two rules govern everything here, and both exist to stop research becoming fabrication:
 *
 *   1. NOTHING IS INVENTED. A field the report did not claim is absent, not guessed. There are no placeholder
 *      names, no derived emails, no assumed countries.
 *   2. PROVENANCE SURVIVES. A contact is only ever as trustworthy as the evidence behind it, so contact
 *      provenance is computed from the candidate's evidence level and can never start at VERIFIED. A promoted
 *      lead therefore enters as RESEARCH_REQUIRED with unverified contacts, exactly like every migrated lead,
 *      and must earn its way through the same gates as everything else.
 *
 * Methodology v1.0 is not touched: this produces a lead in the state the methodology already understands, and the
 * existing qualification, scoring and provenance rules then apply to it unchanged.
 */

export class PromotionError extends Error {}

/**
 * Contact provenance from evidence. Deliberately conservative: RETRIEVED is the strongest an LLM-sourced claim can
 * reach (ADR-011, ADR-014), so the best a promotion can produce is PUBLICLY_LISTED, and only with a real source
 * URL behind it. VERIFIED is reserved for a human who actually verified the contact.
 */
function provenanceFor(c: ResearchCandidate, field: string): { status: ContactProvenance; source: string | null } {
  const value = claimValue(c, field);
  if (!value) return { status: 'UNKNOWN', source: null };
  const level = evidenceLevelFor(c, field);
  const source = c.claims.find(x => x.field === field)?.evidence.find(e => !!e.sourceUrl)?.sourceUrl ?? null;
  if (level === 'CONTRADICTED') return { status: 'INVALID', source };
  if (level === 'SUPPORTED' && source) return { status: 'PUBLICLY_LISTED', source };
  if (level === 'RETRIEVED' && source) return { status: 'PUBLICLY_LISTED', source };
  return { status: 'UNVERIFIED', source };
}

export interface PromotionInput {
  candidate: ResearchCandidate;
  /** Assigned by the caller from canonical state, zero-padded. Leads are identified by it forever. */
  targetNumber: string;
  leadId: string;
  /** Who approved it — recorded on the lead, not just in the audit trail. */
  approvedBy: string;
  now: string;
}

/**
 * Builds the canonical lead. Throws rather than emitting a partial lead: a lead missing a methodology-required
 * field would fail validation at the database boundary anyway, and failing here gives the reviewer the reason.
 */
export function leadFromCandidate(input: PromotionInput): KachmoLead {
  const { candidate: c, targetNumber, leadId, approvedBy, now } = input;

  const missing = REQUIRED_CANDIDATE_FIELDS.filter(f => !claimValue(c, f));
  if (missing.length) throw new PromotionError(`cannot promote: the candidate is missing ${missing.join(', ')}`);
  if (!/^\d{3,}$/.test(targetNumber)) throw new PromotionError(`invalid target_number ${JSON.stringify(targetNumber)}`);

  const email = provenanceFor(c, 'decision_maker_email');
  const phone = provenanceFor(c, 'decision_maker_phone');
  const archetypeId = claimValue(c, 'archetype_id')!;

  // Built through the SAME factory the CSV migration uses, so a promoted lead is structurally identical to every
  // existing one — same 133 fields, same defaults, same timezone resolution — rather than a second lead shape that
  // drifts from the first. Only what the candidate's evidence actually justifies is then overridden.
  const base = leadFromCsvRow(
    {
      target_number: targetNumber,
      company_name: claimValue(c, 'company_name')!,
      website_url: claimValue(c, 'website_url')!,
      archetype_id: archetypeId,
      archetype_label: claimValue(c, 'archetype_label') ?? archetypeId,
      location_city: claimValue(c, 'location_city') ?? '',
      location_country: claimValue(c, 'location_country')!,
      estimated_scale: claimValue(c, 'estimated_scale') ?? '',
      decision_maker_name: claimValue(c, 'decision_maker_name')!,
      decision_maker_title: claimValue(c, 'decision_maker_title') ?? '',
      // Deliberately empty: the factory parses this to guess a contact. A promoted lead's contacts come from
      // evidence below, with their real provenance, never from string-matching a CSV cell.
      contact_route: '',
    },
    undefined,
    leadId,
    now
  );

  // One ResearchSource per piece of evidence that actually cites a URL, so the lead carries the same provenance
  // the candidate was approved on. Confidence follows the evidence level, never the extractor's own claim.
  const seen = new Set<string>();
  const research_sources: ResearchSource[] = c.claims.flatMap(x =>
    x.evidence
      .filter(e => !!e.sourceUrl)
      .filter(e => {
        const key = `${x.field}|${e.sourceUrl}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(e => ({
        source_url: e.sourceUrl,
        source_type: e.sourceType,
        source_date: e.retrievedAt,
        field_covered: x.field,
        confidence: e.level === 'SUPPORTED' ? ('HIGH' as const) : e.level === 'RETRIEVED' ? ('MEDIUM' as const) : ('LOW' as const),
      }))
  );

  return {
    ...base,
    decision_maker_email: claimValue(c, 'decision_maker_email'),
    decision_maker_phone: claimValue(c, 'decision_maker_phone'),
    decision_maker_source: `research candidate ${c.candidateId} (report ${c.sourceReportId}), approved by ${approvedBy}`,
    email_status: email.status,
    email_source: email.source,
    phone_status: phone.status,
    phone_source: phone.source,
    // A promoted candidate has been researched but not qualified: it enters the same funnel as everything else and
    // earns its score through the existing gates. Nothing here grants it standing it has not been assessed for.
    research_state: 'RESEARCH_REQUIRED',
    research_completeness_score: 0,
    lead_priority: null,
    priority_confidence: null,
    kachmo_score: null,
    missing_intelligence: [...c.missingFields],
    research_sources,
    created_at: now,
    updated_at: now,
  };
}

/** The next free target number, zero-padded to the existing width. Deterministic and gap-free at the top. */
export function nextTargetNumber(existing: readonly string[]): string {
  const width = existing.reduce((w, t) => Math.max(w, t.length), 3);
  const max = existing.reduce((m, t) => (/^\d+$/.test(t) ? Math.max(m, Number(t)) : m), 0);
  return String(max + 1).padStart(width, '0');
}
