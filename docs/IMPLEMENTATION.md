# Implementation, Tooling, Testing & Cost Model

> **Status:** Canonical & Active  
> **Owner:** Solo Operator / Principal Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## 1. Headless Browser Automation (Playwright)

Lead Engine uses standard **Microsoft Playwright** inside headless Chromium to render candidate websites, detect mobile responsive layout flaws, and capture in-memory screenshots.

```typescript
import { chromium, Browser, BrowserContext, Page } from 'playwright';

export async function createOptimizedContext(browser: Browser): Promise<BrowserContext> {
  return await browser.newContext({
    viewport: { width: 390, height: 844 }, // Mobile iPhone Viewport
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    bypassCSP: true,
    ignoreHTTPSErrors: true
  });
}
```

### Route Interception & Performance Tuning:
Only resources invisible to a still screenshot are aborted. Images, fonts and
webfont CDNs are deliberately **allowed**: the screenshot is the multimodal
model's primary evidence, and blocking them made every site render as broken
placeholders (see `docs/ENGINEERING.md` DEC-011).
```typescript
await page.route('**/*', (route) => {
  const type = route.request().resourceType();
  const url = route.request().url().toLowerCase();
  if (['media', 'websocket', 'eventsource', 'manifest'].includes(type) ||
      url.includes('google-analytics.com') || url.includes('hotjar.com')) {
    return route.abort('blockedbyclient');
  }
  route.continue();
});
```

### In-Browser DOM Inspection Script:
```typescript
export async function inspectDomLayout(page: Page) {
  return await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const bodyWidth = document.body ? document.body.scrollWidth : viewportWidth;
    const renderedWidth = Math.max(scrollWidth, bodyWidth);

    return {
      hasHorizontalOverflow: renderedWidth > viewportWidth + 5,
      viewportWidth,
      renderedWidth,
      title: document.title || '',
      ctaButtons: Array.from(document.querySelectorAll('button, a.btn, a[href*="contact"]'))
        .map(el => (el.textContent || '').trim()).filter(Boolean).slice(0, 5),
      mailtoLinks: Array.from(document.querySelectorAll('a[href^="mailto:"]'))
        .map(a => (a.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0].trim()).filter(Boolean),
      contactLinks: Array.from(document.querySelectorAll('a[href*="contact"], a[href*="inquire"]'))
        .map(a => (a as HTMLAnchorElement).href).slice(0, 3)
    };
  });
}
```

---

## 2. Production Technology Stack

- **Runtime:** Node.js 20.x LTS | TypeScript 5.4+ (Strict Mode)
- **CI/CD:** GitHub Actions Ubuntu Headless Runner (`ubuntu-latest`)

### Production Dependencies (`package.json`):
```json
{
  "name": "lead-engine",
  "version": "1.0.0",
  "main": "dist/run.js",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/run.js",
    "dev": "tsx src/run.ts",
    "test": "vitest run",
    "lint": "eslint src/ tests/ scripts/",
    "format": "prettier --write \"**/*.{ts,js,json,md,yml}\""
  },
  "dependencies": {
    "@google/generative-ai": "^0.11.0",
    "axios": "^1.7.0",
    "cheerio": "^1.0.0-rc.12",
    "dotenv": "^16.4.5",
    "googleapis": "^137.0.0",
    "playwright": "^1.44.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.12.7",
    "@typescript-eslint/eslint-plugin": "^7.8.0",
    "@typescript-eslint/parser": "^7.8.0",
    "eslint": "^8.57.0",
    "prettier": "^3.2.5",
    "tsx": "^4.7.2",
    "typescript": "^5.4.5",
    "vitest": "^1.5.0"
  }
}
```

---

## 3. Testing & Quality Assurance Strategy

We test deterministic rules, regex parsers, and JSON schemas using **Vitest** with real HTML fixtures.

```typescript
// tests/rules.test.ts
import { describe, it, expect } from 'vitest';
import { isBlacklistedDomain, extractCleanEmails, detectTechStack } from '../src/qualify';

describe('Deterministic Rules Test Suite', () => {
  it('should filter blacklisted domains', () => {
    expect(isBlacklistedDomain('instagram.com')).toBe(true);
    expect(isBlacklistedDomain('studioforma.in')).toBe(false);
  });

  it('should extract valid clean emails', () => {
    const html = '<a href="mailto:hello@studioforma.in">Email</a>';
    expect(extractCleanEmails(html)).toEqual(['hello@studioforma.in']);
  });

  it('should identify CMS signatures', () => {
    expect(detectTechStack('<link href="/wp-content/themes/">', {})).toBe('WordPress');
    expect(detectTechStack('<html data-wf-page="123">', {})).toBe('Webflow');
  });
});
```

