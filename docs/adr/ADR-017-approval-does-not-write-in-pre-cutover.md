# ADR-017: An Approval Is Recorded, Not Written, Before Cutover

> **Status:** Approved & Canonical (Phase 2)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-16
> **Version:** 1.0.0

---

## Purpose

Records what happens when a human approves a research candidate while the JSON store is still canonical.

---

## Context

[ADR-012](ADR-012-candidates-are-not-leads.md) makes human approval the only path from candidate to canonical lead. But in `PRE_CUTOVER` the canonical lead store is the committed JSON file, which **only the CLI writes** ([ADR-009](ADR-009-single-writer-canonical-state.md)).

Writing the approved lead into Postgres would create a second writer and split the truth. Writing it into the JSON file from a web request would make the app a writer of a store it does not own.

---

## Decision

**An approval before cutover is real, recorded and audited — but it does not create a lead.**

`reviewCandidate` records the decision, the named reviewer and the timestamp, emits the audit event, and returns `pendingExport: true` with `resolvedLeadId: null`. The candidate joins an **export queue** the operator works through with the CLI.

After cutover, the same approval writes the lead directly, and suppression is re-checked **inside the transaction** — the gap between approval and insert is small but not zero, and contacting someone who opted out during it would be indefensible.

The database enforces the distinction: `research_candidate.resolved_lead_id` may be non-null only when `reviewed_by_label` is non-null, so nothing can claim a canonical lead without a recorded human reviewer.

---

## Consequences

**Accepted:**
- Before cutover, approving a candidate is two steps: approve in the app, export with the CLI. The second step is manual.
- `ACCEPTED` and "became a lead" are different states, and the UI must say which.

**Gained:**
- The single-writer model holds with no exception, including for the one feature that most wants one.
- The human approval boundary is exercised and audited now, so it is proven before it starts creating rows.

---

## Implementation

`server/research/service.ts` (`reviewCandidate`, `listApprovedPendingExport`), `os/tests/research.ts` §6–§7.
