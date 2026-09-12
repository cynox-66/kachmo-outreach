# ADR-006: Deterministic Rules Before AI Evaluation

> **Status:** Approved & Canonical  
> **Owner:** Solo Operator / Lead Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## Purpose

This Architecture Decision Record records the policy mandating that deterministic computational rules (HTTP pre-checks, domain blacklists, HTML heuristics, regex extractors) must execute prior to invoking multimodal AI models.

---

## Scope

- Pipeline execution sequence and architectural ordering.
- Cost and latency optimization for candidate evaluation.

---

## Cross References

- [DISCOVERY_AND_QUALIFICATION.md](../DISCOVERY_AND_QUALIFICATION.md) — Deterministic pre-filter specification
- [AI_SYSTEM.md](../AI_SYSTEM.md) — Downstream AI evaluation
- [ENGINEERING.md](../ENGINEERING.md) — Axiom 2: Rules > AI

---

## Table of Contents

1. [Context](#context)
2. [Problem](#problem)
3. [Decision](#decision)
4. [Alternatives Considered](#alternatives-considered)
5. [Tradeoffs](#tradeoffs)
6. [Consequences](#consequences)
7. [Future Reconsideration](#future-reconsideration)
8. [Revision History](#revision-history)

---

## Context

Many AI-enabled automation tools pass raw, unverified web data directly into Large Language Models, relying on the LLM to filter out broken URLs, identify social platforms, detect programming languages, and extract email addresses.

---

## Problem

Using AI models for tasks that can be computed deterministically is inefficient and problematic:
1. **Unnecessary Token Consumption:** Passing 150 raw domains directly to Gemini consumes ~300,000 tokens/day, risking rate limits and free-tier exhaustion.
2. **High Latency:** Calling an LLM takes 1–3 seconds per candidate; deterministic regex takes < 1 millisecond.
3. **Hallucination Risk:** LLMs can misparse regex patterns or extract invalid text as email addresses.

---

## Decision

We enforce the **Deterministic-First Execution Policy**: All candidate URLs must clear deterministic HTTP status checks, domain blacklists, HTML commercial signal checks, and regex extraction before reaching Playwright or Gemini.

```
[ Raw Candidate (150) ] ──► [ HTTP & Regex Rules (0ms / $0) ] ──► Drop 50% Obvious Misses
                                           │
                                           ▼
                                [ Surviving Cohort (75) ]
                                           │
                                           ▼
                                [ Multimodal AI Audit ]
```

---

## Alternatives Considered

1. **AI-Only Pipeline:** Feed raw HTML directly to LLM for classification and extraction. (Rejected due to latency and token waste).
2. **Rules-Only Pipeline:** Evaluate everything via regex and heuristics without AI. (Rejected because visual aesthetic defect evaluation and tailored copywriting require multimodal intelligence).

---

## Tradeoffs

### Positive:
- Cuts AI API token consumption and Playwright browser executions by **50% to 60%**.
- Fast, reproducible, and easily unit-tested pre-filtering logic.

### Negative:
- Requires maintaining a small set of regex and keyword patterns in `src/qualify.ts`.

---

## Consequences

- The pipeline executes Stages C (Rules) before Stage D (Playwright) and Stage E (AI).
- All rules are covered by deterministic Vitest unit tests in `tests/rules.test.ts`.

---

## Future Reconsideration

This decision is foundational and permanent. It represents core software engineering hygiene and will not be reversed.

---

## Revision History

| Version | Date | Author | Description |
| :--- | :--- | :--- | :--- |
| `1.0.0` | 2026-08-09 | Solo Operator / Lead Engineer | Approved canonical ADR-006. |
