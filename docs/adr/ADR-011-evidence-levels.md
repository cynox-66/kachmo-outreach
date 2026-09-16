# ADR-011: URL Syntax, Reachability and Support Are Three Different Things

> **Status:** Approved & Canonical (Phase 1.5)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-16
> **Version:** 1.0.0

---

## Purpose

Records the evidence model, and why a claim can no longer inherit credibility from a string that merely looks like a URL.

---

## Context

Methodology v1.0 records a source as present when it is **URL-shaped** (`isUrl()`). It never checks that the URL resolves, and never checks that the page says what the claim says. That was acceptable while every source came from a human who had actually opened the page.

Phase 2 changes who produces sources. An LLM can emit `https://example-studio.com/about` that has never existed. Under v1.0 rules that string is indistinguishable from a source a human read.

---

## Decision

Evidence has six explicit levels, and the level is **derived from the facts a record carries**, never accepted as asserted:

| Level | Means |
| :-- | :-- |
| `NONE` | no source offered |
| `CLAIMED` | a source was described but not given as a URL |
| `URL_SHAPED` | a syntactically valid URL; **nothing has been fetched, so it may not exist** |
| `RETRIEVED` | the URL was fetched; the page exists but nobody has read it against the claim |
| `SUPPORTED` | a human confirmed the retrieved content states the claim |
| `CONTRADICTED` | the retrieved content contradicts the claim |

Each validator has a maximum level it may establish. **`LLM_EXTRACTION` caps at `RETRIEVED`**: a model may propose that a page supports a claim, but it can never be the thing that certifies its own claim. Only `HUMAN` reaches `SUPPORTED`.

A record asserting `SUPPORTED` without a retrieval timestamp and a supporting excerpt from a permitted validator is rejected as `FABRICATED_LEVEL`. An excerpt without a retrieval is rejected — an excerpt cannot predate its source.

### Methodology v1.0 is not changed

`gateOutcomeFor()` maps evidence onto the **existing five** gate outcomes. `URL_SHAPED` still maps to `PASS`, exactly as v1.0 behaves today, because changing it would re-qualify the 120 live leads. `CONTRADICTED` maps to `FAIL` — the one thing the new model can say that v1.0 could not, and it can only ever disqualify.

`strictGateOutcomeFor()` exists to show what raising the bar would look like (`URL_SHAPED` → `UNVERIFIED`). **No gate calls it.** Adopting it is a methodology change requiring explicit approval, a measured diff against the live dataset, and a new golden baseline.

---

## Consequences

**Accepted:**
- Reaching `SUPPORTED` costs human attention. Most evidence will sit at `URL_SHAPED`, which is honest.
- A future fetcher and a future reviewer UI are required to make the higher levels reachable at all.

**Gained:**
- A fabricated URL buys nothing beyond what a fabricated URL deserves.
- "Did the source actually support this claim?" has a recorded answer per claim.

---

## Implementation

- `core/research/evidence.ts`
- `scripts/__tests__/research-foundation.ts` §1–§3

---

## Cross References

- [ADR-006](ADR-006-rules-before-ai.md) — rules before AI
- [ADR-014](ADR-014-llm-output-is-untrusted.md)
