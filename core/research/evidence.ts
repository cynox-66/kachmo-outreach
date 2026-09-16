import { isUrl, normalizeDomain } from '../contact/provenance.js';

/**
 * THE EVIDENCE MODEL.
 *
 * The single most important distinction in this file — and the reason it exists — is that these three things are
 * NOT the same:
 *
 *   1. URL SYNTAX        "this string is shaped like a URL"
 *   2. URL REACHABILITY  "something was actually retrieved from it"
 *   3. EVIDENCE SUPPORT  "what was retrieved actually supports the claim"
 *
 * Methodology v1.0 only ever checked (1). That is recorded as a known limitation, not a bug — but it means an LLM
 * that invents a plausible-looking URL can currently produce a "sourced" claim. This model makes each level an
 * explicit, separately recorded state so that a claim can never silently inherit credibility it has not earned.
 *
 * Nothing here changes Methodology v1.0 gate semantics. `gateOutcomeFor` maps evidence onto the EXISTING five gate
 * outcomes; the new CONTRADICTED state is represented in the evidence layer and deliberately maps onto an existing
 * outcome rather than introducing a sixth one.
 */

/** How far a claim's evidence has actually been taken. Each level strictly implies the one before it. */
export const EVIDENCE_LEVELS = ['NONE', 'CLAIMED', 'URL_SHAPED', 'RETRIEVED', 'SUPPORTED', 'CONTRADICTED'] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

/**
 * NONE          no source of any kind was offered
 * CLAIMED       a source was described in prose but is not a URL ("their website", "LinkedIn")
 * URL_SHAPED    a syntactically valid http(s) URL was offered — NOTHING has been fetched. This is where
 *               Methodology v1.0 stops, and where a fabricated URL is indistinguishable from a real one.
 * RETRIEVED     the URL was fetched successfully and its content was stored/hashed. It exists.
 * SUPPORTED     a validator (human or checked extraction) confirmed the retrieved content states the claim
 * CONTRADICTED  the retrieved content contradicts the claim
 */
export const EVIDENCE_LEVEL_MEANING: Record<EvidenceLevel, string> = {
  NONE: 'no source offered',
  CLAIMED: 'a source was described but not given as a URL',
  URL_SHAPED: 'a syntactically valid URL was given; nothing has been fetched, so it may not exist',
  RETRIEVED: 'the URL was fetched successfully; the page exists but has not been read against the claim',
  SUPPORTED: 'the retrieved content was checked and states the claim',
  CONTRADICTED: 'the retrieved content was checked and contradicts the claim',
};

/** Who or what established the current level. LLM is never sufficient to reach SUPPORTED on its own. */
export const VALIDATORS = ['NONE', 'SYNTAX_CHECK', 'FETCHER', 'LLM_EXTRACTION', 'HUMAN'] as const;
export type Validator = (typeof VALIDATORS)[number];

