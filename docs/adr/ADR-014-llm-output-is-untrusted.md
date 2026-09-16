# ADR-014: LLM Output Is Untrusted Input

> **Status:** Approved & Canonical (Phase 1.5)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-16
> **Version:** 1.0.0

---

## Purpose

Records how model output is handled when Phase 2 uses an LLM to parse research reports.

---

## Decision

An LLM is a **convenience for parsing prose**, never an authority on truth. Everything it emits passes through a strict validator before it can become a candidate.

Three rules a well-behaved model would keep anyway, and a misbehaving or prompt-injected one would not:

1. **No fabricated confidence.** The model's stated confidence is recorded as a claim *about itself*. It never raises an evidence level.
2. **No invented evidence.** An extractor claiming a retrieval, or supplying a supporting excerpt, is rejected outright — it cannot claim to have read a page.
3. **No automatic gate passes.** It cannot set a candidate status, cannot supply review or resolution fields, and caps at `RETRIEVED` (ADR-011).

Also rejected: spoofed validators, invented archetypes, invalid URLs, fields outside the allowlist, values over the length cap, and two different values for the same field. Control characters and NUL are stripped from every extracted string.

**A candidate with any error is discarded whole**, never partially kept: half a candidate is worse than none, because a reviewer would see a company with fields silently missing and no indication why.

Extraction is feature-flagged off, is never reachable from any sending path, and `core/research/extraction.ts` contains **no model call** — it is the validator such a call's output must pass through.

---

## Consequences

**Accepted:**
- Strict validation will reject some usable output. The report is kept verbatim, so nothing is lost and the prompt can be improved.

**Gained:**
- A prompt-injected report cannot approve itself, mark itself reviewed, or claim to have read a page.

---

## Implementation

- `core/research/extraction.ts`
- `scripts/__tests__/research-foundation.ts` §7

---

## Cross References

- [ADR-006](ADR-006-rules-before-ai.md), [ADR-011](ADR-011-evidence-levels.md), [ADR-012](ADR-012-candidates-are-not-leads.md)
