# ADR-001: Workflow Over Interactive Application Architecture

> **Status:** Approved & Canonical  
> **Owner:** Solo Operator / Lead Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## Purpose

This Architecture Decision Record (ADR) records the strategic choice to construct **Lead Engine** as a headless, batch-driven automated workflow rather than an interactive web application or commercial SaaS product.

---

## Scope

- System architecture boundaries for Version 1.
- Rejection of full-stack web application frameworks (React, Next.js, Remix).
- Operational model for a single-operator environment.

---

## Cross References

- [PROJECT_CHARTER.md](../PROJECT_CHARTER.md) — Operational mandate and boundaries
- [ENGINEERING.md](../ENGINEERING.md) — Axiom 3: Workflow > Application
- [ADR-002](ADR-002-google-sheets-over-database.md) — Google Sheets Over Database

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

The operator is a solo freelance software engineer with limited development bandwidth (evenings after college). The objective is discovering and closing high-value freelance web development clients. Early designs proposed building a custom full-stack web dashboard where the operator could log in, view prospects on Kanban boards, click interactive buttons to trigger scrapers, and manage sequences.

---

## Problem

Building an interactive web application requires substantial non-leverage engineering:
- Frontend layout, responsive CSS, state management, and UI component libraries.
- User authentication, session cookies, and API route security.
- Hosting servers, WebSocket connections for progress updates, and backend API plumbing.
- Continuous maintenance and debugging of frontend UI states.

This engineering effort would consume 3–6 weeks of part-time evenings before sending a single outreach email, without improving lead quality or close rates.

---

## Decision

We decide to build Lead Engine strictly as an **unattended batch automation workflow** executed via CLI and scheduled GitHub Actions runners, using Google Sheets as the visual interface.

```
REJECTED: Interactive Web Application
[ Next.js UI ] <---> [ Express API ] <---> [ Redis/BullMQ ] <---> [ Postgres DB ]

APPROVED: Batch Workflow
[ GitHub Actions / CLI ] ---> [ Single TypeScript Runner ] ---> [ Google Sheets ]
```

---

## Alternatives Considered

1. **Custom Next.js Web App with Tailwind UI:** High visual polish, but requires ~100 hours of frontend development and continuous hosting maintenance.
2. **Low-Code Web Dashboard (Retool / Appsmith):** Reduces frontend code, but introduces third-party platform lock-in, free-tier limitations, and connection overhead.
3. **Desktop Application (Electron / Tauri):** Complex cross-compilation and packaging overhead for zero operational benefit.

---

## Tradeoffs

### Positive:
- Eliminates 100% of frontend development, routing, and UI state code.
- Reduces time-to-first-lead from weeks to days.
- Zero server hosting maintenance.

### Negative:
- The operator cannot trigger real-time interactive UI updates through custom buttons (must use GitHub Actions `workflow_dispatch` or terminal CLI).

---

## Consequences

- All data presentation is delegated to Google Sheets.
- The entire codebase is contained within a clean, single-purpose CLI repository.
- Engineering is focused 100% on lead discovery relevance and data extraction precision.

---

## Future Reconsideration

This decision may be reconsidered only if the operator hires full-time sales development representatives (SDRs) who require strict role-based access control and cannot operate inside a shared spreadsheet. This is explicitly out of scope for Version 1.

---

## Revision History

| Version | Date | Author | Description |
| :--- | :--- | :--- | :--- |
| `1.0.0` | 2026-08-09 | Solo Operator / Lead Engineer | Approved canonical ADR-001. |
