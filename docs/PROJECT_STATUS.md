# Project Status, Roadmap, Tasks & Changelog

> **Status:** Canonical & Active  
> **Architecture Lock:** LOCKED (`docs-v1.0`)  
> **Owner:** Solo Operator / Principal Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.1.0  

---

## 1. Documentation Lock & Baseline Status

- **Status:** **LOCKED (`v1.0.0`)**
- **Meaning:** The system architecture is completely frozen. Implementation begins. Documentation changes occur only when active implementation modifies production reality.
- **Git Tag:** `docs-v1.0`

---

## 2. 4-Week Implementation Roadmap

```
WEEK 1: MVP BUILD (Days 1–7)
├── Day 0: Repository initialization, governance lock, minimal CI setup. [DONE]
├── Day 1: Project setup, Google Sheets API authentication, spreadsheet schema.
├── Day 2: Sourcing engine (Gemini Google Search Grounding) & query bank.
├── Day 3: Deduplication, HTTP pre-checks, domain blacklist & contact regex.
├── Day 4: Playwright headless mobile viewport audit & screenshot extraction.
├── Day 5: Gemini 3.5 Flash-Lite multimodal qualification & JSON drafting.
├── Day 6: Google Sheets batch sync & CLI entry point (`src/run.ts`).
└── Day 7: First Validation Milestone (100 candidate batch, >= 80% precision).

WEEKS 2–4: SOLIDIFICATION & OUTCOME CALIBRATION
├── Week 2: Deploy daily GitHub Actions cron (06:00 UTC) & test deliverability.
├── Week 3: Measure reply rates; calibrate queries in SOURCES tab.
└── Week 4: Economic ROI audit. If >= 1 client closed: lock in zero-maintenance mode.
```

---

## 3. Engineering Task Board

### Current Sprint: Week 1 MVP
- [x] Day 0: Repository initialized, minimal CI configured, governance locked
- [x] Milestone 0: Core types, constants, config validation, logger (`src/config/`, `src/types.ts`)
- [x] Milestone 1: Deduplication, HTTP pre-flight & deterministic qualification (`src/dedupe.ts`, `src/fetch.ts`, `src/qualify.ts`)
- [x] Milestone 2: Playwright mobile audit & DOM evidence collection (`src/audit.ts`)
- [x] Milestone 3: Gemini multimodal evaluation, budget enforcement & prompt versioning (`src/evaluate/`)
- [x] Milestone 4: Google Sheets persistence, batch sync & JSON fallback (`src/sheets/`)
- [x] Milestone 5: Discovery engine via search grounding (`src/discover/`)
- [x] Milestone 6: Pipeline orchestrator, master CLI runner & alternate-day cron (`src/pipeline/`, `src/run.ts`, `.github/workflows/daily.yml`)
- [ ] Milestone 7: First Validation Milestone batch (verify $\ge 80\%$ precision) — **blocked on live credentials**

### Blocked
- Milestone 7 requires `GEMINI_API_KEY`, `GOOGLE_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and `GOOGLE_PRIVATE_KEY` in a local `.env` and as GitHub Actions repository secrets.

### Backlog (Phase 2 & 3 Enhancements)
- [ ] Optional PageSpeed Insights API client (`src/pagespeed.ts`)
- [ ] Local JSON artifact export fallback for offline batch recovery
- [ ] Automated weekly audit scorecard generator script

---

## 4. Master Changelog

### [1.3.0] — 2026-08-09 — Production readiness pass
- **Added:** Pre-flight health checks (`src/preflight.ts`, `npm run check`) covering credentials, Chromium, spreadsheet tabs, and artifact writability. The run aborts before any API spend if a check fails.
- **Added:** Per-run stage snapshots in `artifacts/YYYY-MM-DD/run-<runId>/` (`src/artifacts.ts`) — screenshots, raw HTML, and prompts are excluded.
- **Added:** Run plan banner and a "where the leads went" completion summary in the CLI.
- **Fixed:** Audit had no wall-clock ceiling; a hung `page.evaluate` could stall a worker indefinitely. A watchdog now enforces `PLAYWRIGHT_TOTAL_AUDIT_MS` (raised to 75s to fit the retry path).
- **Fixed:** Gemini API key was sent as a URL query parameter, where it can leak into error objects and logs. Now sent via `x-goog-api-key`.
- **Fixed:** `MAX_TOKENS` responses were treated as success, surfacing as opaque JSON parse errors.
- **Fixed:** A HISTORY append failure after a successful TODAY write was reported as a total failure and duplicated leads into a fallback file.
- **Fixed:** `TARGET_CANDIDATE_COUNT` and `HEADLESS_TIMEOUT_MS` were parsed but never used; both are now enforced.
- **Fixed:** A breached budget failed each candidate individually instead of cancelling the run.
- **Fixed:** Sheets retry timers were never cleared, holding the event loop open after every call.
- **Fixed:** HTTP fetch had no `maxContentLength` and retried DNS failures; the discovered business name was discarded, leaving the operator's `name` column filled with the AI's business type.

### [1.2.0] — 2026-08-09
- **Implemented Milestones 0–6:** Core foundation, deterministic qualification, Playwright audit, Gemini evaluation, Sheets persistence, discovery engine, and the pipeline orchestrator connecting Stages A–F.
- **Added:** Master CLI runner (`src/run.ts`) with `--concurrency`, `--run-id`, `--no-sheets`, `--verbose`, and `--help`; non-fatal handling of SOURCES/HISTORY read failures.
- **Added:** GitHub Actions cron (`.github/workflows/daily.yml`) at 06:00 UTC with `workflow_dispatch`, a 30-minute timeout, and fallback-artifact upload. Moved from daily to alternate-day (Mon/Wed/Fri) on 2026-09-10 — see the note in the workflow.
- **Fixed:** `.env.example` declared `TARGET_CANDIDATES_PER_RUN`, which the config schema never reads — renamed to `TARGET_CANDIDATE_COUNT`.

### [1.1.0] — 2026-08-09
- **Refactored Documentation Architecture:** Reduced documentation footprint by 70% (from 74 fragmented files into 15 cohesive, production-grade master documents) without losing any technical depth, trade-offs, schemas, or playbooks.
- **Added:** Pre-commit checklist, Definition of Done, Decision Journal, Feature Evaluation Rubric, and Master Playbooks.

### [1.0.0] — 2026-08-09
- **Initial Canonical Release:** Baseline architecture locked with Single TS CLI, Playwright, Gemini 3.5 Flash-Lite, Google Sheets, and manual Gmail dispatch. Tagged `docs-v1.0`.
