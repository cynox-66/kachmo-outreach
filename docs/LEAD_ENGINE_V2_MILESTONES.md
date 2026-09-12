# Lead Engine v2.3.0 — Master Architecture & Operational Milestones

> **Document Type:** System Architecture & Operational Milestone Record  
> **Repository:** `Clients/reachout/`  
> **Authority:** `docs/KACHMO_ALIGNMENT.md`, `docs/ARCHITECTURE.md`, `context/08-studio-transformation-roadmap.md`  
> **Status:** Production Verified (September 10, 2026)  
> **Verification:** 379/379 tests passing (23 test suites), 0 build errors, 0 lint errors  

---

## 1. Executive Summary & Purpose

Lead Engine v2.3.0 transitions Kachmo's prospecting infrastructure from an experimental single-track website auditor into a **disciplined multi-track discovery engine**. It resolves two critical vulnerabilities identified during live operations:
1. **The Budget Arithmetic Defect:** Daily runs previously risked exceeding the studio's strict $2.50/month ceiling. v2.3.0 enforces an alternate-day cadence and a dual circuit breaker ($2.00 soft / $2.50 hard), bringing estimated monthly spend to **~$1.38/month**.
2. **The "Dinosaur Firm" & "Missing Website" Traps:** The engine previously leaked 20-year-old tender-driven architecture firms that do not buy websites over cold email, while structurally ignoring the highest-intent leads: businesses with *no website*. v2.3.0 hardens Gate 1 to mandate digital acquisition signals and introduces **Track B (Zero-Presence Discovery)**.

---

## 2. Multi-Track Pipeline Architecture

```
                                    SOURCES TAB / CLI FLAGS
                                                │
          ┌─────────────────────────────────────┴─────────────────────────────────────┐
          ▼                                                                           ▼
   TRACK A: SITE-AUDIT                                                        TRACK B: ZERO-PRESENCE
   (Existing Sites with Observable Gaps)                                       (Real Businesses with No Site)
   ─────────────────────────────────────                                       ──────────────────────────────
   1. Search Grounding / Founder Queries                                       1. Discovery: Outscraper CSV Seeds /
   2. Blacklist & Normalization                                                   UK Companies House API (Free)
   3. Pre-Filter (detectCommercialSignals)                                     2. Local DNS Probe (Node.js dns.resolve A)
   4. Playwright Headless Render & Mobile Screenshot                              If no domain resolves -> Track B
   5. Gemini Evaluator (Prompt v2.3.0):                                        3. Deterministic Opportunity Scoring (0–100)
      • Gate 1: Mandatory Digital Acquisition Signal                              (Category + Reviews log + WhatsApp/Email)
      • Gate 1: 15-yr / 50-staff cap -> medium fit (never emailed)             4. Optional Gemini Draft ($0.005 text-only)
      • Exemption: white_label_partnership allowed                             5. ZERO Playwright / ZERO Screenshot Cost
   6. Write to TODAY & HISTORY tabs                                            6. Write to TODAY-ZERO & HISTORY-ZERO
          │                                                                           │
          └─────────────────────────────────────┬─────────────────────────────────────┘
                                                ▼
                                    SHARED OUTCOMES CRM TAB
                        (Columns: lead_id, track, sent_at, replied, won)
                                                ▲
                                                │
                                    INTENT CHANNELS (WEEKLY)
                                    ────────────────────────
                                    • INTENT-HN: Hacker News "SEEKING FREELANCER"
                                      Parser (Algolia API, 45-day window)
                                    • INTENT-MANUAL: 20-min weekly scan
                                      (Wellfound, LinkedIn)
```

---

## 3. Core Engine Specifications & Verifications (v2.3.0)

### 3.1 Cadence & Budget Circuit Breaker
* **GitHub Actions Schedule:** `.github/workflows/daily.yml` updated to **`0 6 * * 1,3,5`** (Mon, Wed, Fri at 06:00 UTC = ~15 runs/month).
* **Budget Constants (`src/constants.ts`):**
  * `MONTHLY_SOFT_CAP_USD`: `$2.00` (Triggers non-fatal console warning).
  * `MONTHLY_HARD_CAP_USD`: `$2.50` (Immediately throws `BudgetExceededError` and halts).
  * `DEFAULT_ESTIMATED_RUN_COST_USD`: Recomputed to `$0.106` for the 13-query active bank (13 discovery + ~40 evals @ $0.002).
  * **Projected Monthly Spend:** `$0.106 * 15 = $1.59/month` (safely below $2.00 soft cap).
* **Spend Logging:** `artifacts/spend-log.json` logs execution timestamp, runId, estimated tokens, and run cost.

### 3.2 Gate 1 Hardening (`src/evaluate/prompts.ts` v2.3.0)
* **Mandatory Digital Acquisition Signal:** A business with an existing website must demonstrate an active digital conversion path:
  * *Product/SaaS:* `join waitlist`, `early access`, `request invite`, `pricing`, `start free trial`, `book a demo`, `sign up`, `backed by`, `seed round`.
  * *Clinics/Local Service:* `book now`, `book appointment`, `online consultation`, `enquire online`.
  * *Commerce:* `add to cart`, `checkout`, `shop now`.
  * *Failure Mode:* If no digital acquisition signal is found, the company is rejected at Gate 1 with `"no observable web-dependent acquisition motion"`.
