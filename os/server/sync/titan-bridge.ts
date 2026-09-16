import type { SuppressionEntry } from '../../../core/leads/schema.js';
import { planSuppressionPublish, suppressionFreshness, type PublishPlan, type PublishState } from '../../../core/reconciliation/publish.js';

/**
 * THE TITAN BOUNDARY — contract only. NOTHING HERE TALKS TO THE NETWORK.
 *
 * After cutover, Postgres owns suppression but the GitHub Actions email cron reads the COMMITTED
 * database/suppression.json. This module defines the one-way, audited publish that closes that gap, and ships a
 * default implementation that REFUSES, so the boundary cannot be crossed by accident before it is deliberately
 * wired up, reviewed and authorised.
 *
 * Invariants any real implementation must keep (asserted by tests):
 *   1. One way only. Postgres -> the committed file. Nothing is ever read back INTO the canonical store.
 *   2. Additive only. A publish appends; it never removes or edits a published entry.
 *   3. Optimistic concurrency. The write is conditional on the SHA that was read. A moved file is a conflict.
 *   4. Fail closed. An unconfirmed publish is treated as not published, and blocks outreach.
 *   5. Audited. Every attempt — including refusals — produces an audit event before anything else happens.
 *   6. Honest UI. "Published" is shown only after a verified landed write, never after a request was sent.
 *
 * The module is deliberately NOT marked `server-only`: it holds no credentials and performs no I/O, so it stays
 * importable by tests. The credential-holding transport that will eventually implement `SuppressionTransport` is
 * where `server-only` belongs.
 */

export interface PublishAttempt {
  /** What the publisher intends to do, from core/reconciliation/publish.ts. */
  plan: PublishPlan;
  /** The state the system must record and display for this attempt. */
  state: PublishState;
  /** Whether outreach through the Titan pipeline may proceed after this attempt. */
  outreachAllowed: boolean;
  /** Human-readable reason, safe to show and to log (never contains a contact value). */
  reason: string;
  /** The audit action to record. */
  auditAction: 'suppression.publish_refused' | 'suppression.publish_attempted' | 'suppression.publish_verified' | 'suppression.publish_conflict' | 'suppression.publish_failed';
}

/**
 * A transport that can read and conditionally write the committed suppression file.
 *
 * `write` MUST be conditional on `expectedSha` and MUST fail rather than overwrite when the remote has moved.
 * No implementation is provided in Phase 1.5.
 */
export interface SuppressionTransport {
  read(): Promise<{ entries: SuppressionEntry[]; sha: string }>;
  write(next: SuppressionEntry[], expectedSha: string): Promise<{ ok: true; sha: string } | { ok: false; conflict: boolean; message: string }>;
}

export class TitanBridgeNotConfiguredError extends Error {
  constructor() {
    super(
      'The Titan suppression bridge is not configured. Publishing suppression to the committed file is a deliberate, ' +
        'authorised step; it is not enabled in Phase 1.5. Until it is, publish by hand and verify the commit landed.'
    );
  }
}

/**
 * The default transport: refuses, always. Chosen over an unconfigured-credentials error so that the failure mode
 * of "someone deployed without wiring this up" is a refusal, not a silent no-op that the UI reports as success.
 */
export const unconfiguredTransport: SuppressionTransport = {
  read: () => Promise.reject(new TitanBridgeNotConfiguredError()),
  write: () => Promise.reject(new TitanBridgeNotConfiguredError()),
};

/**
 * Plans a publish without performing it. Pure apart from the transport read, so the decision can be reviewed
 * before anything is written.
 */
export async function planPublish(canonical: SuppressionEntry[], transport: SuppressionTransport = unconfiguredTransport): Promise<PublishAttempt> {
  let remote: { entries: SuppressionEntry[]; sha: string };
  try {
    remote = await transport.read();
  } catch (e) {
    return {
      plan: { refusal: { code: 'MALFORMED_REMOTE', message: (e as Error).message }, toAppend: [], nextContents: [], expectedBaseSha: '', presentOnlyOnRemote: [] },
      state: 'PUBLISH_FAILED',
      outreachAllowed: false,
      reason: `Could not read the published suppression file: ${(e as Error).message}`,
      auditAction: 'suppression.publish_failed',
    };
  }

  const plan = planSuppressionPublish({ canonical, remote: remote.entries, remoteSha: remote.sha, observedSha: remote.sha });
  const freshness = suppressionFreshness(canonical, remote.entries);

  if (plan.refusal?.code === 'NOTHING_TO_PUBLISH') {
    return { plan, state: 'PUBLISHED_VERIFIED', outreachAllowed: freshness.outreachAllowed, reason: plan.refusal.message, auditAction: 'suppression.publish_verified' };
  }
  if (plan.refusal) {
    return { plan, state: plan.refusal.code === 'STALE_BASE' ? 'PUBLISH_CONFLICT' : 'PUBLISH_FAILED', outreachAllowed: false, reason: plan.refusal.message, auditAction: 'suppression.publish_refused' };
  }
  return {
    plan,
    state: 'NOT_PUBLISHED',
    outreachAllowed: false,
    reason: `${plan.toAppend.length} suppression entr(y/ies) are not yet visible to the email pipeline. ${freshness.reason}`,
    auditAction: 'suppression.publish_attempted',
  };
}

/**
 * Whether the Outbound OS may hand a target to the Titan pipeline right now.
 *
 * Deliberately conservative and deliberately not cached: it recomputes from the two lists every time, because a
 * suppression recorded one second ago must block the next send, not the send after the cache expires.
 */
export function titanOutreachGate(canonical: SuppressionEntry[], published: SuppressionEntry[]): { allowed: boolean; reason: string } {
  const f = suppressionFreshness(canonical, published);
  return { allowed: f.outreachAllowed, reason: f.reason };
}