/** Where a source came from. Used for reporting and for weighting, never to skip validation. */
export const SOURCE_TYPES = ['official_website', 'linkedin', 'google_business_profile', 'press', 'directory', 'social', 'job_board', 'companies_register', 'human_note', 'other'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export interface EvidenceRecord {
  /** The lead field or research question this evidence is about. */
  field: string;
  /** The claim being evidenced, as a short statement. Never a contact value. */
  claim: string;
  sourceUrl: string | null;
  sourceDomain: string | null;
  sourceType: SourceType;
  /** When the URL was successfully fetched. Null unless level is RETRIEVED or beyond. */
  retrievedAt: string | null;
  /** Hash of what was retrieved, so a later re-fetch can prove the page changed. */
  retrievedContentSha256: string | null;
  /** The excerpt a validator relied on. Never invented: null unless someone actually read the page. */
  supportingExcerpt: string | null;
  level: EvidenceLevel;
  validator: Validator;
  validatedAt: string | null;
  /** The id of an evidence record this one contradicts, when applicable. */
  contradictsEvidenceId: string | null;
  notes: string | null;
}

/** The maximum level a given validator is allowed to establish. This is the anti-fabrication rule. */
export const MAX_LEVEL_BY_VALIDATOR: Record<Validator, EvidenceLevel> = {
  NONE: 'CLAIMED',
  SYNTAX_CHECK: 'URL_SHAPED',
  FETCHER: 'RETRIEVED',
  /**
   * An LLM may propose that a page supports a claim, but its say-so caps at RETRIEVED: it can never be the thing
   * that moves evidence to SUPPORTED. Otherwise the model both makes the claim and certifies it.
   */
  LLM_EXTRACTION: 'RETRIEVED',
  HUMAN: 'SUPPORTED',
};

const levelIndex = (l: EvidenceLevel) => EVIDENCE_LEVELS.indexOf(l);

/** True when `a` is at least as strong as `b`. CONTRADICTED is not ordered with the rest and is never "stronger". */
export function atLeast(a: EvidenceLevel, b: EvidenceLevel): boolean {
  if (a === 'CONTRADICTED' || b === 'CONTRADICTED') return a === b;
  return levelIndex(a) >= levelIndex(b);
}

/**
 * Derives the highest level the recorded facts actually justify — never the level someone asserted.
 *
 * This is the function that makes fabrication ineffective: a record can claim SUPPORTED all it likes, but without
 * a retrieval timestamp and a supporting excerpt from a permitted validator it will not be granted.
 */
export function deriveEvidenceLevel(e: Omit<EvidenceRecord, 'level'>): { level: EvidenceLevel; reason: string } {
  if (e.contradictsEvidenceId && e.validator === 'HUMAN') return { level: 'CONTRADICTED', reason: 'a human recorded that the source contradicts the claim' };
  if (!e.sourceUrl) {
    return e.notes || e.sourceType === 'human_note'
      ? { level: 'CLAIMED', reason: 'a source was described but no URL was given' }
      : { level: 'NONE', reason: 'no source of any kind was offered' };
  }
  if (!isUrl(e.sourceUrl)) return { level: 'CLAIMED', reason: 'the source is not a syntactically valid http(s) URL' };
  if (!e.retrievedAt || !e.retrievedContentSha256) {
    return { level: 'URL_SHAPED', reason: 'the URL is well formed but nothing has been fetched from it, so it may not exist' };
  }
  if (!e.supportingExcerpt) return { level: 'RETRIEVED', reason: 'the page was fetched but nobody has checked that it states the claim' };
  const cap = MAX_LEVEL_BY_VALIDATOR[e.validator];
  if (!atLeast(cap, 'SUPPORTED')) {
    return { level: 'RETRIEVED', reason: `a ${e.validator} validator cannot establish support; a human must confirm the excerpt states the claim` };
  }
  return { level: 'SUPPORTED', reason: 'a human confirmed the retrieved content states the claim' };
}

export interface EvidenceProblem {
  code: 'FABRICATED_LEVEL' | 'EXCERPT_WITHOUT_RETRIEVAL' | 'RETRIEVAL_WITHOUT_URL' | 'VALIDATOR_OVERREACH' | 'CONTRADICTION_WITHOUT_TARGET' | 'OVERSIZED';
  message: string;
}

export const MAX_CLAIM_LENGTH = 500;
export const MAX_EXCERPT_LENGTH = 2000;
export const MAX_NOTES_LENGTH = 2000;

/**
 * Rejects an evidence record whose asserted level is not backed by the facts it carries.
 *
 * Fail-closed by design: the caller should store the DERIVED level, and these problems exist so that an attempt to
 * assert a higher one is visible rather than quietly downgraded.
 */
export function evidenceProblems(e: EvidenceRecord): EvidenceProblem[] {
  const problems: EvidenceProblem[] = [];
  const derived = deriveEvidenceLevel(e);

  if (e.claim.length > MAX_CLAIM_LENGTH) problems.push({ code: 'OVERSIZED', message: `claim exceeds ${MAX_CLAIM_LENGTH} characters` });
  if ((e.supportingExcerpt?.length ?? 0) > MAX_EXCERPT_LENGTH) problems.push({ code: 'OVERSIZED', message: `supporting excerpt exceeds ${MAX_EXCERPT_LENGTH} characters` });
  if ((e.notes?.length ?? 0) > MAX_NOTES_LENGTH) problems.push({ code: 'OVERSIZED', message: `notes exceed ${MAX_NOTES_LENGTH} characters` });

  if (!atLeast(derived.level, e.level) && e.level !== derived.level) {
    problems.push({ code: 'FABRICATED_LEVEL', message: `record asserts ${e.level} but the facts it carries only justify ${derived.level}: ${derived.reason}` });
  }
  if (e.supportingExcerpt && !e.retrievedAt) {
    problems.push({ code: 'EXCERPT_WITHOUT_RETRIEVAL', message: 'a supporting excerpt exists but nothing was ever retrieved; an excerpt cannot predate its source' });
  }
  if ((e.retrievedAt || e.retrievedContentSha256) && !e.sourceUrl) {
    problems.push({ code: 'RETRIEVAL_WITHOUT_URL', message: 'a retrieval was recorded without a URL to retrieve from' });
  }
  if (!atLeast(MAX_LEVEL_BY_VALIDATOR[e.validator], e.level) && e.level !== 'CONTRADICTED') {
    problems.push({ code: 'VALIDATOR_OVERREACH', message: `a ${e.validator} validator may establish at most ${MAX_LEVEL_BY_VALIDATOR[e.validator]}, not ${e.level}` });
  }
  if (e.level === 'CONTRADICTED' && !e.contradictsEvidenceId) {
    problems.push({ code: 'CONTRADICTION_WITHOUT_TARGET', message: 'a contradiction must name the evidence it contradicts' });
  }
  return problems;
}

/** Builds a record with the level the facts justify, so a caller cannot construct an over-claimed one. */
export function recordEvidence(input: Omit<EvidenceRecord, 'level' | 'sourceDomain'>): EvidenceRecord {
  const sourceDomain = input.sourceUrl ? normalizeDomain(input.sourceUrl) : null;
  const { level } = deriveEvidenceLevel({ ...input, sourceDomain });
  return { ...input, sourceDomain, level };
}

/**
 * Maps evidence onto the EXISTING Methodology v1.0 gate outcomes.
 *
 * Deliberately conservative and deliberately unchanged in effect: URL_SHAPED maps to PASS because that is what
 * v1.0 does today, and changing it would alter the qualification of the 120 live leads. RETRIEVED and SUPPORTED
 * also map to PASS — they are strictly stronger. CONTRADICTED maps to FAIL, which is the one case where the new
 * model can say something v1.0 could not, and it is the safe direction: it can only ever disqualify.
 *
 * Raising the bar so that URL_SHAPED no longer passes is a METHODOLOGY CHANGE. It is not made here. When it is
 * proposed, `strictGateOutcomeFor` below is what it would look like, and the golden baseline would have to be
 * re-approved.
 */
export function gateOutcomeFor(level: EvidenceLevel): 'PASS' | 'UNVERIFIED' | 'PENDING' | 'UNKNOWN' | 'FAIL' {
  switch (level) {
    case 'SUPPORTED':
    case 'RETRIEVED':
    case 'URL_SHAPED':
      return 'PASS';
    case 'CLAIMED':
      return 'UNVERIFIED';
    case 'CONTRADICTED':
      return 'FAIL';
    case 'NONE':
      return 'PENDING';
  }
}

/**
 * The stricter mapping a future methodology version MIGHT adopt: a URL nobody fetched is an unverified claim, not
 * a pass. Exported so the difference can be measured against the live dataset before anyone decides.
 * NOT used by any gate. Adopting it requires explicit approval and a new methodology version.
 */
export function strictGateOutcomeFor(level: EvidenceLevel): 'PASS' | 'UNVERIFIED' | 'PENDING' | 'UNKNOWN' | 'FAIL' {
  switch (level) {
    case 'SUPPORTED':
      return 'PASS';
    case 'RETRIEVED':
    case 'URL_SHAPED':
    case 'CLAIMED':
      return 'UNVERIFIED';
    case 'CONTRADICTED':
      return 'FAIL';
    case 'NONE':
      return 'PENDING';
  }
}
