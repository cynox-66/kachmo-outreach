# ADR-020: Derived State Is Re-Evaluated and Persisted With Every Write

> **Status:** Approved & Canonical (Phase B)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-19
> **Version:** 1.0.0

---

## Purpose

Records how qualification, scores, readiness and next action stay current after cutover.

## Context

Before cutover, `npm run leads:refresh` re-derived every lead. After cutover nothing did: stored derived fields froze,
a promoted candidate entered at RESEARCH_REQUIRED / 0% and never moved, and `lead_evaluation` stayed empty. The lead
page recomputes gates at render time while queues read the stored state, so the two could silently disagree.

## Decision

1. **Every write re-evaluates the lead in the same transaction** — qualify → score → opportunity, the CLI's chain in
   the CLI's order (`os/server/leads/reevaluate.ts`). No rule is re-implemented; core/ decides.
2. **Every evaluation is recorded** in the append-only `lead_evaluation`, attributed to the ACTIVE methodology (the
   write is refused if the ACTIVE methodology is not the one the engine implements), the engine build
   (`core-dist:<sha256 of core/dist>`), the input hash and the named actor.
3. **`npm --prefix os run leads:reevaluate`** re-derives every lead: dry run by default, apply bound to the dry-run
   digest, one transaction per lead, idempotent.
4. The input hash names the **stored** record after evaluation. Re-evaluation is a fixed point (evaluating the stored
   record again changes nothing — asserted by the parity test), so "is this lead's current state evaluated?" is a
   lookup.
5. The lead page shows **drift** — where stored qualification disagrees with the engine — instead of hiding it.

## Consequences

- The methodology golden is the oracle: re-evaluating the pinned 120 leads gives records byte-identical to the CLI
  refresh, with the same number of QUALIFICATION_CHANGED events. **Methodology v1.0 is unchanged.**
- The first production run will rewrite the leads whose stored state is behind (at minimum the stale next-action
  text of the 18 reconciled leads). Anything else in that dry run must be investigated before it is applied.

## Implementation

`os/server/leads/{reevaluate,reevaluate-run}.ts`, `os/tests/lead-writes.ts` §2.
