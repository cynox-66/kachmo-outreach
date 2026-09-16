# ADR-010: One-Way Audited Suppression Publish at the Titan Boundary

> **Status:** Approved & Canonical (Phase 1.5)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-16
> **Version:** 1.0.0

---

## Purpose

Records how a suppression recorded in the Outbound OS reaches the email pipeline that actually sends, and why that path is a publish rather than a sync.

---

## Context

After cutover, Postgres owns suppression. But the GitHub Actions cron that sends email reads the **committed** `database/suppression.json`. A suppression that has not reached that file is not real: the person who asked not to be contacted would still be emailed.

This is not a theoretical gap. `npm run suppress:add` already warns when a newly suppressed target is still sitting in `scheduled-queue.json`, because the cron does not read V2 suppression.

---

## Decision

Suppression crosses the boundary by a **one-way, additive, optimistic, audited publish**, and outreach **fails closed** while anything is unpublished.

1. **One way.** Postgres → the committed file. Nothing is ever read back into the canonical store.
2. **Additive only.** A publish appends. It never removes or edits a published entry. Lifting a suppression is a separate, attributed revocation that a publish cannot perform by accident. A remote that suppresses *more* than canonical is left alone — over-suppression is safe.
3. **Optimistic concurrency.** The write is conditional on the SHA that was read. A file that moved is a `PUBLISH_CONFLICT`, re-read and re-planned — never overwritten.
4. **Fail closed.** If any canonical suppression entry is absent from the published file, Titan outreach is blocked outright. There is no grace period and no cache, because the cost of being wrong is contacting someone who opted out.
5. **Audited.** Every attempt, including every refusal, produces an audit event.
6. **Honest UI.** Of the five publish states, exactly one permits sending, and it is `PUBLISHED_VERIFIED`. An in-flight publish is never displayed as "synced".

The default transport **refuses**. An unconfigured deployment fails closed rather than silently no-opping and reporting success.

---

## Consequences

**Accepted:**
- Suppression is not instantly effective end to end; it is effective once published, and provably so.
- Until the bridge is wired up, publishing is a manual, verified step.

**Gained:**
- No code path exists by which a suppression can be silently lost.
- "Can we send?" has one answer derived from the two lists, recomputed every time.

---

## Implementation

- `core/reconciliation/publish.ts` — `planSuppressionPublish()`, `suppressionFreshness()`, publish states
- `os/server/sync/titan-bridge.ts` — contract, refusing default transport, outreach gate. **No network call exists.**
- `os/tests/sync.ts` — 29 checks

---

## Cross References

- [ADR-008](ADR-008-no-autonomous-outreach.md) — no autonomous outbound
- [ADR-009](ADR-009-single-writer-canonical-state.md)
