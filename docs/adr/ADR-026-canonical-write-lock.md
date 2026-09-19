# ADR-026: One Canonical Write Lock Serialises Every Canonical Write

> **Status:** Approved & Canonical (Phase B)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-19
> **Version:** 1.0.0

---

## Purpose

ADR-017 says suppression is re-checked "inside the transaction" when a candidate is approved. It was not: the approval
was decided against a snapshot read before the transaction, and the target number came from the same stale snapshot
(a race only the unique constraint caught, as an error).

## Decision

Every write that changes canonical lead state takes **one** transaction-scoped advisory lock first
(`pg_advisory_xact_lock(0x4b414348)`): lead updates, lead inserts, suppression entries, analytics and suppression
sequence numbers, target numbers. Then:

- a candidate approval **re-reads the candidate, every lead and the suppression list inside the transaction** and
  re-decides `approvalRefusal` there — a suppression committed a moment earlier refuses the import;
- the target number is allocated from that locked read, so two approvals can never collide;
- `analytics_event.sequence` and `suppression_entry.sequence` are allocated gap-free as max+1.

One exclusive lock rather than shared/exclusive pairs: there is no lock ordering to get wrong and no deadlock to reason
about. Two operators produce a handful of writes a minute; correctness under concurrency is worth far more than
parallel throughput nobody needs.

## Consequences

- An approval now also evaluates the new lead (ADR-020) and attaches its evidence (ADR-024) in the same transaction.
- **Proven against real Postgres with two independent connections** (`npm --prefix os run test:concurrency`, loopback
  Postgres 16 only): a second connection is seen waiting on the advisory lock; an approval queued behind a suppression
  is refused; a suppression queued behind an approval flags the imported lead; same-version writes from two
  connections land exactly once (the other STALE); ten simultaneous approvals get unique, contiguous target numbers;
  suppression and event sequences stay gap-free.
- The lock is transaction-scoped, so it is safe behind Neon's pooled (transaction-mode) endpoint.

## Implementation

`os/server/leads/locks.ts`, `os/server/research/service.ts` (`acceptIntoCanonical`), `os/tests/app.ts` §10,
`os/tests/evidence.ts` §8, `os/tests/concurrency.ts`.
