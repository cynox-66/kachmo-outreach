# Lead Engine — Production Engineering Documentation

> [!WARNING]
> **Historical document — this is not the system in this repository.** It describes the original "Lead Engine" plan
> (Google Sheets as the database, Gemini, Playwright, "never build a custom dashboard"), which was never built. The
> system here is the **Outbound OS**: a Next.js application over Postgres around the `core/` engine, with Titan owning
> email. Start with the current documents instead:
> [`OPERATOR_EXPERIENCE.md`](OPERATOR_EXPERIENCE.md) (how it is used) ·
> [`../os/README.md`](../os/README.md) (how it is built and run) ·
> [`../audit/PRODUCTION_AUDIT_2026-09-22.md`](../audit/PRODUCTION_AUDIT_2026-09-22.md) (current state and risks) ·
> [`adr/`](adr/) (ADR-009 onwards are current).


> **Status:** Canonical & Locked  
> **Architecture Lock:** LOCKED (`v1.0.0`)  
> **Readiness Score:** 100 / 100 (Implementation Ready)  
> **Owner:** Solo Operator / Principal Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## Current documents (the Outbound OS)

| Read this | For |
| :-- | :-- |
| [`OPERATOR_EXPERIENCE.md`](OPERATOR_EXPERIENCE.md) | How the app is used: the seven operator questions, every screen, safety by design, the glossary |
| [`DESIGN_LANGUAGE.md`](DESIGN_LANGUAGE.md) | The Kachmo visual language as applied to the app: tokens, contrast, type, components |
| [`REDESIGN_PLAN.md`](REDESIGN_PLAN.md) | The 2026-09-22 redesign: sequence, boundaries, tests, verification, owner decisions |
| [`../audit/PRODUCTION_AUDIT_2026-09-22.md`](../audit/PRODUCTION_AUDIT_2026-09-22.md) | The hostile production audit: findings, severities, what was fixed, what was not |
| [`PHASE_C_D_E_MASTER_PLAN.md`](PHASE_C_D_E_MASTER_PLAN.md) · [`../audit/OUTBOUND_OS_PHASE_B_AUDIT.md`](../audit/OUTBOUND_OS_PHASE_B_AUDIT.md) | The write path, the operating loop, evidence, jobs; the production runbook |
| [`adr/`](adr/) ADR-009 → ADR-036 | The decisions the current system rests on |
| [`../os/README.md`](../os/README.md) | Building, testing and running the app |

Everything below this section is the historical Lead Engine plan.

---

## 🚦 Project Status Summary

| Area | Status | Reference Document |
| :--- | :--- | :--- |
| **Documentation** | ✅ **Complete** | [docs/README.md](README.md) |
| **Architecture** | ✅ **Frozen (`docs-v1.0`)** | [PROJECT_STATUS.md](PROJECT_STATUS.md) |
| **Research** | ✅ **Complete** | [research/](research/) |
| **Implementation**| 🟡 **Ready to Begin (Milestone 0)** | [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) |
| **Version** | **1.0.0** | `VERSION` |

---

## Master Documentation Portal

```
docs/
├── README.md                          # Master documentation portal (This document)
├── START_HERE.md                      # Executive onboarding, 5-minute primer & glossary
├── IMPLEMENTATION_PLAN.md             # Master 7-milestone engineering execution plan
├── DEVELOPMENT_ORDER.md               # Deterministic 12-step file creation sequence
├── DEFINITION_OF_READY.md             # Implementation readiness verification gate (100/100)
├── PROJECT_CHARTER.md                 # Problem statement, research synthesis & product vision
├── ARCHITECTURE.md                    # System topology, module interfaces & error boundaries
├── ENGINEERING.md                     # Constitution, mantras, DoD, checklist & decision rubric
├── IMPLEMENTATION.md                  # Playwright config, tech stack, Vitest testing & cost model
├── DISCOVERY_AND_QUALIFICATION.md     # Sourcing engine, pre-filters, 4-Gate Tree & priority scoring
├── AI_SYSTEM.md                       # Multimodal Gemini 3.5, system prompts, schemas & guardrails
├── DATA.md                            # Canonical Lead Object & 24-column Google Sheets CRM
├── WORKFLOW.md                        # 30-Minute daily review manual & pipeline execution sequence
├── OPERATIONS.md                      # Conversion math, 80% precision rule & health dashboard
├── OUTREACH.md                        # Copywriting commandments, templates A/B/C & learning loop
├── PLAYBOOKS.md                       # Lead archetypes, vertical playbooks, query banks & demo specs
├── PROJECT_STATUS.md                  # 4-Week roadmap, task tracking board & changelog
├── PROJECT_BOUNDARIES.md              # Risk register, 6-month failure forecast & non-goals
│
├── adr/                               # Architecture Decision Records (ADR-001 to 008)
│   ├── ADR-001-workflow-over-application.md
│   ├── ADR-002-google-sheets-over-database.md
│   ├── ADR-003-playwright-over-stagehand.md
│   ├── ADR-004-human-in-the-loop.md
│   ├── ADR-005-zero-cost-architecture.md
│   ├── ADR-006-rules-before-ai.md
│   ├── ADR-007-single-script-architecture.md
│   └── ADR-008-no-autonomous-outreach.md
│
└── research/                          # Canonical Research & Review Reports
```

---

## Core Mantras

```
Money > Architecture.
Rules > AI.
Workflow > Application.
Evidence > Assumptions.
Delete before adding.
Google Sheets is your database.
Humans send messages.
~$1.38 / month operating budget ($2.00 soft cap, $2.50 hard cap).
```
