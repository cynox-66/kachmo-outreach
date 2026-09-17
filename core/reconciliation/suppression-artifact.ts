import type { SuppressionEntry } from '../leads/schema.js';
import { isEquivalentSuppression, suppressionEntryProblems } from '../suppression/match.js';

/**
 * THE SUPPRESSION ARTIFACT — what Titan actually reads, and whether it can be trusted.
 *
 * After cutover Postgres owns suppression, but the GitHub Actions dispatcher reads the committed
 * database/suppression.json. That file is a DERIVED ARTIFACT: never canonical, only ever produced from Postgres
 * by the audited publisher (ADR-010, ADR-018).
 *
 * This module is the deterministic core of that boundary. It has no I/O, no database access and no Node builtins,
 * so the rule that decides whether email may be sent can be tested exhaustively and cannot behave differently in
 * production. Hashing is injected rather than imported, to keep it that way.
 *
 * The question it answers is NOT "does the file exist" or "does it parse". It is:
 *
 *     does this artifact exactly represent the current active Postgres suppression state?
 *
 * Anything short of yes blocks outreach.
 */

export type ArtifactStatus =
  /** The artifact represents exactly the active canonical state. Outreach may proceed. */
  | 'IN_SYNC'
  /** Canonical holds suppressions the artifact does not. Someone who opted out is not protected. */
  | 'STALE'
  /** The artifact holds entries canonical does not explain. */
  | 'EXTRA_ENTRIES'
  /** The artifact is not readable as a suppression list at all. */
  | 'MALFORMED'
  /** The artifact is absent. */
  | 'MISSING'
  /** Canonical state could not be read. */
  | 'SOURCE_UNAVAILABLE';

export interface ArtifactVerdict {
  status: ArtifactStatus;
  /** The one question that matters. False for every status except IN_SYNC. */
  outreachAllowed: boolean;
  /** Active canonical entries absent from the artifact — the dangerous direction. */
  missing: SuppressionEntry[];
  /**
   * Entries in the artifact with no matching ACTIVE canonical entry. A revoked suppression lands here and is
   * benign: a publish is additive and never removes, so a lifted suppression stays in the artifact until it is
   * deliberately revoked there. An entry matching nothing at all is not benign.
   */
  extra: SuppressionEntry[];
  /** Extras explained by a revoked canonical entry. Always a subset of `extra`. */
  extraExplainedByRevocation: SuppressionEntry[];
  /** Extras with no canonical counterpart in any state — an artifact nobody can account for. */
  extraUnexplained: SuppressionEntry[];
  /** Per-entry structural problems, when the artifact is malformed. */
  problems: string[];
  /** Hash of the artifact bytes exactly as they were read, for audit. */
  artifactHash: string | null;
  /** Hash of the canonical state this verdict was computed against, for audit. */
  canonicalHash: string;
  reason: string;
}

/** Hashes a string. Injected by the caller so core/ stays free of Node builtins. */
export type HashFn = (input: string) => string;

/** Stable hash of a suppression list, independent of key order and array order. */
export function suppressionStateHash(entries: SuppressionEntry[], hash: HashFn): string {
  const norm = entries
    .map(e =>
      JSON.stringify({
        lead_id: e.lead_id ?? null,
        target_number: e.target_number ?? null,
        company_name: e.company_name ?? null,
        email: (e.email ?? '').trim().toLowerCase() || null,
        phone: e.phone ?? null,
        domain: (e.domain ?? '').trim().toLowerCase() || null,
        reason: e.reason,
        suppressed_at: e.suppressed_at,
        source: e.source,
      })
    )
    .sort();
  return hash(norm.join('\n'));
}

/**
 * The exact bytes the publisher writes. Deterministic: the same canonical state always produces the same file,
 * so an unchanged state produces no diff and re-publishing is a no-op rather than a churning commit.
 */
export function serializeSuppressionArtifact(entries: SuppressionEntry[]): string {
  return `${JSON.stringify(entries, null, 2)}\n`;
}

