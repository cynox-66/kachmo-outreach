# ADR-003: Deterministic Playwright Over Agentic Stagehand

> **Status:** Approved & Canonical  
> **Owner:** Solo Operator / Lead Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## Purpose

This Architecture Decision Record records the selection of standard **Microsoft Playwright** for deterministic headless browser automation over AI-driven agentic browser frameworks (Stagehand, Browser-Use, Skyvern).

---

## Scope

- Browser automation engine for candidate auditing and screenshot capture.
- Comparison of deterministic DOM scraping vs. LLM-driven browser agents.

---

## Cross References

- [IMPLEMENTATION.md](../IMPLEMENTATION.md) — Playwright execution specification
- [ARCHITECTURE.md](../ARCHITECTURE.md) — Subsystem boundaries
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

The pipeline requires visiting candidate websites to capture a mobile viewport screenshot and extract technical DOM indicators (horizontal overflow, contact links, CMS meta tags). Early proposals recommended using modern AI browser frameworks like **Stagehand** or **Browser-Use** to autonomously navigate pages and infer information.

---

## Problem

Agentic browser frameworks introduce severe operational liabilities:
1. **Extreme Latency:** AI agents take 15–45 seconds per website as they iteratively send DOM snapshots to an LLM to decide the next click action.
2. **High API Token Costs:** Every page navigation consumes thousands of tokens, quickly breaching the $0–$3 budget ceiling.
3. **Nondeterminism & Flakiness:** AI agents frequently get stuck in infinite navigation loops or misclick on unrelated elements.
4. **Learning & Integration Tax:** Adds complex third-party abstractions that are difficult to debug in evening development sessions.

---

## Decision

We standardize exclusively on **raw Microsoft Playwright** executing deterministic client-side evaluation scripts inside headless Chromium.

---

## Alternatives Considered

1. **Stagehand (Browserbase):** Excellent tool for complex dynamic multi-step web navigation, but massive overkill for single-page audit and screenshot extraction.
2. **Puppeteer:** Functionally equivalent to Playwright, but Playwright offers superior mobile device emulation, auto-waiting, and isolated context handling.
3. **Cheerio-only (No Headless Browser):** Extremely fast (50ms), but cannot capture screenshots or evaluate dynamic CSS/JS layout shifts (e.g. mobile overflow).

---

## Tradeoffs

### Positive:
- **Blazing Fast:** Audits and captures screenshots in 2–4 seconds per site.
- **Zero API Cost:** Browser runs locally inside the runner; zero LLM token consumption.
- **100% Deterministic:** Predictable behavior with rock-solid error handling.

### Negative:
- Cannot automatically solve interactive multi-step navigation forms (not required for V1 auditing).

---

## Consequences

- The pipeline uses standard Playwright APIs (`page.goto`, `page.evaluate`, `page.screenshot`).
- Memory is kept strictly bounded by closing pages and contexts immediately after extraction.

---

## Future Reconsideration

Reconsider Stagehand or agentic browsing in Phase 2 only if empirical evidence proves that >30% of target portfolios hide their contact information behind complex dynamic JavaScript interactions that deterministic Playwright scripts fail to scrape.

---

## Revision History

| Version | Date | Author | Description |
| :--- | :--- | :--- | :--- |
| `1.0.0` | 2026-08-09 | Solo Operator / Lead Engineer | Approved canonical ADR-003. |