* **Firm Age & Staff Cap:** Businesses operating for ≥15 years or with ~50+ staff are capped at `fit_level = "medium"`.
* **The Partnership Exemption (Critical Logic):** Medium-fit *client* leads are strictly non-dispatchable (never emailed). However, `white_label_partnership` leads (branding & graphic design studios) remain **fully dispatchable** with partner copy.

### 3.3 Multi-Track Schema (`src/types.ts` & `src/constants.ts`)
* Added `LeadTrack = 'site_audit' | 'zero_presence' | 'intent'`.
* Implemented `ZeroPresenceLead`:
  ```ts
  export interface ZeroPresenceLead {
    id: string;
    track: 'zero_presence';
    name: string;
    category: string;
    locality: string;
    phone: string | null;
    whatsappCapable: boolean;
    email: string | null;
    profileUrl: string;
    reviewCount: number;
    rating: number;
    listingAgeDays?: number;
    noSiteConfirmed: boolean;
    opportunityScore: number;
    draftSubject?: string;
    draftBody?: string;
    status: LeadStatus;
    discoveredAt: string;
  }
  ```
* Expanded `SHEET_TABS` to include `TODAY_ZERO`, `HISTORY_ZERO`, `INTENT_HN`, `INTENT_MANUAL`, `TRACK_C_BUILDER`.

### 3.4 Deterministic Opportunity Scoring (`src/pipeline/opportunity-score.ts`)
Calculates a 0–100 priority score without AI:
* **Category Premiums:** Dental/Aesthetic clinics (+22), Roofing/HVAC (+20), Law firms (+18), Coffee/Roasteries (+14), Boutique retail (+12).
* **Review Logarithmic Scale:** `Math.min(18, Math.log1p(reviewCount) * 4.2)` (50 reviews ≈ 16.5, 300 reviews ≈ 18).
* **Rating Signals:** `≥4.5` (+10), `≥4.2` (+7), `≥4.0` (+4).
* **Recency:** `≤365 days` (+14), `≤730 days` (+8).
* **Reachability:** WhatsApp-capable (+10), Email (+6).
* **Confirmed No-Site Bonus:** (+16).
* **Franchise Penalty:** (-12).
* *Thresholds:* Score `≥62` qualifies; Score `≥75` auto-prioritizes to top.

### 3.5 Hacker News Intent Parser (`src/discover/hn-intent.ts`)
* **Endpoint:** Algolia API (`https://hn.algolia.com/api/v1/search?query=SEEKING%20FREELANCER&tags=comment`).
* **Window:** 45-day lookback (covers monthly thread drop intervals).
* **Structural Filtering:** Discards comments with freelancer self-promotions (`Location: / Willing to relocate: / Technologies:`).
* **Skill Matching:** Requires primary skill match (`webflow`, `framer`, `frontend`, `ui/ux`, `web design`).
* **Regex Heading Match:** Catches variations (e.g. `Seeking US BASED Freelancer Only`).
* **CLI Invocation:** `npx tsx src/run.ts --intent-hn`.

### 3.6 UK Companies House Ingestion (`src/discover/companies-house.ts`)
* **Endpoint:** `https://api.company-information.service.gov.uk/companies/search`.
* **Authentication:** `COMPANIES_HOUSE_API_KEY` via HTTP Basic Auth.
* **Target SIC Codes:**
  * 43210 (Electrical installation), 43220 (Plumbing/HVAC), 43910 (Roofing), 81300 (Landscaping).
  * 86210, 86220, 86230 (Medical & Dental practices).
  * 96021, 96022 (Beauty salons & treatment).
* **Zero-Cost Domain Probe:** Performs local `dns.promises.resolve(domain, 'A')` on `{name}.co.uk` and `{name}.com`:
  * If no A-record resolves -> `noSiteConfirmed = true` -> routes to Track B (`ZeroPresenceLead`).
  * If A-record resolves -> passes domain to Track A candidate pool.
* **CLI Invocation:** `npx tsx src/run.ts --companies-house`.

---

## 4. Operational Playbook & CLI Commands

| Operation | Command | Execution Schedule |
| :--- | :--- | :--- |
| **Normal Lead Batch (Track A)** | `npm run dev` | Automated via GitHub Actions (Mon/Wed/Fri 06:00 UTC) |
| **Check / Dry-Run (No Google Sheets write)** | `npm run check` | Manual testing |
| **HN Intent Ingestion** | `npx tsx src/run.ts --intent-hn` | Weekly (Monday mornings) |
| **Companies House Ingestion** | `npx tsx src/run.ts --companies-house` | Bi-weekly or monthly |
| **Run Complete Test Suite** | `npm test` | Pre-commit / CI gate (379 tests) |
| **Inspect Spend Log** | `cat artifacts/spend-log.json` | Post-run review |

---

## 5. Next Planned Milestones for Lead Engine

1. **Track B CSV Importer (Milestone 2.4):** Create a one-time CLI script (`npx tsx scripts/import-zero.ts`) to ingest Outscraper Maps CSV exports (500 Indian clinics/cafes/salons with 50–500 reviews and dead/missing websites) directly into `TODAY-ZERO`.
2. **Track C Builder-Stack Downloader (Milestone 2.5):** Ingest free `myip.ms` hosting IP lists for GoDaddy Website Builder and 1&1 IONOS to surface outdated SMB tradie websites directly into Track A.
3. **Cross-Track CRM Deduplication:** Ensure the `HISTORY` deduplication key checks across `(domain)` for Track A and `(phone + locality)` for Track B to prevent double-contacting.