export interface VerifyInput {
  /** Active (non-revoked) suppression from Postgres, or null when Postgres could not be read. */
  canonicalActive: SuppressionEntry[] | null;
  /** Canonical entries that exist but have been revoked. Used only to explain artifact extras. */
  canonicalRevoked?: SuppressionEntry[];
  /** The artifact bytes exactly as read, or null when the file is absent. */
  artifactRaw: string | null;
  /** Injected hash, so this module needs no crypto import. */
  hash: HashFn;
}

/**
 * Classifies the artifact against canonical state. Every non-IN_SYNC verdict blocks outreach: there is no
 * partial credit, because the cost of being wrong is contacting someone who asked not to be contacted.
 */
export function verifySuppressionArtifact(input: VerifyInput): ArtifactVerdict {
  const revoked = input.canonicalRevoked ?? [];
  const base = {
    missing: [] as SuppressionEntry[],
    extra: [] as SuppressionEntry[],
    extraExplainedByRevocation: [] as SuppressionEntry[],
    extraUnexplained: [] as SuppressionEntry[],
    problems: [] as string[],
    artifactHash: input.artifactRaw === null ? null : input.hash(input.artifactRaw),
    canonicalHash: input.canonicalActive === null ? '' : suppressionStateHash(input.canonicalActive, input.hash),
  };

  if (input.canonicalActive === null) {
    return { ...base, status: 'SOURCE_UNAVAILABLE', outreachAllowed: false, reason: 'canonical suppression state could not be read from Postgres; refusing to treat the artifact as trustworthy' };
  }
  if (input.artifactRaw === null) {
    return { ...base, status: 'MISSING', outreachAllowed: false, reason: 'the suppression artifact does not exist; the dispatcher has nothing to check against' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.artifactRaw);
  } catch (e) {
    return { ...base, status: 'MALFORMED', outreachAllowed: false, problems: [(e as Error).message], reason: 'the suppression artifact is not valid JSON' };
  }
  if (!Array.isArray(parsed)) {
    return { ...base, status: 'MALFORMED', outreachAllowed: false, problems: ['not a JSON array'], reason: 'the suppression artifact is not a JSON array' };
  }
  const problems = suppressionEntryProblems(parsed);
  if (problems.length) {
    return { ...base, status: 'MALFORMED', outreachAllowed: false, problems, reason: `the suppression artifact has ${problems.length} malformed entr(y/ies)` };
  }

  const artifact = parsed as SuppressionEntry[];
  const missing = input.canonicalActive.filter(c => !artifact.some(a => isEquivalentSuppression(a, c)));
  const extra = artifact.filter(a => !input.canonicalActive!.some(c => isEquivalentSuppression(c, a)));
  const extraExplainedByRevocation = extra.filter(a => revoked.some(r => isEquivalentSuppression(r, a)));
  const extraUnexplained = extra.filter(a => !revoked.some(r => isEquivalentSuppression(r, a)));

  const result = { ...base, missing, extra, extraExplainedByRevocation, extraUnexplained, problems: [] as string[] };

  // Checked first: a missing entry is the direction that gets someone emailed who opted out.
  if (missing.length) {
    return {
      ...result,
      status: 'STALE',
      outreachAllowed: false,
      reason: `${missing.length} active suppression entr(y/ies) are in Postgres but not in the artifact the dispatcher reads. Publish before sending.`,
    };
  }
  if (extraUnexplained.length) {
    return {
      ...result,
      status: 'EXTRA_ENTRIES',
      outreachAllowed: false,
      reason:
        `${extraUnexplained.length} artifact entr(y/ies) match no suppression in Postgres, active or revoked. ` +
        `The artifact is derived state and nothing should be able to put an entry there; refusing until this is explained.`,
    };
  }
  return {
    ...result,
    status: 'IN_SYNC',
    outreachAllowed: true,
    reason:
      extraExplainedByRevocation.length > 0
        ? `the artifact holds every active canonical suppression, plus ${extraExplainedByRevocation.length} revoked entr(y/ies) kept because a publish never removes`
        : 'the artifact represents exactly the active canonical suppression state',
  };
}
