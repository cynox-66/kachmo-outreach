# ADR-032: The Methodology Shadow Is a Measurement; v1.1 Is Not Defined

> **Status:** Approved & Canonical (Phase D)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-20
> **Version:** 1.0.0

---

## Context

The obvious next step after making evidence provable is to let it decide: a URL nobody fetched should not pass a
gate. That is a methodology change with commercial consequences — it would re-qualify live leads — and the right
order is evidence → interpretation → human review → deterministic decision, *then* a decision about the methodology.

## Decision

Phase D builds the **instrument**, not the change.

- `npm --prefix os run methodology:shadow` reports, per gate, the outcome that ADR-011's already-published
  `strictGateOutcomeFor` mapping would produce for the evidence actually recorded, and how many leads it would touch.
- It is **read-only**: no lead, no evaluation, no methodology row is written, and `strictGateOutcomeFor` is still
  called by no gate.
- It reports **gate-level differences only**. It deliberately does not derive a shadow research state: the state
  rules belong to the engine, and duplicating them here would put the methodology in two places.
- A gate with no recorded evidence is left alone — nothing measured, nothing claimed.

**Methodology v1.1 is not defined by this ADR and does not exist.** If an owner later decides to adopt a stricter
reading, it requires: an explicit definition, a new `methodology_version` row, a new golden baseline, a measured diff
over the live dataset, an explicit re-evaluation run (the Phase B path), and its own ADR. Historical decisions are
never silently reinterpreted: past evaluations stay attributed to the methodology and engine that made them.

## Today's measurement

On the live dataset the shadow is nearly empty, because no legacy lead carries a URL source at all (Phase B
finding 1). It becomes informative as researched evidence accumulates — which is exactly when the question matters.

## Implementation

`core/research/coverage.ts` (`shadowDifferences`), `os/server/evidence/coverage.ts`,
`os/tests/evidence-intelligence.ts` §2, §5.
