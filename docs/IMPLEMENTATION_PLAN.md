# Lead Engine: Master Implementation Plan

> **Status:** Canonical & Locked  
> **Authority:** Project Constitution & Definition of Ready  
> **Execution Horizon:** 7 Sequential Milestones (Days 1–7)  

---

## Milestone 0: Environment & Core Types Foundation

- **Objective:** Establish the runtime environment, environment configuration validator, and canonical domain types.
- **Deliverables:**
  - TypeScript domain interfaces for `RawCandidate`, `PreFilterResult`, `BrowserAuditResult`, `LeadEvaluation`, and `CanonicalLead`.
  - Environment variable loader and hard budget circuit breaker.
- **Files to Create:**
  - `src/types.ts`
  - `src/config.ts`
  - `tests/config.test.ts`
- **Dependencies:** `dotenv`, `zod`
- **Acceptance Criteria:**
  - `config.ts` parses `.env` and enforces non-empty `GEMINI_API_KEY`, `GOOGLE_SPREADSHEET_ID`, and `GOOGLE_SERVICE_ACCOUNT_EMAIL`.
  - Budget guardrail tracks spend and throws/halts if spend exceeds `$2.50`.
  - All domain schemas compile with strict TypeScript mode (`npx tsc --noEmit`).
- **Definition of Done:** Passes 100% of unit tests in `tests/config.test.ts`, zero TypeScript errors, zero lint warnings.
- **Estimated Time:** 1.5 Hours (Evening 1)
- **Potential Risks:** Missing environment variables or malformed RSA private keys in `.env`.
- **Testing Strategy:** Vitest unit tests verifying valid config parsing, invalid config rejection, and budget threshold halts.
- **Expected Output:** Validated configuration module ready for all downstream consumers.

---

## Milestone 1: Deduplication & Deterministic Pre-Filters

- **Objective:** Implement zero-cost HTTP pre-checking, domain blacklisting, CMS detection, and contact regex extraction.
- **Deliverables:**
  - Fast HTTP GET pre-flight client with strict 5-second timeout and 2KB–5MB content size validation.
  - Domain blacklist filter and commercial signal regex heuristics.
  - Regex contact extractor for `mailto:` links, `/contact` URLs, and social profiles.
- **Files to Create:**
  - `src/fetch.ts`
  - `src/contact.ts`
  - `src/qualify.ts`
  - `tests/qualify.test.ts`
  - `tests/fixtures/sample_agency.html`
  - `tests/fixtures/sample_blog.html`
- **Dependencies:** `axios`, `cheerio`
- **Acceptance Criteria:**
  - Drops blacklisted domains (`clutch.co`, `instagram.com`, `yelp.com`, `gov`, `edu`).
  - Drops HTTP 404, 500, non-HTML responses, and timeouts without crashing.
  - Extracts clean `mailto:` addresses without trailing query parameters.
- **Definition of Done:** 100% passing tests in `tests/qualify.test.ts` across static HTML fixtures; zero unhandled promise rejections.
- **Estimated Time:** 2.0 Hours (Evening 2)
- **Potential Risks:** Slow or hanging HTTP requests on dead candidate domains.
- **Testing Strategy:** Vitest unit tests executing against local HTML mock fixtures.
- **Expected Output:** Filtered candidate array with HTTP status, tech stack hint, contact routes, and pre-filter verdicts.

---

## Milestone 2: Headless Browser Auditing (Playwright)

- **Objective:** Render candidate sites in headless Chromium (iPhone 390x844px), inspect client DOM layout metrics, and capture in-memory JPEG screenshot buffers.
- **Deliverables:**
  - Mobile browser context factory with route aborts for media, fonts, and analytics.
  - Client-side DOM layout evaluation script detecting horizontal overflow (`scrollWidth > innerWidth + 5`).
  - In-memory JPEG buffer screenshot capture without filesystem or cloud storage persistence.
- **Files to Create:**
  - `src/audit.ts`
  - `tests/audit.test.ts`
- **Dependencies:** `playwright`
- **Acceptance Criteria:**
  - Navigates to target URL within a 10-second hard timeout.
  - Properly detects overflow on test pages with wide fixed-width elements.
  - Browser page and context are reliably closed in `finally` blocks (zero leaked processes).
- **Definition of Done:** End-to-end browser audit executes in $< 4.0\text{s}$ per site with zero hanging Chromium instances.
- **Estimated Time:** 2.5 Hours (Evening 3)
- **Potential Risks:** Memory leaks from unclosed browser contexts or zombie Chromium child processes.
- **Testing Strategy:** Vitest integration test against local HTTP test server serving overflow and non-overflow HTML pages.
- **Expected Output:** `BrowserAuditResult` containing layout metrics and JPEG buffer.

---

## Milestone 3: Multimodal AI Qualification & Structured Drafting

- **Objective:** Integrate Gemini 3.5 Flash-Lite to evaluate mobile screenshots, DOM metrics, and generate strictly structured outreach copy.
- **Deliverables:**
  - Gemini API client wrapper enforcing `gemini-3.5-flash-lite` and structured JSON response mode.
  - Integration of `prompts/qualify.md` system prompt with strict Zod schema validation.
  - Zero-tolerance anti-hallucination guardrail enforcing empirical DOM/screenshot citations.
- **Files to Create:**
  - `src/ai.ts`
  - `tests/ai.test.ts`
- **Dependencies:** `@google/generative-ai`, `zod`
- **Acceptance Criteria:**
  - 100% of AI responses parse cleanly into `LeadEvaluationSchema`.
  - Rejection reasons are populated when Gate 1, 2, or 3 fails.
  - Generated draft copy is strictly under 120 words and cites verified evidence.
