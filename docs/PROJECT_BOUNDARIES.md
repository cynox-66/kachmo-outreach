# Project Boundaries, Non-Goals & Failure Analysis

> **Status:** Canonical & Active  
> **Owner:** Solo Operator / Principal Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## 1. Explicit Non-Goals & Rejected Architectures

Strategy is as much about deciding what **NOT** to build as it is about deciding what to build. The following systems are permanently rejected for Version 1:

| Excluded System | Proposed Purpose | Reason for Rejection | Canonical Alternative |
| :--- | :--- | :--- | :--- |
| **n8n / Railway / Docker** | Workflow & container ops | High monthly cost ($40/mo) & server ops | Ephemeral GitHub Actions runner |
| **Supabase / PostgreSQL** | Relational database | Unnecessary migration & connection ops | Google Sheets API v4 ($0/mo) |
| **Stagehand / Skyvern** | AI browser navigation | Nondeterministic, slow (30s), token heavy | Plain Playwright TypeScript (<4s) |
| **Hunter / Apollo** | Paid email enrichment | Violates $0 budget; DOM has contact info | Deterministic regex contact extractors |
| **Instantly / Lemlist** | Cold email sequencing | High spam risk & burned domain trust | Manual 1-click send in native Gmail |
| **Cloudflare R2 / S3** | Screenshot storage | Unnecessary cloud storage billing | In-memory JPEG buffers |
| **Custom Web Dashboard** | React / Next.js CRM UI | Weeks of non-leverage frontend work | Native Google Sheets web & mobile UI |
| **Cold Demo Generators** | Unsolicited client mockups| Wastes 5 hours/day building unread demos| Demos built only upon positive reply |

---

## 2. Comprehensive Risk Register

| Risk ID | Risk Description | Severity | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **R-01** | Target website blocks browser (403/CAPTCHA) | Low | Drop lead immediately; do not build proxy bypass. |
| **R-02** | AI model hallucinates non-existent design defect | High | Enforce DOM layout proof; operator reviews before send. |
| **R-03** | Google Sheets API rate-limit or outage | Medium | Fall back to local `./artifacts/leads.json` backup file. |
| **R-04** | Gemini API free quota exceeded (HTTP 429) | Medium | Throttle requests (1s delay); in-code budget circuit breaker. |
| **R-05** | Email marked as spam / domain reputation hit | High | Max 40 emails/day; 100% human-customized manual send. |
| **R-06** | Operator has college exam crunch | Low | System runs unattended; leads wait in Sheet without expiring. |

---

## 3. Six-Month System Degradation Forecast

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1 MONTH IN: Discovery Query Decay                                      │
│ • Initial search queries produce diminishing fresh leads.              │
│ • Mitigation: Add 5 new niche/city variations in SOURCES tab.          │
├────────────────────────────────────────────────────────────────────────┤
│ 3 MONTHS IN: Google Sheets Row Growth                                  │
│ • HISTORY tab reaches 3,000+ rows; deduplication lookup slows down.    │
│ • Mitigation: In-memory hash set deduplication in TypeScript runner.   │
├────────────────────────────────────────────────────────────────────────┤
│ 6 MONTHS IN: Playwright Selector & CSS Drift                           │
│ • Modern CMS builders update class name patterns.                      │
│ • Mitigation: Rely on DOM standard properties (scrollWidth) over CSS.  │
└────────────────────────────────────────────────────────────────────────┘
```
