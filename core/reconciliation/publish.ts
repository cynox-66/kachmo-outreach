import type { SuppressionEntry } from '../leads/schema.js';
import { isEquivalentSuppression } from '../suppression/match.js';

/**
 * ONE-WAY SUPPRESSION PUBLISH — the Titan boundary.
 *
 * The problem this solves: after cutover, Postgres owns suppression, but the GitHub Actions cron that actually
 * sends email reads the COMMITTED database/suppression.json. A suppression that has not reached that file is not
 * yet real. Someone who asked not to be contacted would still be emailed.
 *
 * The design is deliberately not a sync:
 *   - it is ONE WAY (Postgres -> the committed file). Nothing flows back.
 *   - it is ADDITIVE ONLY. A publish may add entries; it may never remove or edit one. Lifting a suppression is a
 *     separate, attributed revocation that a publish cannot perform by accident.
 *   - it uses OPTIMISTIC CONCURRENCY. The publisher states the file SHA it read; if the file moved underneath it,
 *     the publish is refused rather than overwriting whatever arrived in between.
 *   - it FAILS CLOSED. If the publish did not verifiably land, the system must treat outreach as unsafe, and must
 *     not show the operator a "synced" state.
 */

export type PublishRefusalCode =
  | 'STALE_BASE'
  | 'WOULD_REMOVE'
  | 'WOULD_EDIT'
  | 'NOTHING_TO_PUBLISH'
  | 'MALFORMED_REMOTE';

export interface PublishRefusal {
  code: PublishRefusalCode;
  message: string;
}

export interface PublishPlan {
  refusal: PublishRefusal | null;
  /** Entries to append, in order. The published file is `remote` followed by these. */
  toAppend: SuppressionEntry[];
  /** The full contents the publisher should write. Empty when refused. */
  nextContents: SuppressionEntry[];
  /** The SHA the write must be conditional on. */
  expectedBaseSha: string;
  /** Entries the remote holds that the canonical store does not — never removed, always reported. */
  presentOnlyOnRemote: SuppressionEntry[];
}

export interface PublishInput {
  /** Suppression as it stands in the canonical store (Postgres, after cutover). */
  canonical: SuppressionEntry[];
  /** Suppression as read from the committed file, plus the SHA it was read at. */
  remote: SuppressionEntry[];
  remoteSha: string;
  /** The SHA the caller believes is current. A mismatch means someone else wrote in between. */
  observedSha: string;
}

/**
 * Plans an additive publish. Returns a refusal rather than a best-effort merge whenever the remote has moved or
 * would lose an entry.
 */
export function planSuppressionPublish(input: PublishInput): PublishPlan {
  const empty = (refusal: PublishRefusal): PublishPlan => ({
    refusal,
    toAppend: [],
    nextContents: [],
    expectedBaseSha: input.observedSha,
    presentOnlyOnRemote: [],
  });

  if (!Array.isArray(input.remote)) return empty({ code: 'MALFORMED_REMOTE', message: 'the published suppression file is not a JSON array; refusing to replace it' });
  if (input.remoteSha !== input.observedSha) {
    return empty({
      code: 'STALE_BASE',
      message: `the published suppression file moved (read at ${input.observedSha.slice(0, 12)}, now ${input.remoteSha.slice(0, 12)}). Re-read and plan again; never overwrite a change you have not seen.`,
    });
  }

  const presentOnlyOnRemote = input.remote.filter(r => !input.canonical.some(c => isEquivalentSuppression(c, r)));
  const toAppend = input.canonical.filter(c => !input.remote.some(r => isEquivalentSuppression(r, c)));

  if (!toAppend.length) {
    return {
      refusal: { code: 'NOTHING_TO_PUBLISH', message: 'the published file already holds every canonical suppression entry' },
      toAppend: [],
      nextContents: input.remote,
      expectedBaseSha: input.observedSha,
      presentOnlyOnRemote,
    };
  }

  // Additive only: the published contents must still begin with exactly what was there.
  const nextContents = [...input.remote, ...toAppend];
  const removed = input.remote.filter((r, i) => !nextContents[i] || !isEquivalentSuppression(nextContents[i], r));
  if (removed.length) {
    return empty({ code: 'WOULD_REMOVE', message: `the plan would drop ${removed.length} already-published suppression entr(y/ies); a publish never removes` });
  }

  return { refusal: null, toAppend, nextContents, expectedBaseSha: input.observedSha, presentOnlyOnRemote };
}

/**
 * FRESHNESS GUARD — whether outreach may proceed given how far the published file lags the canonical store.
 *
 * This is the rule that makes the boundary safe without any live connection between the two systems: if the
 * canonical store holds a suppression that the published file does not, sending is unsafe, full stop. There is no
 * grace period, because the cost of being wrong is contacting someone who opted out.
 */
export interface FreshnessVerdict {
  fresh: boolean;
  /** Canonical suppression entries the published file is missing. */
  unpublished: number;
  /** True when outreach through the Titan pipeline may proceed. */
  outreachAllowed: boolean;
  reason: string;
}

export function suppressionFreshness(canonical: SuppressionEntry[], published: SuppressionEntry[]): FreshnessVerdict {
  const unpublished = canonical.filter(c => !published.some(p => isEquivalentSuppression(p, c))).length;
  if (unpublished === 0) {
    return { fresh: true, unpublished: 0, outreachAllowed: true, reason: 'every canonical suppression entry is published; the email pipeline can see all of them' };
  }
  return {
    fresh: false,
    unpublished,
    outreachAllowed: false,
    reason:
      `${unpublished} suppression entr(y/ies) exist in the canonical store but not in the published file the email cron reads. ` +
      `Outreach is blocked until they are published: sending now could contact someone who opted out.`,
  };
}

/**
 * What the UI is allowed to claim. A page must never show "synced" on the strength of a request having been sent;
 * only a verified, landed write counts.
 */
export type PublishState = 'NOT_PUBLISHED' | 'PUBLISH_IN_FLIGHT' | 'PUBLISHED_VERIFIED' | 'PUBLISH_FAILED' | 'PUBLISH_CONFLICT';

export function publishStateLabel(state: PublishState): { label: string; safeToSend: boolean } {
  switch (state) {
    case 'PUBLISHED_VERIFIED':
      return { label: 'Published and verified', safeToSend: true };
    case 'PUBLISH_IN_FLIGHT':
      return { label: 'Publishing — not yet confirmed', safeToSend: false };
    case 'PUBLISH_CONFLICT':
      return { label: 'Conflict: the published file changed; re-read and publish again', safeToSend: false };
    case 'PUBLISH_FAILED':
      return { label: 'Publish failed — the email pipeline cannot see these suppressions', safeToSend: false };
    case 'NOT_PUBLISHED':
      return { label: 'Not published', safeToSend: false };
  }
}