- **Definition of Done:** Passes all 10 Golden Benchmark test fixtures with zero schema failures and zero hallucinated claims.
- **Estimated Time:** 2.5 Hours (Evening 4)
- **Potential Risks:** Gemini API rate limit throttling (15 RPM free tier) or schema parsing errors.
- **Testing Strategy:** Vitest tests against golden screenshot/DOM fixtures with schema assertion.
- **Expected Output:** `LeadEvaluation` object containing qualification boolean, priority score (0–10), and draft subject/body.

---

## Milestone 4: Google Sheets Persistence & CRM Sync

- **Objective:** Connect to Google Sheets API v4 using Service Account credentials to read deduplication history and batch append qualified leads.
- **Deliverables:**
  - Google Sheets API client with batch append to `TODAY` and `HISTORY` tabs.
  - Deduplication loader reading all domains from `HISTORY` into an in-memory `Set<string>`.
  - Local JSON artifact fallback writer in `./artifacts/leads-YYYY-MM-DD.json` if API fails.
- **Files to Create:**
  - `src/sheets.ts`
  - `tests/sheets.test.ts`
- **Dependencies:** `googleapis`
- **Acceptance Criteria:**
  - Reads existing domains from `HISTORY` tab within 1 API request.
  - Appends 30–50 rows to `TODAY` and `HISTORY` in a single batched `spreadsheets.values.append` call.
  - Properly formats 24 columns according to [DATA.md](DATA.md).
- **Definition of Done:** Verified row insertion in production Google Spreadsheet with correct column headers and dropdown values.
- **Estimated Time:** 2.0 Hours (Evening 5)
- **Potential Risks:** Google Cloud Service Account permission errors (Editor role required on Sheet).
- **Testing Strategy:** Mock API tests for batch serializer and live integration test against dedicated test spreadsheet.
- **Expected Output:** Clean synchronization of qualified leads to Google Sheets.

---

## Milestone 5: Sourcing & Search Grounding Engine

- **Objective:** Harvest 100–200 raw website candidate domains daily using Gemini Google Search Grounding and static showcase scrapers.
- **Deliverables:**
  - Search Grounding discovery module executing queries from `configs/queries.json` and `SOURCES` tab.
  - URL normalizer and domain canonicalizer stripping protocols, paths, and `www.`.
- **Files to Create:**
  - `src/discover.ts`
  - `configs/queries.json`
  - `tests/discover.test.ts`
- **Dependencies:** `@google/generative-ai`
- **Acceptance Criteria:**
  - Discovers 15–20 distinct independent studio domains per query execution.
  - Automatically filters out directory domains (`clutch.co`, `behance.net`, `linkedin.com`).
- **Definition of Done:** Yields $\ge 100$ raw candidates across 5 active query batches in under 60 seconds.
- **Estimated Time:** 2.0 Hours (Evening 6)
- **Potential Risks:** Search queries returning duplicate aggregator directories.
- **Testing Strategy:** Unit test asserting URL normalization and mock grounding response parsing.
- **Expected Output:** Array of `RawCandidate` objects ready for pre-filtering.

---

## Milestone 6: Master CLI Orchestration & GitHub Actions Cron

- **Objective:** Orchestrate Stages A through F into a single executable command (`src/run.ts`) and configure daily automated execution.
- **Deliverables:**
  - Master pipeline CLI entry point orchestrating Discovery ➔ Pre-Filter ➔ Audit ➔ AI ➔ Persistence.
  - Progress logging, batch timing metrics, and error containment.
  - GitHub Actions scheduled workflow (`.github/workflows/daily.yml`) running at 06:00 UTC.
- **Files to Create:**
  - `src/run.ts`
  - `.github/workflows/daily.yml`
- **Dependencies:** `tsx`
- **Acceptance Criteria:**
  - Single terminal command `npm run dev` executes entire pipeline end-to-end.
  - Total batch execution completes in under 15 minutes for a 40-candidate batch.
  - Failures on individual URLs do not crash the entire batch (isolated try/catch blocks).
- **Definition of Done:** Clean execution in GitHub Actions runner with zero manual intervention and successful write to `TODAY` tab.
- **Estimated Time:** 2.5 Hours (Evening 7)
- **Potential Risks:** GitHub Actions runner timeout or missing secret environment variables.
- **Testing Strategy:** Full local dry-run with 10 candidates followed by a manual `workflow_dispatch` run in GitHub Actions.
- **Expected Output:** Fully automated daily lead delivery into Google Sheets.

---

## Milestone 7: First Validation Milestone Run & Acceptance

- **Objective:** Execute a live production batch of 100 raw candidates, inspect the resulting ~30 qualified leads in Google Sheets, and verify the 80% Operator Precision Rule.
- **Deliverables:**
  - Completed `TODAY` tab with 30–50 qualified, priority-ranked prospects.
  - Conducted first 30-minute evening manual review and dispatch session.
  - Verified precision rate $\ge 80\%$ (at least 24 approved leads).
- **Files to Update:**
  - `docs/PROJECT_STATUS.md` (Update task board and changelog)
- **Dependencies:** Live production environment
- **Acceptance Criteria:**
  - $\ge 80\%$ of surfaced leads in `TODAY` are approved for outreach.
  - Operator completes review and dispatch in $\le 30$ minutes.
  - Total billed API spend stays at or under the **$2.00** monthly soft cap.
- **Definition of Done:** Milestone 7 signed off by solo operator; pipeline transitioned to daily unattended cron.
- **Estimated Time:** 1.0 Hour (Review Session)
- **Potential Risks:** Search query drift producing low-fit niches (remedied via `configs/queries.json`).
- **Testing Strategy:** Empirical human inspection in Google Sheets.
- **Expected Output:** Active, validated client prospecting engine running alternate-day (Mon/Wed/Fri) at ~$1.38/month.
