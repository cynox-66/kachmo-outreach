# Discovery, Qualification & Rule Engine Specification

> **Status:** Canonical & Active  
> **Owner:** Solo Operator / Principal Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## 1. Sourcing & Candidate Discovery Strategy

Lead Engine harvests **100–200 raw website candidate domains daily** by leveraging the open web and search index grounding rather than brittle platform scrapers.

```
DISCOVERY HIERARCHY:
1. Gemini Grounded Google Search (High intent, zero anti-bot risk)
2. Public CMS Showcases (Static HTML feeds: Cargo, Readymag, Webflow)
3. Direct Search Queries (Independent portfolios and studio sites)
[ PERMANENTLY REJECTED: Walled-garden bot scraping (Behance / Instagram bot logins) ]
```

### Gemini Search Grounding Implementation Pattern:
```typescript
export async function harvestCandidatesViaGrounding(query: string): Promise<RawCandidate[]> {
  const prompt = `
    Find 15 independent creative studios, branding agencies, or design studios matching: "${query}".
    Return a valid JSON array of objects with: name, domain, website_url, description.
    Exclude major directories (Clutch, Yelp, Behance, LinkedIn, Instagram). Only return independent websites.
  `;
  const response = await geminiModel.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }]
  });
  return parseGroundedResponse(response);
}
```

---

## 2. Deterministic Pre-Filtering Engine

Before launching Playwright or calling Gemini, candidates pass through zero-cost deterministic checks in `src/qualify.ts` and `src/fetch.ts`:

1. **Canonical Deduplication:** Strip protocols and `www` to check against `HISTORY` sheet tab. Drop duplicates.
2. **Domain Blacklist Check:** Drop major SaaS, directories, and social platforms (`clutch.co`, `instagram.com`, `yelp.com`, `gov`, `edu`).
3. **HTTP 200 Pre-Flight:** Issue Axios GET with a 5-second timeout. Must return status `200` with `text/html` content between 2KB and 5MB.
4. **Commercial Heuristic Signals:** Must match at least 2 commercial regex patterns (`portfolio|projects|case studies`, `services|capabilities`, `contact|inquire`).
5. **Deterministic CMS Detection:** Scan HTML for `wp-content` (WordPress), `wix.com` (Wix), `wf-page-` (Webflow), `framer.com` (Framer), or Next.js signatures.
6. **Regex Contact Discovery:** Extract direct `mailto:` links, `/contact` page links, and social URLs.

---

## 3. The 4-Gate Qualification Decision Tree

Qualification is not a weighted average. It is a **sequential binary decision tree**:

```
                       [ Discovered Candidate ]
                                  │
                                  ▼
               ┌──────────────────────────────────────┐
               │ GATE 1: FIT                          │
               │ Is this a client type we can serve?  │
               └──────────────────┬───────────────────┘
                                  │
                         YES ─────┴───── NO ──► REJECT (Drop Candidate)
                          │
               ┌──────────▼───────────────────────────┐
               │ GATE 2: COMMERCIAL SIGNAL            │
               │ Are they an active, paying business? │
               └──────────────────┬───────────────────┘
                                  │
                         YES ─────┴───── NO ──► REJECT (Drop Candidate)
                          │
               ┌──────────▼───────────────────────────┐
               │ GATE 3: CONCRETE NEED                │
               │ Is there a verifiable website flaw?  │
               └──────────────────┬───────────────────┘
                                  │
                         YES ─────┴───── NO ──► REJECT (Drop Candidate)
                          │
               ┌──────────▼───────────────────────────┐
               │ GATE 4: REACHABILITY                 │
               │ Can we contact a decision maker?     │
               └──────────────────┬───────────────────┘
                                  │
                         YES ─────┴───── NO ──► HOLD / REJECT
                          │
                          ▼
            [ QUALIFIED PROSPECT FOR REVIEW ]
```

- **Gate 1 (Fit):** Must be an independent branding studio, architecture firm, commercial photographer, or design boutique. (Reject: Enterprise SaaS, government, e-commerce dropshippers, student resumes).
- **Gate 2 (Commercial):** Must show evidence of active paid client work (client logos, recent case studies, active services).
- **Gate 3 (Need):** Must exhibit at least ONE verifiable technical defect (e.g. mobile horizontal overflow at 390px, PageSpeed < 50, broken CTA). If flawless: `qualified = false`.
- **Gate 4 (Reachability):** Must have a direct email (`name@studio.com`), studio email (`hello@`), active contact form, or direct social link.

---

## 4. 0–10 Priority Ranking Engine

The priority score is applied **only to candidates that pass all 4 gates** to order them on the operator's screen:

$$\text{Priority Score } (0\text{--}10) = \text{Need Severity } (0\text{--}3) + \text{Commercial Signal } (0\text{--}3) + \text{Reachability } (0\text{--}2) + \text{Recency } (0\text{--}2)$$

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. NEED SEVERITY (0-3 pts):     3 = Mobile overflow / PageSpeed < 45   │
│ 2. COMMERCIAL SIGNAL (0-3 pts): 3 = High-end clients, active team      │
│ 3. REACHABILITY (0-2 pts):      2 = Direct personal email address      │
│ 4. RECENCY (0-2 pts):           2 = Projects published < 6 months ago  │
└────────────────────────────────────────────────────────────────────────┘
```

| Tier | Priority Score | Volume | Action |
| :--- | :--- | :--- | :--- |
| **Priority A** | **8 – 10** | 15 – 25 leads/day | Review & send in first 15 minutes of evening session. |
| **Priority B** | **6 – 7** | 15 – 25 leads/day | Review & send with standard personalized template. |
| **Below Threshold** | **< 6** | Dropped | Automatically archived in `HISTORY`. |
