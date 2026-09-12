# Technical Architecture Specification

> **Status:** Canonical & Active  
> **Owner:** Solo Operator / Principal Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## 1. System Topology & Architecture

Lead Engine is engineered as a **deterministic-first, multimodal-augmented batch pipeline** executed inside an ephemeral Ubuntu runner on GitHub Actions.

```mermaid
graph TB
    subgraph GHA["GitHub Actions Scheduled Runner (Ubuntu Headless)"]
        CLI["src/run.ts (Master CLI Orchestration)"]
        
        subgraph MODULES["Core TypeScript Modules (src/)"]
            DISC["src/discover.ts<br/>(Sourcing Engine)"]
            FETCH["src/fetch.ts<br/>(HTTP Pre-Checker)"]
            QUAL["src/qualify.ts<br/>(Rule Engine & Gating)"]
            AUDIT["src/audit.ts<br/>(Playwright Chromium)"]
            AI["src/ai.ts<br/>(Gemini 3.5 Structured Client)"]
            SHEETS["src/sheets.ts<br/>(Google Sheets API Client)"]
            CONF["src/config.ts<br/>(Budget Guardrail & Envs)"]
        end
        
        CLI --> DISC
        CLI --> FETCH
        CLI --> QUAL
        CLI --> AUDIT
        CLI --> AI
        CLI --> SHEETS
    end

    subgraph EXT_APIS["External Free-Tier Services"]
        GEM_API["Google Gemini API<br/>• Search Grounding<br/>• 2.5 Flash-Lite Multimodal"]
        SHEETS_API["Google Sheets API v4<br/>• Batch Appends"]
        PAGESPEED_API["PageSpeed API<br/>• Core Web Vitals (Optional)"]
        WEB_TARGETS["Candidate Websites<br/>• Raw HTML & Mobile DOM"]
    end

    DISC <-->|Search Grounding| GEM_API
    FETCH <-->|HTTP GET| WEB_TARGETS
    AUDIT <-->|Headless Mobile Session| WEB_TARGETS
    AUDIT -.->|Optional LCP/CLS| PAGESPEED_API
    AI <-->|Multimodal JSON Prompt| GEM_API
    SHEETS <-->|OAuth2 Service Account| SHEETS_API

    subgraph STORAGE["Persistence & Interface"]
        GSHEET["Google Spreadsheet<br/>├── TODAY (Active Leads)<br/>├── HISTORY (Deduplication Index)<br/>├── OUTCOMES (CRM Tracker)<br/>└── SOURCES (Query Config)"]
    end

    SHEETS_API <--> GSHEET

    subgraph HUMAN["Solo Operator Interface"]
        OPERATOR(("Human Operator<br/>(30m Evening Session)"))
        GMAIL["Native Gmail Web/Mobile<br/>(100% Manual Dispatch)"]
    end

    GSHEET -->|Read Ranked Leads| OPERATOR
    OPERATOR -->|1-Click Copy & Customize| GMAIL
    OPERATOR -->|Update Status (SENT/REJECTED)| GSHEET
```

---

## 2. Module Architecture & Subsystems

The codebase is organized as a single TypeScript CLI with strict modular separation:

```
lead-engine/
├── .github/workflows/daily.yml  # GitHub Actions cron (Mon/Wed/Fri 06:00 UTC)
├── src/
│   ├── config.ts                # Environment variables, budget limits, constants
│   ├── types.ts                 # Domain interfaces & Zod validation schemas
│   ├── discover.ts              # Sourcing via search grounding & static scrapers
│   ├── fetch.ts                 # HTTP client & raw HTML retrieval
│   ├── qualify.ts               # Deterministic rules & 4-Gate Decision Tree
│   ├── audit.ts                 # Playwright browser automation & layout extraction
│   ├── pagespeed.ts             # PageSpeed Insights API client (optional)
│   ├── ai.ts                    # Gemini 3.5 Flash-Lite multimodal structured client
│   ├── contact.ts               # Regex/DOM contact information extractors
│   ├── sheets.ts                # Google Sheets API client (TODAY/HISTORY sync)
│   └── run.ts                   # Master CLI entry point orchestrating Stages A–F
└── tests/                       # Vitest unit test suites and HTML fixtures
```

---

## 3. Subsystem Specifications & Interfaces

