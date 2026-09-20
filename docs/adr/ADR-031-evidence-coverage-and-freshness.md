# ADR-031: Evidence Coverage and Freshness Are Derived Dimensions; a Changed Source Returns to a Person

> **Status:** Approved & Canonical (Phase D)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-20
> **Version:** 1.0.0

---

## Context

Phase B made a claim's evidence provable. But two questions stayed unanswerable: **how well sourced is each gate's
fact?**, and **is the source still saying what it said when somebody checked it?** A source checked in March and
rewritten in June leaves a review that describes a page that no longer exists.

## Decision

Both are **derived on read**, from rows that already exist. Nothing new is stored and no level is rewritten.

1. **Coverage** (`core/research/coverage.ts`): each gate declares the claim fields its judgement rests on, and the
   coverage is the strongest derived evidence level across them. A contradiction is reported separately, never as
   "stronger". A gate that rests on a human judgement (Kachmo fit) has no measurable source and says so.
2. **Freshness**: `FRESH` / `STALE` (no successful retrieval within 30 days) / `SOURCE_CHANGED` / `UNRETRIEVED`.
3. **SOURCE_CHANGED** is the important one: when a page is re-fetched after a person checked it and its content hash
   differs, that review no longer describes the page. The claim's recorded level is **not** rewritten behind the
   reviewer's back — it is flagged, and the claim becomes work (`EVIDENCE_RECHECK` in Today).
4. **`evidence:fetch --refresh[=days]`** re-fetches sources whose newest successful retrieval is older than the
   window, with the same SSRF, robots, rate and cooldown rules. A refresh writes retrievals and links, never a lead.
5. A recorded **contradiction** becomes the highest-priority evidence work (`EVIDENCE_CONTRADICTION`): the lead
   record may be wrong, and a person corrects it through the ordinary write path.

**None of this changes a gate, a score, a state or a lead.** Coverage is shown beside the gate outcome so an operator
can see which conclusions rest on a checked source and which rest on a string.

## Implementation

`core/research/coverage.ts`, `os/server/evidence/{store,fetch-run,coverage}.ts`, `os/server/services/today.ts`,
the lead page's gate and evidence panels, `os/tests/evidence-intelligence.ts` §1, §3, §4.