---

## 4. Cost Model & Free-Tier Budget Guardrail

Lead Engine runs at **~$1.38/month** against a $2.00 soft cap and a $2.50 hard cap.
Everything except Gemini stays inside free-tier allowances.

The figure is derived from the alternate-day cadence (Mon/Wed/Fri ≈ **13 runs/month**)
and the per-run planning estimate in `src/constants.ts`:

```
BUDGET.DEFAULT_ESTIMATED_RUN_COST_USD
  = 13 grounded discovery calls x $0.002      = $0.026
  + 40 multimodal evaluations   x $0.002      = $0.080
                                              = $0.106 per run
  x 13 runs/month                             = $1.378/month
```

| Service | Free Allowance | Lead Engine Monthly Usage | Billed Cost |
| :--- | :--- | :--- | :--- |
| **GitHub Actions** | 2,000 Linux runner min/month | ~195 min/month (13 runs x ~15 min) | **$0.00** |
| **Gemini 3.5 Flash-Lite** (evaluation) | Free-tier RPM/TPM/RPD — confirm current values in [AI Studio](https://aistudio.google.com/rate-limit) | ~520 evaluations/month (13 x 40) | ~$1.04/mo |
| **Gemini Search Grounding** (discovery) | 5,000 free search requests/month (paid tier only) | ~169 grounded calls/month (13 x 13) | ~$0.34/mo |
| **Google Sheets API v4** | 300 requests/minute | ~2 requests/run (batched) | **$0.00** |
| **PageSpeed API** | 25,000 requests/day | Not integrated in v1 (key reserved) | **$0.00** |
| **Companies House** (`--companies-house`) | Free register API, 600 req / 5 min | ≤ 50 requests/run, on demand | **$0.00** |
| **Algolia HN Search** (`--intent-hn`) | Free, unauthenticated | ≤ 10 requests/run, on demand | **$0.00** |
| **TOTAL** | — | — | **~$1.38 / mo** (vs $2.50 hard cap) |

> **Billing note (2026-08-11):** Grounding with Google Search is excluded from the Gemini free tier
> for every model (verified live — the grounding quota is zero, so an ungrounded call succeeds in the
> same second a grounded one returns 429). Billing is therefore **enabled** on the project. The paid
> tier includes 5,000 free search requests/month against a projected ~169, so the *search requests*
> themselves cost $0.00; the tokens the grounded call consumes are billed at paid rates, which is what
> the $0.002 per-call figure above represents.

> **Estimate, not a meter (2026-09-10):** every figure in this section is a forecast built from the
> per-call model above. The number that actually stops a run is the one `trackSpend()` accumulates.
> Gemini returns real token counts in `usageMetadata`, but `callGemini` returns the response body as a
> plain string, so nothing downstream can read them — see `ESTIMATED_TOKENS_PER_EVALUATION` in
> `src/evaluate/gemini.ts`. Re-derive the per-run figure whenever the enabled query count or
> `TARGET_CANDIDATE_COUNT` changes; `tests/constants.test.ts` projects 13 runs against the soft cap so
> a drift surfaces there rather than at the breaker three weeks later.

### Two-Stage In-Code Circuit Breaker:

The soft cap only warns; the hard cap aborts the run. The gap exists because tripping the
hard cap loses the remainder of the batch, so the operator needs a signal while there is
still room to finish the run and change the cadence deliberately.

```typescript
// src/config/config.ts
export function trackSpend(costUsd: number, config: AppConfig = getConfig()): void {
  const previousSpendUsd = currentSpendUsd;
  currentSpendUsd += costUsd;

  // Warn once, on the call that crosses the line.
  if (previousSpendUsd <= BUDGET.MONTHLY_SOFT_CAP_USD &&
      currentSpendUsd > BUDGET.MONTHLY_SOFT_CAP_USD) {
    log.warn(`Spend crossed the $${BUDGET.MONTHLY_SOFT_CAP_USD.toFixed(2)} soft cap`, { ... });
  }

  if (currentSpendUsd > config.monthlyBudgetUsd) {
    throw new BudgetExceededError(currentSpendUsd, config.monthlyBudgetUsd);
  }
}
```

> **Scope caveat:** `currentSpendUsd` is module-scoped, so it accumulates **per process**, not per
> month. On an ephemeral GitHub Actions runner every run starts at zero. `artifacts/spend-log.json`
> (see `appendSpendLogEntry`) records each run's estimate so a month can be *observed*, but the
> filesystem is fresh each run, so it cannot be *enforced* from CI. Month-to-date enforcement would
> need shared state the project deliberately does not have.

