import type { KachmoLead, SuppressionEntry } from '../leads/schema.js';
import type { ExtractedClaim } from './report.js';
import { checkSuppression, isEquivalentSuppression } from '../suppression/match.js';
import { normalizeCompanyName } from '../leads/dedupe.js';
import { normalizeDomain, normalizeEmail, phoneKey } from '../contact/provenance.js';
import { deriveEvidenceLevel, atLeast, type EvidenceLevel } from './evidence.js';

/**
 * THE CANDIDATE LEAD MODEL.
 *
 * A candidate is NOT a lead. It is a proposal that a lead should exist, carrying the claims and evidence that were
 * offered for it. It lives in its own space and can never become a canonical lead without a human saying so.
 *
 *   research report -> candidate -> normalize -> dedupe -> evidence check -> qualify -> HUMAN APPROVAL -> lead
 *
 * The human approval boundary is the point of the whole structure. Everything before it is reversible and costs
 * nothing; everything after it is a real company a real person may contact.
 */

export const CANDIDATE_STATUSES = [
  'EXTRACTED',
  'NORMALIZED',
  'DUPLICATE_SUSPECTED',
  'EVIDENCE_CHECKED',
  'QUALIFIED',
  'AWAITING_REVIEW',
  'ACCEPTED',
  'REJECTED',
  'DEFERRED',
  'MERGED',
  'SENT_BACK_FOR_RESEARCH',
  'FLAGGED_CONTRADICTION',
  'INCOMPLETE',
  'SUPPRESSED',
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/** Statuses from which nothing further happens without a new human action. */
export const TERMINAL_CANDIDATE_STATUSES: ReadonlySet<CandidateStatus> = new Set(['ACCEPTED', 'REJECTED', 'MERGED', 'SUPPRESSED']);

export const REVIEW_DECISIONS = ['ACCEPT', 'REJECT', 'DEFER', 'MERGE', 'SEND_BACK', 'FLAG_CONTRADICTION', 'MARK_INCOMPLETE'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export interface DuplicateMatch {
  /** The existing canonical lead this candidate may already be. */
  leadId: string;
  targetNumber: string;
  matchedOn: 'domain' | 'email' | 'phone' | 'company_name';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ResearchCandidate {
  candidateId: string;
  sourceReportId: string;
  extractedAt: string;
  status: CandidateStatus;
  /** Everything the report asserted about this candidate, each with its own evidence. */
  claims: ExtractedClaim[];
  /** Existing leads this candidate may duplicate. Never resolved automatically. */
  duplicateMatches: DuplicateMatch[];
  /** Suppression entries this candidate matches. A match is decisive: it can never be accepted. */
  suppressionMatches: number;
  /** Fields the methodology needs that the report did not supply. */
  missingFields: string[];
  /** Set only by a human review. */
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** When ACCEPTED, the canonical lead that was created. When MERGED, the lead it was merged into. */
  resolvedLeadId: string | null;
}

const claim = (c: ResearchCandidate, field: string): ExtractedClaim | undefined => c.claims.find(x => x.field === field);
export const claimValue = (c: ResearchCandidate, field: string): string | null => claim(c, field)?.value ?? null;

/** The strongest evidence level offered for a field. NONE when the field was not claimed at all. */
export function evidenceLevelFor(c: ResearchCandidate, field: string): EvidenceLevel {
  const found = claim(c, field);
  if (!found || !found.evidence.length) return 'NONE';
  if (found.evidence.some(e => e.level === 'CONTRADICTED')) return 'CONTRADICTED';
  return found.evidence.reduce<EvidenceLevel>((best, e) => (atLeast(e.level, best) ? e.level : best), 'NONE');
}

/**
 * Fields a candidate must carry before it can even be offered for review. Deliberately the minimum needed to
 * identify a company and reach a named person — not the full qualification set, which the engine decides.
 */
export const REQUIRED_CANDIDATE_FIELDS = ['company_name', 'website_url', 'location_country', 'archetype_id', 'decision_maker_name'] as const;

/** Finds existing leads this candidate may already be. Reports matches; never merges, never deduplicates. */
export function findDuplicateMatches(c: ResearchCandidate, existing: KachmoLead[]): DuplicateMatch[] {
  const domain = normalizeDomain(claimValue(c, 'website_url'));
  const email = normalizeEmail(claimValue(c, 'decision_maker_email'));
  const phone = phoneKey(claimValue(c, 'decision_maker_phone'));
  const name = claimValue(c, 'company_name');
  const nameKey = name ? normalizeCompanyName(name) : null;

  const matches: DuplicateMatch[] = [];
  for (const l of existing) {
    const push = (matchedOn: DuplicateMatch['matchedOn'], confidence: DuplicateMatch['confidence']) =>
      matches.push({ leadId: l.lead_id, targetNumber: l.target_number, matchedOn, confidence });
    if (domain && normalizeDomain(l.website_url) === domain) push('domain', 'HIGH');
    else if (email && normalizeEmail(l.decision_maker_email) === email) push('email', 'HIGH');
    else if (phone && phoneKey(l.decision_maker_phone) === phone) push('phone', 'MEDIUM');
    else if (nameKey && normalizeCompanyName(l.company_name) === nameKey) push('company_name', 'LOW');
  }
  return matches;
}

/** Suppression entries this candidate matches, checked on every identifier the report offered. */
export function findSuppressionMatches(c: ResearchCandidate, suppression: SuppressionEntry[]): SuppressionEntry[] {
  const probe = {
    lead_id: '',
    target_number: '',
    company_name: claimValue(c, 'company_name') ?? '',
    website_url: claimValue(c, 'website_url') ?? '',
    decision_maker_email: claimValue(c, 'decision_maker_email'),
    decision_maker_phone: claimValue(c, 'decision_maker_phone'),
    do_not_contact: false,
  } as unknown as KachmoLead;
  return suppression.filter(e => checkSuppression(probe, [e]).suppressed);
}

export interface CandidateAssessment {
  status: CandidateStatus;
  missingFields: string[];
  duplicateMatches: DuplicateMatch[];
  suppressionMatches: SuppressionEntry[];
  contradictedFields: string[];
  /** Why the candidate is in this status, in one line a reviewer can act on. */
  reason: string;
  /** What the reviewer should probably do. A recommendation only: the decision is always theirs. */
  recommendedDecision: ReviewDecision;
}

/**
 * Assesses a candidate and says where it stands. It never changes the candidate and never approves anything.
 *
 * Order matters and is fail-closed: suppression beats everything (someone who opted out must not be re-added under
 * a new lead), then contradictions, then duplicates, then completeness. The most serious reason a candidate cannot
 * proceed is the one reported.
 */
export function assessCandidate(c: ResearchCandidate, existing: KachmoLead[], suppression: SuppressionEntry[]): CandidateAssessment {
  const suppressionMatches = findSuppressionMatches(c, suppression);
  const duplicateMatches = findDuplicateMatches(c, existing);
  const contradictedFields = c.claims.filter(x => x.evidence.some(e => e.level === 'CONTRADICTED')).map(x => x.field);
  const missingFields = REQUIRED_CANDIDATE_FIELDS.filter(f => !claimValue(c, f));

  if (suppressionMatches.length) {
    return {
      status: 'SUPPRESSED',
      missingFields,
      duplicateMatches,
      suppressionMatches,
      contradictedFields,
      reason: `matches ${suppressionMatches.length} suppression entr(y/ies); this company or person has already asked not to be contacted`,
      recommendedDecision: 'REJECT',
    };
  }
  if (contradictedFields.length) {
    return {
      status: 'FLAGGED_CONTRADICTION',
      missingFields,
      duplicateMatches,
      suppressionMatches,
      contradictedFields,
      reason: `the source contradicts the report's own claim about ${contradictedFields.join(', ')}`,
      recommendedDecision: 'FLAG_CONTRADICTION',
    };
  }
  if (duplicateMatches.some(d => d.confidence === 'HIGH')) {
    const d = duplicateMatches.find(x => x.confidence === 'HIGH')!;
    return {
      status: 'DUPLICATE_SUSPECTED',
      missingFields,
      duplicateMatches,
      suppressionMatches,
      contradictedFields,
      reason: `already in the database as ${d.targetNumber} (same ${d.matchedOn})`,
      recommendedDecision: 'MERGE',
    };
  }
  if (missingFields.length) {
    return {
      status: 'INCOMPLETE',
      missingFields,
      duplicateMatches,
      suppressionMatches,
      contradictedFields,
      reason: `the report did not supply ${missingFields.join(', ')}`,
      recommendedDecision: 'SEND_BACK',
    };
  }
  return {
    status: 'AWAITING_REVIEW',
    missingFields,
    duplicateMatches,
    suppressionMatches,
    contradictedFields,
    reason: duplicateMatches.length ? `complete, with ${duplicateMatches.length} weak duplicate match(es) to check` : 'complete and ready for review',
    recommendedDecision: 'ACCEPT',
  };
}

export interface ApprovalRefusal {
  code: 'NOT_A_HUMAN' | 'SUPPRESSED' | 'ALREADY_RESOLVED' | 'INCOMPLETE' | 'CONTRADICTED' | 'UNRESOLVED_DUPLICATE' | 'NO_EVIDENCE';
  message: string;
}

/**
 * THE HUMAN APPROVAL BOUNDARY.
 *
 * The only function in the system that can say a candidate may become a canonical lead — and it refuses unless a
 * named human is doing it, the candidate is not suppressed, not contradicted, not incomplete, not an unresolved
 * duplicate, and at least one of its claims carries evidence beyond "somebody said so".
 *
 * There is no automatic path. There is no bulk override. `reviewer` cannot be a system identity.
 */
export function approvalRefusal(c: ResearchCandidate, assessment: CandidateAssessment, reviewer: string): ApprovalRefusal | null {
  const r = (reviewer ?? '').trim();
  if (!r || r === 'SYSTEM' || r === 'LLM' || /^(bot|agent|auto)/i.test(r)) {
    return { code: 'NOT_A_HUMAN', message: 'a candidate becomes a lead only when a named human approves it; automated identities are never accepted' };
  }
  if (TERMINAL_CANDIDATE_STATUSES.has(c.status)) {
    return { code: 'ALREADY_RESOLVED', message: `this candidate is already ${c.status}` };
  }
  if (assessment.suppressionMatches.length) {
    return { code: 'SUPPRESSED', message: 'the candidate matches a suppression entry and can never be accepted, by anyone' };
  }
  if (assessment.contradictedFields.length) {
    return { code: 'CONTRADICTED', message: `the source contradicts ${assessment.contradictedFields.join(', ')}; resolve the contradiction before accepting` };
  }
  if (assessment.missingFields.length) {
    return { code: 'INCOMPLETE', message: `missing ${assessment.missingFields.join(', ')}` };
  }
  if (assessment.duplicateMatches.some(d => d.confidence === 'HIGH')) {
    return { code: 'UNRESOLVED_DUPLICATE', message: 'the candidate matches an existing lead; merge it or explicitly dismiss the match first' };
  }
  const anyEvidence = c.claims.some(x => x.evidence.some(e => atLeast(e.level, 'URL_SHAPED')));
  if (!anyEvidence) {
    return { code: 'NO_EVIDENCE', message: 'no claim on this candidate offers even a URL; a lead is never created from assertions alone' };
  }
  return null;
}

/** Recomputes every evidence level from the facts each record carries, so asserted levels cannot survive import. */
export function withDerivedEvidence(c: ResearchCandidate): ResearchCandidate {
  return {
    ...c,
    claims: c.claims.map(x => ({
      ...x,
      evidence: x.evidence.map(e => ({ ...e, level: deriveEvidenceLevel(e).level })),
    })),
  };
}

/** Whether two candidates from the same batch describe the same company. Used to dedupe within one report. */
export function sameCandidate(a: ResearchCandidate, b: ResearchCandidate): boolean {
  const domainA = normalizeDomain(claimValue(a, 'website_url'));
  const domainB = normalizeDomain(claimValue(b, 'website_url'));
  if (domainA && domainB) return domainA === domainB;
  const nameA = claimValue(a, 'company_name');
  const nameB = claimValue(b, 'company_name');
  return !!nameA && !!nameB && normalizeCompanyName(nameA) === normalizeCompanyName(nameB);
}

/** Re-exported so callers deduplicating suppression entries use the one definition. */
export { isEquivalentSuppression };
