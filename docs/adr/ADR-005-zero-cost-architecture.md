# ADR-005: Zero-Cost Architecture & Budget Guardrail

> **Status:** Approved & Canonical  
> **Owner:** Solo Operator / Lead Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## Purpose

This Architecture Decision Record records the commitment to a **$0.00/month target operating budget** with an automated in-code **$2.50/month hard circuit breaker** for Lead Engine.

> **Amendment (2026-08-11):** The $0.00 premise no longer holds. Grounding with
> Google Search is excluded from the Gemini free tier for every model (verified
> against the live API), so discovery requires billing enabled. Measured
> operating cost is **~$2.04/month** at a 40-candidate daily batch. The
> $2.50 circuit breaker below is unchanged and is now the binding constraint
> rather than a theoretical backstop. The zero-cost principle still governs
> every other dependency (Actions, Sheets, PageSpeed).

---

## Scope

- Financial boundary conditions and free-tier infrastructure selections.
- Rejection of paid SaaS platforms, servers, and enrichment subscriptions.

---

## Cross References

- [IMPLEMENTATION.md](../IMPLEMENTATION.md) — Comprehensive cost breakdown and quotas
- [PROJECT_CHARTER.md](../PROJECT_CHARTER.md) — Operating constraints
- [ENGINEERING.md](../ENGINEERING.md) — Axiom 10: Revenue > Infrastructure

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

The operator is a student building an internal tool during evenings after college. Paying recurring monthly SaaS infrastructure bills ($150+/mo) without proven client revenue creates personal financial stress and misaligns engineering priorities with business viability.

---

## Problem

Many modern developer tools default to commercial cloud services that seem cheap individually but accumulate substantial recurring monthly burn:
- Workflow tools (n8n: $20/mo)
- Server containers (Railway: $20/mo)
- Databases (Supabase: $25/mo)
- Lead enrichment (Hunter: $49/mo)
- Outbound tools (Instantly: $37/mo)
- Total: **$150–$200/month**.

For an internal tool with one user, paying this burn before closing a single client engagement violates fundamental engineering prudence.

---

## Decision

We mandate that Lead Engine must run entirely on **generous, permanent free tiers** (GitHub Actions, Google Gemini Free Tier, Google Sheets API, PageSpeed API) targeting **$0.00/month**. An automated budget circuit breaker in `src/config.ts` enforces `MONTHLY_BUDGET_USD = 2.50`.

---

## Alternatives Considered

1. **Paid Micro-SaaS Stack ($150+/mo):** High convenience, but violates financial constraints.
2. **Local Machine Cron with No Cloud Services ($0/mo):** Zero cost, but requires the developer's laptop to be open and connected to Wi-Fi at scheduled execution times.
3. **GitHub Actions + Google Cloud Free Tier ($0/mo):** **Selected.** Runs automatically in the cloud on schedule without hosting fees.

---

## Tradeoffs

### Positive:
- Zero financial risk; infinite runway.
- Focuses engineering on lean, efficient code rather than throwing cloud compute at unoptimized scripts.

### Negative:
- Must respect free-tier rate limits (e.g. Gemini 15 RPM, GitHub Actions 2,000 monthly runner minutes).

---

## Consequences

- Codebase includes token counters and rate limiters to guarantee compliance with free tiers.
- In-code circuit breaker aborts external API calls if estimated monthly spend reaches $2.50.

---

## Future Reconsideration

Reconsider introducing paid APIs (e.g. paid Gemini tier or contact enrichment) only after Lead Engine has directly generated at least **$3,000 in closed freelance client revenue**.

---

## Revision History

| Version | Date | Author | Description |
| :--- | :--- | :--- | :--- |
| `1.0.0` | 2026-08-09 | Solo Operator / Lead Engineer | Approved canonical ADR-005. |
