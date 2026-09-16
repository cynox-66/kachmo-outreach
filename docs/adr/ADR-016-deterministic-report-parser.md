# ADR-016: A Deterministic Parser, Not a Model

> **Status:** Approved & Canonical (Phase 2)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-16
> **Version:** 1.0.0

---

## Purpose

Records why report ingestion ships without an LLM, and what would have to be true before one is added.

---

## Context

[ADR-014](ADR-014-llm-output-is-untrusted.md) established that model output is untrusted input and must pass a strict validator. That left open whether a model should do the parsing at all.

---

## Decision

**Phase 2 parses reports deterministically.** `server/research/parse.ts` reads Markdown, plain text, CSV and JSON against the output schema the brief already specifies.

The reasoning:

- A research drop that follows the brief needs no model to read. The brief tells the researcher the schema; honouring it is the researcher's job.
- **A deterministic parser cannot hallucinate a company that was not in the file.** A model can. That difference matters more than tolerating free-form prose.
- It is testable exhaustively, offline, with no cost and no variance.

The LLM extraction interface (`core/research/extraction.ts`) remains, unchanged and unused, for the case where free-form prose must be ingested. **Both paths feed the same validator**, so adding a model later changes where candidates come from and nothing about what is believed.

Everything is bounded: input size, JSON nesting depth, candidates per report, fields per candidate, value length, CSV rows. A malicious or malformed report exhausts a limit rather than the process.

Unrecognised fields are dropped with a warning rather than guessed at, and **a candidate with any error is discarded whole** — half a candidate is worse than none, because a reviewer would see a company with fields silently missing and no indication why.

---

## Consequences

**Accepted:**
- A report that ignores the brief's schema extracts poorly. That is visible immediately, and the fix is the prompt, not the parser.
- Prose-heavy reports are not usable until the LLM path is enabled.

**Gained:**
- Ingestion has no model cost, no variance and no provider dependency.
- The first thing that would go wrong with LLM extraction — invented companies — cannot happen at all today.

---

## Before enabling the LLM path

1. A corpus of real reports the deterministic parser handles badly, showing the need.
2. The extraction feature flag flipped deliberately and audited.
3. Evidence still capped at `RETRIEVED` for `LLM_EXTRACTION` ([ADR-011](ADR-011-evidence-levels.md)).

---

## Implementation

`server/research/parse.ts`, `core/research/extraction.ts`, `os/tests/research.ts` §3–§4.
