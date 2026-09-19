# ADR-019: One Postgres Applier Executes Core Decisions After Cutover

> **Status:** Approved & Canonical (Phase B)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-19
> **Version:** 1.0.0

---

## Purpose

Records how canonical leads are changed after cutover, when every legacy CLI writer is refused (ADR-018).

## Context

After cutover the application had exactly one lead write — candidate import. Logging a call, recording a WhatsApp
review, moving a sales stage, recording research and recording an opt-out were all impossible: the CLI refuses
(ADR-018) and the app had no path. The operator was reading a database nobody could write.

## Decision

**`os/server/leads/mutate.ts` is the only module that updates a canonical lead.** It is the Postgres counterpart of
`scripts/lib/apply.ts` and executes a core/ `LeadDecision` — it never decides anything itself. One transaction:

    canonical write lock → lead FOR UPDATE → version check → suppression + ledger read inside the transaction →
    core decision → re-evaluation (ADR-020) → ownership check on every changed field → invariants →
    revision (ADR-022) → lead update → suppression → events → evaluation → audit

- The decision runs **inside** the transaction, after the lock, so it always sees the state it changes.
- **`mayWrite('POSTGRES', field, phase)` is enforced on every changed field** — until now it was only asserted in
  tests. An unclassified field is refused (deny-by-default); identity and never-estimated fields are refused.
- **`findInvariantViolations`** is enforced on the result, exactly as `saveLeads()` does.
- Every write carries the version the operator saw; a different stored version is refused (double-submit safe).

### FOLLOW_UP_SENT is not an application transition

`decidePipelineTransition('FOLLOW_UP_SENT')` writes `email_follow_up_sent_at`, which the ownership table assigns to
**TITAN in every phase**. The applier therefore refuses it (and audits `lead.ownership_violation`); the operator
command refuses it earlier with the reason in operator language. Email follow-ups are sent and recorded by Titan.
This is the only difference from the CLI's write-path golden baseline, and the parity test asserts exactly that.

## Consequences

- The legacy write-path golden is the parity oracle: replaying its whole scenario through the applier leaves every
  lead byte-identical to the CLI result except lead 001 (the refused follow-up).
- Safety-relevant refusals (on a blocked lead, or an ownership violation) are audited after the rolled-back
  transaction, in their own.

## Implementation

`os/server/leads/{mutate,commands,actions,suppression}.ts`, `os/tests/lead-writes.ts` §3–§5, `os/tests/evidence.ts` §7.
