# ADR-022: Lead Revisions Are History; Revert Is Forward-Only

> **Status:** Approved & Canonical (Phase B)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-19
> **Version:** 1.0.0

---

## Decision

Every write stores the superseded record in the append-only `lead_revision` (database guard). It is history for
rollback and never a second source of truth: `lead.record` is canonical, no service exposes revisions, and they
hold contact values, so only the revert tool reads them.

`npm --prefix os run leads:revert -- --lead=<target> --to-version=<n>` restores an earlier version's content **as a new
version**. Nothing is rewound; the mistaken version stays in history. It is dry-run-first, digest-bound, audited
(`lead.reverted`), re-evaluated, and passes the same ownership and invariant checks as any write.

**A revert never crosses a suppression.** If any version in the range changed `do_not_contact` or
`suppression_reason`, the revert is refused: lifting a suppression is a separate, attributed revocation, never an undo.

## Implementation

`os/server/leads/revert.ts`, `os/tests/lead-writes.ts` §7.
