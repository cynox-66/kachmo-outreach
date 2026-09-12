# Start Here: Executive Onboarding & System Guide

> **Status:** Canonical & Active  
> **Audience:** Senior / Principal Engineer & Solo Operator  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## 1. Executive Summary: What is Lead Engine?

**Lead Engine** is an internal, near-zero-cost automated prospect discovery and qualification workflow designed for a single freelance web developer.

It solves the client prospecting bottleneck by running a daily scheduled batch that scans candidate websites, performs deterministic pre-filtering, captures mobile layout metrics with Playwright, extracts concrete defects using Gemini 3.5 Flash-Lite, and delivers **30–50 priority-ranked opportunities** into a unified Google Sheet.

The human operator spends **≤ 30 minutes each evening** reviewing pre-drafted emails, personalizing one sentence, and dispatching outreach manually via Gmail.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CORE OPERATIONAL CONTRACT                       │
│                                                                        │
│ • Target Operating Cost:  ~$1.38 / month (Hard ceiling: $2.50/month)   │
│ • Operator Time / Run:    ≤ 30 minutes (Evening review ritual)         │
│ • Output Volume / Run:    30–50 qualified leads in Google Sheets       │
│ • Outreach Delivery:      100% manual dispatch from native Gmail       │
│ • Architecture Model:     Single TypeScript runner in GitHub Actions   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. The 5-Minute System Walkthrough

```
[ Scheduled Batch (GitHub Actions / 06:00 UTC) ]
                       │
                       ▼
[ Discovery (Gemini Grounded Search / Directories) ]  ──► 100–200 Raw URLs
                       │
                       ▼
[ Deduplication & Cheap Rules (HTTP/HTML/Regex) ]     ──► 50–80 Survivors
                       │
                       ▼
[ Browser Inspection (Playwright Mobile 390px) ]      ──► Layout Metrics + JPEG
                       │
                       ▼
[ AI Qualification & Evidence Audit (Gemini 3.5) ]   ──► 30–50 Qualified Leads
                       │
                       ▼
[ Batch Sync to Google Sheets ("TODAY" Tab) ]
                       │
                       ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 30-MINUTE EVENING OPERATOR WORKFLOW (Human-in-the-Loop)                │
│ 1. Open Google Sheets "TODAY" View & Gmail in split screen.            │
│ 2. Review 30–50 ranked opportunities (36–60 seconds per lead).         │
│ 3. Verify cited technical flaw & copy pre-generated AI draft.          │
│ 4. Personalize 1 line in Gmail & hit Send.                             │
│ 5. Mark status as SENT in Google Sheets.                               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The 10 Governing Axioms

1. **Money > Architecture:** Build only what directly accelerates client acquisition and revenue.
2. **Rules > AI:** Compute deterministic checks (HTTP, DOM overflow, regex) before calling any LLM.
3. **Workflow > Application:** Use Google Sheets as database and UI; never build custom web dashboards.
4. **Evidence > Assumptions:** Never assert a website defect without empirical DOM or screenshot proof.
5. **One Script > Microservices:** A single TypeScript CLI replaces multi-container orchestration.
6. **Google Sheets > Database:** Google Sheets handles CRM, review UI, and storage under 10k rows at $0.
7. **Manual Approval > Automated Outreach:** Never automate email sending; humans send messages.
8. **Batch Execution > Continuous Queues:** Run once per scheduled day in batch rather than complex streaming queues.
9. **Queries > Platform Scrapers:** Use search grounding and open web queries; never fight anti-bot arms races.
10. **Revenue > Infrastructure:** Keep operating expenses under $2.00/month until sustained client revenue funds expansion.

---

## 4. Documentation Navigator: Where to Go Next

| What are you trying to do? | Document to Read | Core Content |
| :--- | :--- | :--- |
| Understand project origin, vision & constraints | [PROJECT_CHARTER.md](PROJECT_CHARTER.md) | Problem statement, research synthesis, non-goals |
| Review system architecture & technical design | [ARCHITECTURE.md](ARCHITECTURE.md) | Monolith CLI, module interfaces, sequence diagrams |
| Understand the rules, constitution & checklists | [ENGINEERING.md](ENGINEERING.md) | Supreme law, mantras, DoD, pre-commit checklist |
| Inspect runtime tech stack, Playwright & tests | [IMPLEMENTATION.md](IMPLEMENTATION.md) | Package manifest, browser config, Vitest suites |
| Understand how leads are found & qualified | [DISCOVERY_AND_QUALIFICATION.md](DISCOVERY_AND_QUALIFICATION.md) | Sourcing queries, 4-Gate Decision Tree, 0–10 scoring |
| Review Gemini multimodal AI & prompt templates | [AI_SYSTEM.md](AI_SYSTEM.md) | System prompts, JSON schemas, anti-hallucination |
| Inspect database schemas & Google Sheets CRM | [DATA.md](DATA.md) | Canonical Lead Object, 24-column Sheet mapping |
| Learn the 30-minute daily review ritual | [WORKFLOW.md](WORKFLOW.md) | Operator review manual & state machine |
| Audit conversion metrics, validation & health | [OPERATIONS.md](OPERATIONS.md) | 80% precision rule, weekly review, health states |
| Review cold email templates & pitch angles | [OUTREACH.md](OUTREACH.md) | Templates A/B/C, Gmail protocol, feedback loop |
| Access search queries, playbooks & demo specs | [PLAYBOOKS.md](PLAYBOOKS.md) | Query banks, industry playbooks, demo templates |
| Check project roadmap, tasks & changelog | [PROJECT_STATUS.md](PROJECT_STATUS.md) | Locked status, 4-week roadmap, task board |
| Review risks, failure modes & non-goals | [PROJECT_BOUNDARIES.md](PROJECT_BOUNDARIES.md) | 6-month failure forecast & rejected technologies |
| Review formal Architecture Decision Records | [adr/](adr/) | ADR-001 through ADR-008 |

---

## 5. Canonical Glossary

- **Raw Candidate:** A discovered URL identified via search index grounding before pre-filtering.
- **Qualified Lead:** A website that has passed all 4 gates of the Decision Tree (Fit, Commercial, Need, Reach).
- **Priority Score:** A 0–10 integer ranking used *only* to sort qualified leads in Google Sheets.
- **Deterministic Rule Engine:** Zero-cost code heuristics (HTTP status, regex, DOM metrics) executed before AI.
- **Empirical Evidence:** Measured layout data (e.g. `scrollWidth: 442px > innerWidth: 390px`, `LCP: 5.8s`).
- **Pitch Angle:** The strategic wedge for outreach (`mobile_portfolio_experience`, `performance_and_speed`, `modern_cms_migration`, `conversion_and_clarity`).
- **Review Session:** The 30-minute evening window where the operator reviews leads and dispatches emails in Gmail.