### 1. Configuration & Budget Guardrail (`src/config.ts`)
```typescript
export interface AppConfig {
  geminiApiKey: string;
  googleServiceAccountEmail: string;
  googlePrivateKey: string;
  spreadsheetId: string;
  monthlyBudgetUsd: number;      // Hard ceiling: 2.50
  targetCandidateCount: number;  // Default: 40
  playwrightTimeoutMs: number;   // Default: 10000
}
```

### 2. Sourcing & Discovery (`src/discover.ts`)
```typescript
export interface RawCandidate {
  domain: string;
  url: string;
  source: 'google_search_grounding' | 'directory_showcase' | 'manual_entry';
  sourceQuery?: string;
  discoveredAt: string;
}
export async function discoverCandidates(config: AppConfig): Promise<RawCandidate[]>;
```

### 3. Rule Engine & Pre-Filtering (`src/qualify.ts`, `src/fetch.ts`)
```typescript
export interface PreFilterResult {
  candidate: RawCandidate;
  passed: boolean;
  httpStatus?: number;
  techStackHint?: string;
  rejectionReason?: string;
  rawHtml?: string;
}
export async function preFilterCandidate(candidate: RawCandidate): Promise<PreFilterResult>;
```

### 4. Headless Browser Audit (`src/audit.ts`)
```typescript
export interface BrowserAuditResult {
  domain: string;
  screenshotBuffer: Buffer;
  hasHorizontalOverflow: boolean;
  viewportWidth: number;
  renderedWidth: number;
  domElementCount: number;
  detectedCms: string;
  contactRoutes: {
    emails: string[];
    contactPageUrls: string[];
    socialLinks: string[];
  };
}
export async function auditWithBrowser(url: string): Promise<BrowserAuditResult>;
```

### 5. Multimodal AI Evaluation (`src/ai.ts`)
```typescript
export interface LeadEvaluation {
  qualified: boolean;
  rejectionReason?: string | null;
  businessType: string;
  fitLevel: 'high' | 'medium' | 'low';
  commercialSignal: number;  // 0-3
  needSeverity: number;      // 0-3
  reachabilityScore: number; // 0-2
  priorityScore: number;     // 0-10
  issues: Array<{
    type: 'mobile_layout' | 'performance' | 'positioning' | 'technical';
    evidence: string;
  }>;
  pitchAngle: string;
  summary: string;
  draftSubject: string;
  draftBody: string;
}
export async function evaluateLeadWithAI(audit: BrowserAuditResult, preFilter: PreFilterResult): Promise<LeadEvaluation>;
```

---

## 4. Headless Browser & AI Design

- **Playwright Configuration:** Headless Chromium emulating iPhone 13/14/15 (`390x844px`, `deviceScaleFactor: 2`, `hasTouch: true`). Network routes block heavy video, audio, and tracking scripts to keep audit time under 4s per site.
- **In-Memory Screenshot Policy:** JPEG screenshot buffers (`quality: 75`) are held in memory during the execution step, streamed to Gemini API, and garbage collected immediately without saving to local disk or cloud object storage.
- **Single-Pass Multimodal Model:** `gemini-3.5-flash-lite` evaluates the screenshot, DOM layout metrics, and business context in a single atomic call, returning strictly validated JSON matching `LeadEvaluationSchema`.

---

## 5. Resilience, Circuit Breakers & Fallbacks

```typescript
// Budget Circuit Breaker in src/config.ts
let estimatedSpendUsd = 0.00;
export function trackSpend(costUsd: number) {
  estimatedSpendUsd += costUsd;
  if (estimatedSpendUsd > config.monthlyBudgetUsd) {
    console.error(`[BUDGET GUARDRAIL] Monthly budget ($${config.monthlyBudgetUsd}) exceeded! Halting execution.`);
    process.exit(0);
  }
}
```

1. **Network Timeouts:** Strict 5s HTTP and 15s Playwright navigation timeouts, under a 95s per-site watchdog.
2. **Sheet Write Fallback:** If Google Sheets API experiences transient failure, `CanonicalLead[]` is serialized to `./artifacts/leads-YYYY-MM-DD.json` and saved as a GitHub Actions workflow artifact.
3. **Graceful Quota Degradation:** If optional PageSpeed API fails or throttles, pipeline continues using DOM and screenshot evidence.
