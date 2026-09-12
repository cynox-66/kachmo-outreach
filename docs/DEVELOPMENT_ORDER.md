# Deterministic Development & File Creation Order

> **Status:** Canonical & Locked  
> **Authority:** Project Constitution & Implementation Plan  
> **Purpose:** Ensures 100% deterministic, zero-guesswork implementation flow.  

---

## The Master File Creation Sequence

Every file in the repository must be created in this exact sequence. Each step builds strictly on the types, utilities, and tested contracts of previous steps.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DEVELOPMENT SEQUENCE                            │
│                                                                        │
│  1. src/types.ts          ──► Canonical domain interfaces & Zod schemas│
│  2. src/config.ts         ──► Environment loader & budget guardrail    │
│  3. src/fetch.ts          ──► HTTP pre-flight checker & raw HTML client│
│  4. src/contact.ts        ──► Regex contact & social route extractors  │
│  5. src/qualify.ts        ──► Domain blacklist & 4-Gate Decision Tree  │
│  6. src/audit.ts          ──► Playwright mobile browser audit & layout │
│  7. src/ai.ts             ──► Gemini 3.5 multimodal structured client  │
│  8. src/sheets.ts         ──► Google Sheets API client & batch appender│
│  9. configs/queries.json  ──► Initial production sourcing query matrix │
│ 10. src/discover.ts       ──► Gemini search grounding discovery engine │
│ 11. src/run.ts            ──► Master CLI orchestration & pipeline entry│
│ 12. .github/workflows/daily.yml ──► Production GitHub Actions daily cron│
└────────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Step-by-Step Rationale

### Step 1: `src/types.ts`
- **Why First:** Defines the core vocabulary of the system (`RawCandidate`, `PreFilterResult`, `BrowserAuditResult`, `LeadEvaluation`, `CanonicalLead`, and Zod validation schemas). Every downstream module depends on these contracts.
- **Companion Test:** `tests/types.test.ts` (Validates Zod parsing against sample payloads).

### Step 2: `src/config.ts`
- **Why Second:** Loads environment variables (`GEMINI_API_KEY`, `GOOGLE_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`) and enforces the $2.50/month hard budget circuit breaker.
- **Companion Test:** `tests/config.test.ts` (Validates missing env assertions and budget thresholds).

### Step 3: `src/fetch.ts`
- **Why Third:** Implements lightweight HTTP GET requests with strict 5-second timeouts and HTML size limits before launching browser or AI.
- **Companion Test:** `tests/fetch.test.ts` (Tests status codes, timeouts, and headers).

### Step 4: `src/contact.ts`
- **Why Fourth:** Contains deterministic regex extractors for `mailto:`, contact page links, and social URLs. Needed by the qualification engine.
- **Companion Test:** `tests/contact.test.ts` (Tests regex against sample HTML snippets).

### Step 5: `src/qualify.ts`
- **Why Fifth:** Implements domain blacklist filtering, CMS detection, and the 4-Gate Decision Tree pre-filtering logic using `fetch.ts` and `contact.ts`.
- **Companion Test:** `tests/qualify.test.ts` (Tests against static agency and non-agency HTML fixtures).

### Step 6: `src/audit.ts`
- **Why Sixth:** Sets up Playwright headless Chromium mobile context (390x844px), evaluates in-browser DOM layout shifts (`scrollWidth > innerWidth`), and returns in-memory JPEG screenshot buffers.
- **Companion Test:** `tests/audit.test.ts` (Runs headless browser against local HTTP fixture).

### Step 7: `src/ai.ts`
- **Why Seventh:** Integrates Gemini 3.5 Flash-Lite multimodal API with structured JSON output matching `LeadEvaluationSchema`. Consumes screenshot buffers and DOM metrics from `audit.ts`.
- **Companion Test:** `tests/ai.test.ts` (Asserts 10 golden test fixtures with zero schema failures and zero hallucinations).

### Step 8: `src/sheets.ts`
- **Why Eighth:** Connects to Google Sheets API v4 using Service Account credentials. Reads deduplication domains from `HISTORY` tab and batch appends rows to `TODAY` and `HISTORY`.
- **Companion Test:** `tests/sheets.test.ts` (Validates 24-column row serialization).

### Step 9: `configs/queries.json`
- **Why Ninth:** Stores the initial matrix of search grounding query strings across target niches (branding, architecture, photography, packaging).

### Step 10: `src/discover.ts`
- **Why Tenth:** Implements Gemini Google Search Grounding to harvest 100–200 raw candidate domains per run using `queries.json`.
- **Companion Test:** `tests/discover.test.ts` (Tests URL normalization and search parsing).

### Step 11: `src/run.ts`
- **Why Eleventh:** Master CLI entry point that imports all modules above and orchestrates Stages A through F (Discovery ➔ Deduplication ➔ Pre-Filter ➔ Browser Audit ➔ AI Qual ➔ Sheet Append).
- **Test:** Full end-to-end dry-run with local execution (`npm run dev`).

### Step 12: `.github/workflows/daily.yml`
- **Why Last:** Schedules the daily production cron (06:00 UTC) on GitHub Actions runners with repository secrets.
