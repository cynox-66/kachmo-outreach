# Kachmo Studios — Lead Engine Deep Research Dossier
## Next-Generation Client Acquisition Intelligence: Validation, Expansion, Critique

**Prepared for:** Dev & Aadi, Kachmo Studios (Pune)
**Date:** 10 September 2026
**Scope:** Full validation of the five hypothesized discovery channels in Part V of the studio dossier, plus architecture recommendations that resolve the core paradox. Research grounded in live API/pricing documentation as of September 2026, verified against the studio's hard constraints: **$2.50 USD monthly infra cap**, **≤30 minutes operator time per evening**, **100% manual Gmail dispatch**, **single TypeScript CLI batch script**, **zero fabrication**.

*Note on source material: the dossier text ended mid-sentence inside Part V during transmission. This report treats Part V's stated mandate — "validate, expand, and critique" the five ideas — as complete and covers all five, plus expansion.*

---

## 0. Executive Verdicts at a Glance

| # | Channel | Premise validity | Automatable under $2.50/mo? | Verdict | One-line why |
|---|---------|------------------|------------------------------|---------|---------------|
| 1 | Google Maps "zero-website" scraper | ✅ Strong — ~20M+ dead .business.site links since March 2024 shutdown | ⚠️ Only via one-time free credits; official API now too expensive for monthly use | **GO (bootstrap), then sustain manually** | Outscraper/Apify give 500 free records once; official Places pricing lost its $200 credit in March 2025 |
| 2 | Instagram/social-first D2C discovery | ✅ Intent is real (founders reply to DMs), ❌ API can't support scale | ❌ No | **MANUAL ONLY** | Graph API blocks follower counts & searches on accounts you don't own; scraping = ToS violation + bot detection |
| 3 | Active intent hunting (X, LinkedIn, Reddit, Wellfound) | ✅ Explicit intent converts best; ⚠️ infrastructure changed under you | ✅ Half | **GO on Hacker News + Wellfound manual; SKIP X/Reddit automation** | X API free tier killed Feb 2026 (pay-per-use); Reddit .json endpoints died May 30, 2026; HN threads remain free & parseable |
| 4 | International high-ticket local services ("tradies") | ✅ Economics are compelling ($1,000 = ₹83k arbitrage, owner replies) | ✅ For UK only | **GO (UK leg), MANUAL for US/AU** | UK Companies House API is free, fast, SIC-filterable; US SOS registries are fragmented/paid; bulk tech lists cost $295+/mo |
| 5 | New business registrations (UK, India, US) | ✅ New = no website by default | ✅ UK only | **GO (UK Companies House leg)** | MCA21 has no public bulk API (paid per-CIN only); UK is the clean winner |

**The single most important finding is not a channel.** It is arithmetic: your current engine already violates its own budget. At the dossier's own estimates ($0.064–$0.088 per run × 30 daily runs), monthly spend is **$1.92–$2.64** — the top of that range is **already over the $2.50 cap** before adding a single new capability. Every recommendation below is therefore built on a mandatory cadence change (§1), because there is no scenario in which a new paid or AI-cost channel fits on top of an already-maxed engine.

---

## 1. The Constraint Reality Check — Read Before Building Anything

### 1.1 The budget does not survive the current cadence

| Configuration | Monthly cost | vs $2.50 cap |
|---|---|---|
| Current: daily batch, low unit cost ($0.064/run) | $1.92 | under by $0.58 |
| Current: daily batch, high unit cost ($0.088/run) | $2.64 | **over by $0.14** |
| Alternate-day batch (15 runs/mo), high unit cost | $1.32 | **headroom $1.18** |
| Alternate-day + zero-presence Gemini drafts (10 leads/day × 15 days × $0.005) | $2.07 total | headroom $0.43 |

**Action required:** drop from daily to **alternate-day batches** (or halve queries-per-run). This is not optional if any new capability is added. It also has an operational upside you have not credited: with ≤30 min/evening and manual Gmail dispatch, Dev cannot meaningfully act on 30 fresh leads every single day anyway. Every-other-day batches produce a reviewable queue (~10–20 qualified rows) that fits the evening window; daily batches create review debt that compounds into abandonment.

**Re-tune the circuit breaker:** move the exit from $2.50 down to **$2.00**. Reason: Gemini unit costs fluctuate with output token count; a couple of verbose runs plus Sheets retry storms can blow a $0.50 buffer in one night. A $2.00 breaker protects the studio from a surprise invoice, and $0.50 of slack is worth more than two extra runs.

### 1.2 Operator time is the tighter constraint than money

≤30 min/evening ≈ 2.5 hours/week. Realistic sustainable throughput:

- Batch review + scoring triage: 10–15 min
- Draft personalization (the AI gives subject/body; Dev adds one specific sentence): 5 min × ~8 sends = 40 min → exceeds budget

So **sends must be capped at ~10–12 per evening**, which means the pipeline should optimize for *fewer, higher-confidence rows*, not more candidates. A discovery channel that dumps 300 raw names into a sheet is worse than useless here — it consumes the scarcest resource. Every recommended source below is judged on whether it produces a small, decision-ready list, not a firehose.

---

## 2. The Paradox, Resolved

**The paradox (correctly diagnosed in Part IV):** the pipeline requires `website_url → HTTP 200 → Playwright render → AI screenshot eval`. So it structurally cannot discover the highest-intent prospect of all: a business with no website. Meanwhile it systematically surfaces 20-year-old architecture firms whose desktop sites are "good enough," whose owners win government tenders, and who will never buy from a cold email (your Failure #2).

**The resolution is not a better scraper. It is a second track.** Run two parallel pipelines that feed one CRM:

### Track A — Site-Audit (existing, keep, but fix the sourcing)

Discovers businesses *with* sites that show observable weakness. This track produced your genuine wins (AMnova, Kroop AI — real startups with real landing-page problems). Do not discard it. Fix its failure mode instead:

**Gate 1 tightening (kills the dinosaur trap at zero marginal cost):**
1. Cap fit_level to `"medium"` for any practice older than 15 years OR visibly 50+ staff — and add a hard rule: `"medium" fit is never emailed`. It goes to a watchlist only.
2. Add a **mandatory "mobile-web acquisition matters" signal**: reject unless ≥1 of {waitlist/signup flow, online booking, e-commerce cart, SaaS pricing table, product demo request, accelerator/funding mention}. A 20-year-old firm with a brochure site and no digital conversion path fails here. This encodes the lesson of Failure #2 directly into the gate: if they do not acquire clients through their site, a site redesign pitch is irrelevant.
3. Keep the existing ban on agencies/competitors; raise confidence thresholds rather than expanding queries.

### Track B — Zero-Presence Discovery (new)

Discovery sources that need **not** return a URL. Schema per lead:

```ts
ZeroPresenceLead = {
  name: string;                 // "Koregaon Dental Clinic"
  category: string;             // "dental_clinic"
  locality: string;             // "Koregaon Park, Pune"
  phone: string | null;         // verified mobile format via libphonenumber
  whatsapp_capable: boolean;    // country code + mobile prefix check
  email: string | null;         // only if domain probe confirms MX
  profile_url: string;          // Google Maps listing URL (for human verification)
  review_count: number;
  rating: number;
  listing_age_days: number;     // recency signal when available
  no_site_confirmed: boolean;   // website field null OR dead .business.site
  opportunity_score: number;    // deterministic, computed locally
  draft_subject?: string;       // optional Gemini draft (~$0.005 each)
  draft_body?: string;
}
```

Stages (all deterministic, TypeScript-only, ~zero cost):

- **B1 Discovery:** pull from free sources (§§4–7). No paid API required.
- **B2 Enrichment:** DNS A/MX probe on `{name} + locality` heuristic domains only when cheap; libphonenumber-format check on phone. No Playwright. No screenshot. No AI.
- **B3 Scoring:** `Opportunity Score` formula in §10.2. Fully local computation.
- **B4 Output:** append to a dedicated `TODAY-ZERO` tab (+ `HISTORY-ZERO`, dedupe by `phone + locality + name`). Keeps Track A's TODAY/HISTORY untouched.

**Why this resolves the paradox without lying:** Track A fabricates nothing because it audits a real page. Track B also fabricates nothing — but it can only cite what the public listing proves: *category, locality, review volume, star rating, and the absence of a website link*. An honest zero-presence email says exactly that ("your listing shows 312 reviews but no website link, so patients have to call"). No H1 talk. No DOM metrics. No invented PageSpeed numbers. It satisfies Commandment #2 (Zero Fabrication) by construction, because there is no site to invent facts about.

**Critical discipline for Track B copy (read twice):** because there is no audited site, the temptation to manufacture a "problem" is high. The rule: **if it isn't visible on the listing/profile, it is not real, and it does not go in the email.** Review count, rating, category, neighborhood, missing website link, dead `.business.site` redirect — these are the only permitted observations. Everything else is fabrication and will read as spam.

### Why not merge the tracks?

They have opposite risk profiles. Track A's risk is false rejection (a good site that the AI misreads). Track B's risk is false acceptance (a listing that looks great but the owner is unreachable or happy to be phone-only). Keeping separate tabs lets Dev triage with different mental models and lets you turn Track B off instantly if reply quality disappoints, without touching the engine that found AMnova.

---

## 3. Idea 1 — Google Maps "Zero-Website" Scraper

### 3.1 Premise validity: CONFIRMED, and bigger than assumed

Google shut down all free Business Profile websites effective **March 1, 2024**, redirecting `.business.site` domains to the profile until June 2024, then killing them entirely. Multiple independent sources estimate **~21 million** small businesses affected worldwide, with heavy concentration in India and emerging markets — exactly the cohort that used the free builder because they had no budget for a real site. So the pool is real, large, and precisely the "has no website" segment Part IV identifies as highest-intent.

Secondary confirming signal: Google Maps listings still expose a **mobile phone field** reliably, which makes the WhatsApp-first angle technically feasible for India. A professional WhatsApp message with a Figma mockup link genuinely gets opened faster than a cold email in the Indian SMB context.

### 3.2 Feasibility under $2.50/mo: official API route CLOSED, bootstrap route OPEN

**What changed (this matters — the dossier's assumptions predate it):** Google Maps Platform **eliminated the recurring $200 monthly credit on March 1, 2025**, replacing it with subscription tiers (Essentials / Pro / Enterprise) and a **one-time $300 trial credit** for new customers. There is no longer a standing monthly free allowance.

Places API pricing post-change (verified across three independent 2026 breakdowns):
- Places Nearby Search: **~$7–$32 per 1,000 requests** depending on tier/SKU (the "dynamic data" SKU is at the top end).
- Autocomplete / Text Search (Essentials): **~$2–$5 per 1,000 requests**.

With only **$1.18/mo of headroom** after the alternate-day cadence change (§1.1), the official API buys you **36–590 requests/month**. That is not a viable recurring discovery source. The premise outran the pricing reality.

**But the bootstrap route is genuinely viable:**

| Provider | Free tier | Practical value for Kachmo |
|---|---|---|
| Outscraper Google Maps Scraper | **First 500 businesses, $0, no monthly fee** | One CSV export = 500 zero-website or category-filtered Indian businesses. At 10–15 sends/evening, that is **35–50 days of targets** from a single Saturday session. |
| Apify Google Maps actors | Free plan includes **$5 platform credits/month** (~3,300 places at $1.50/1k after credits) | Recurring but tiny; useful as a monthly top-up. |
| SerpApi | Starter $25/mo | ❌ Over budget, exclude. |

### 3.3 What to actually build (concrete, scoped)

1. **One-time seed (Week 1, ~90 minutes on a weekend):** sign up Outscraper, export 500 businesses filtered to 3–4 niches in Pune + Mumbai + Bangalore (dental clinics, cosmetic/aesthetic clinics, specialty coffee roasters/cafes, boutique gyms/yoga studios, wedding photographers). Filter criteria: reviews 50–500, rating ≥4.2, website field empty/dead/Facebook-only. Cost: $0.
2. **Manual weekly enrichment (~20 min/week):** for each row, confirm the phone is WhatsApp-capable, note the first-line observation (review count + missing site), paste into the `TODAY-ZERO` sheet. Do not automate WhatsApp sending — see §3.5.
3. **Optional recurring top-up:** one Apify run/month on the $5 free credits to refresh ~500 fresh records as the seed depletes.

### 3.4 TOS and deliverability risk (honest assessment)

- Scraping `google.com/maps` directly with Playwright = Terms of Service violation, aggressive bot detection, and IP/account bans. **Do not build this.** Use Outscraper/Apify as the extraction layer; they absorb the anti-bot burden legally as data processors.
- The **official** Places API is ToS-clean but, as shown, unaffordable monthly.
- Email extraction from Maps is unreliable; phone is reliable. Plan outreach around phone/WhatsApp for India, email for UK (see Track B).

### 3.5 The WhatsApp caveat (must not be glossed over)

Automated commercial messaging via personal WhatsApp **violates WhatsApp's Terms of Service** and risks the sender number being banned — a catastrophic loss for a studio whose primary Indian sales channel is WhatsApp. Verdict:

- ✅ Manual, personal, low-volume WhatsApp messages written by a human: acceptable risk (this is normal business behavior in India).
- ❌ Automated bulk WhatsApp blasting from the CLI: do not build. Ever.
- ✅ Prefer email-first whenever the listing or a domain probe yields a mailbox; keep WhatsApp as the follow-up channel for non-responders after 5–7 days.

### 3.6 Verdict: GO (bootstrap phase) → sustain manually

Strongest immediate-action idea in the five, because a single free export jump-starts Track B with a month's worth of targets and requires no code beyond a manual enrichment step. Its weakness is sustainability under the $2.50 cap once free credits expire — which is why it pairs with the UK Companies House leg (fully free, §7) for the automated backbone.

---

## 4. Idea 2 — Instagram/Social-First D2C Brand Discovery

### 4.1 Premise validity: intent YES, mechanics NO

The behavioral premise is sound: artisan coffee roasters, jewellery makers, home-bakers, and boutique apparel founders who take orders over DM/WhatsApp feel the pain daily (drowning in DMs, losing impulse buyers, no catalog) and the founder *is* the decider and *does* read DMs. Budget ₹15,000–₹40,000, fast turnaround — good Tier-1 cashflow work.

But the **automation premise collapses on contact with the actual API**:

- The Instagram Graph API **does not allow third-party public username lookup**. Follower counts and profile metadata are only available for Business/Creator accounts you authenticate ownership of, or (very limited) via Business Discovery on accounts that have authorized you. You cannot, via any official route, enumerate "Indian jewellery sellers with 3k–40k followers."
- Unauthenticated scraping of instagram.com is among the most aggressively defended targets on the web: bot detection, IP rotation requirements, login walls, and ToS terms that expose an account-linked scraper to permanent ban. Under a $2.50/mo infra budget there is no proxy stack that survives this.
- The dossier's own desired qualification signals — *follower authenticity* and *sales evidenced by comments* — require comment-thread scraping and judgment the API cannot provide and cheap proxies cannot sustain.

### 4.2 What remains usable (manual, small-scale)

- **Google-indexed bios:** `site:instagram.com "artisan coffee" Pune "DM to order"` and `"...WhatsApp to order" jewelry India` surface bio text that Google has crawled, including follower counts in some snippets. Free, ToS-safe (you're searching Google), and genuinely usable for hand-curating a list of ~20 brands per week. But this is a SOURCES-query adjunct, not a pipeline stage.
- **Follower-count filtering is dead.** Accept it. Qualify manually by content recency and comment quality when you open the profile.

### 4.3 Verdict: MANUAL ONLY, and deprioritized relative to Ideas 1, 3(HN), 5

As a *pipeline stage*, this fails on accessibility, ToS risk, and unverifiable signals. As a *manual sourcing habit* (15 brands/week via Google operators while reviewing the batch sheet), it can yield a few high-quality Tier-1 projects, but it should not consume engineering time. Put it in the operator playbook, not in `reachout/`.

---

## 5. Idea 3 — Active Intent Hunting (X/Twitter, LinkedIn, Reddit, Wellfound)

This idea has the best unit economics of all five when it works — someone publicly saying "I need a web designer" is warm by definition, with plausible 20–40% reply rates versus 1–5% for cold outreach. The problem is the ground moved under it between when the hypothesis was written and now.

### 5.1 Platform-by-platform status as of September 2026

| Platform | Access today | Automation feasibility | Verdict |
|---|---|---|---|
| X / Twitter | Official free tier **discontinued February 2026**; pay-per-use credits only, no search on free access | ❌ Not under $2.50 | **SKIP** |
| Reddit (r/forhire, r/webdev, r/entrepreneur) | Unauthenticated `.json` endpoints **killed May 30, 2026**; OAuth still exists but gated behind Reddit's "Responsible Builder Policy" app approval, low-rate-limited | ❌ Effectively closed for a student side-tool | **SKIP** |
| LinkedIn job posts | Heavily bot-protected; no free API; third-party scrapers ~$30+/mo | ❌ Paid only | **MANUAL** (free browsing with filters) |
| Wellfound (ex-AngelList Talent) | Job board browsable free; no official API; scrapers exist (Scrapfly, Apify actor) but paid-per-job | ⚠️ Free for manual use | **MANUAL WEEKLY** |
| Hacker News "Ask HN: Freelancer? Seeking freelancer?" | **Free**, plain-text monthly thread, explicit `SEEKING FREELANCER` tags, Algolia index w/ free API | ✅ Trivial TypeScript parser | **GO — build this** |

### 5.2 The Hacker News thread is the hidden gem

Every month Hacker News pins `Ask HN: Freelancer? Seeking freelancer?` (e.g., item id 45802427 for recent months). Posters must lead with `SEEKING WORK` or `SEEKING FREELANCER`, location, and remote availability. Startups and small companies post design/front-end needs here regularly, often with budget ranges and direct contact handles.

Access routes (both free):
- **Algolia HN index:** `https://hn.algolia.com/api/v1/search?query=SEEKING%20FREELANCER&tags=comment&numericFilters=created_at_i>1725148800` — documented fair-use limit ~10,000 requests/day, no key for light use. Cache aggressively.
- **Firebase official API:** `https://hacker-news.firebaseio.com/v0/item/{id}.json` — fetch the latest thread id from `v0/maxitem.json`, then walk `kids`. Completely free, no key, generous rate limits.
- **hnrss.org:** `https://hnrss.org/newest?q=SEEKING+FREELANCER` RSS feed for cron-friendly polling.

Build cost: a ~60-line TypeScript module added to the CLI that runs on a weekly cron (not daily — the thread is monthly), dedupes by author+thread, extracts lines containing `SEEKING FREELANCER`, and appends `{title, author, post_url, text_snippet, location, remote}` to an `INTENT-HN` sheet tab. Zero API cost, zero ToS friction (HN data is openly published for exactly this use).

### 5.3 LinkedIn + Wellfound as a 20-minute weekly ritual (no code)

Dev's ≤30-min evening is better spent reading than scraping here. Weekly routine:
1. Wellfound jobs: filter Remote + "Design"/"Front-end"/"Webflow"/"Framer", posted last 7 days. Save 5–10.
2. LinkedIn Jobs: same filters, plus `"freelance" AND (web designer OR webflow OR framer developer)` with location India / Remote.
3. Paste into an `INTENT-MANUAL` tab with the posting URL. These get a tailored reply (not the cold template — the person asked for help, so lead with capability and one relevant observation, <120 words).

### 5.4 Verdict: PARTIAL GO

Build the HN parser (it is free, legal, and high-signal). Do **not** spend money or engineering on X/Reddit APIs — both are economically or administratively closed as of 2026. Treat LinkedIn/Wellfound as a fixed weekly manual slot. This converts Idea 3 from "build four integrations" into "one small module + one ritual."

---

## 6. Idea 4 — International High-Ticket Local Services ("Tradies")

### 6.1 Premise validity: CONFIRMED — the economics are the strongest in the dossier

A US/UK/AU roofer, luxury landscaper, HVAC contractor, private injector, yacht charter operator, or solar installer routinely spends **$3,000–$20,000 per job** and often **$5,000–$20,000/month on Google Ads**. A $1,000–$1,500 landing page is a rounding error against a single converted lead. The owner answers email and phone directly; there is no committee, no procurement, no six-month approval chain (this is the exact negation of the architecture-firm failure mode). Currency arbitrage means $1,000 lands as ~₹83,000. Even one such client per quarter beats two domestic Tier-2 projects.

The secondary insight — many of these sites were "built in 2008 by a nephew" and run on GoDaddy Website Builder, 1&1 IONOS, or Weebly — is also correct and gives Track A a strong sourcing angle.

### 6.2 Source-by-source feasibility

| Source | Cost | Automatable? | ToS/risk | Verdict |
|---|---|---|---|---|
| **UK Companies House API** | **Free**, 600 req/5 min | ✅ Yes | Clean (official public register) | **GO** |
| Google Ads Transparency Center | Free | ❌ No official API; scraping tooling exists (Apify actor, Chrome exporter) but slow | Grey | **MANUAL, top-10-targets only** |
| US Secretary of State registries | Fragmented: ~half charge $10–50/export; a few free | ❌ Not uniform | Varies | **MANUAL per-state, low priority** |
| BuiltWith bulk datasets | **$295/mo** (Basic); individual lookups free | ✅ but priced out | Clean | **SKIP** |
| Wappalyzer public datasets | Bulk = paid; free tier is lookup-only | ❌ Priced out | Clean | **SKIP** |
| YellowPages/Yelp US/AU/UK | Bot-protected at scale; some free manual browsing | ⚠️ Fragile | ToS-hostile for scraping | **MANUAL curation only** |
| myip.ms free hosting lists | Free, no key | ✅ (static downloads) | Clean | **GOOD for Track C — sites built on GoDaddy/IONOS** |

### 6.3 What to actually build: the UK tradie leg (Track B extension)

The UK Companies House `/companies/search` endpoint accepts `sic_codes`, `incorporated_after`, and pagination — all free with an API key (5-minute application, instant issuance):

```
GET https://api.company-information.service.gov.uk/companies/search?q=&sic_codes=43210,43220,43291,43910,43991,43999,81300,96021,96022&incorporated_after=2026-03-01&items_per_page=20
```

Recommended SIC codes (all verifiable against the official SIC 2007 list):
- **43210** Electrical installation
- **43220** Plumbing, heat & air-conditioning installation
- **43291** Insulation installation
- **43910** Roofing activities
- **43991** Scaffolding erection
- **43999** Other specialised construction n.e.c. (landscaping 81300 also applies)
- **81300** Landscape service activities
- **96021** Hairdressing and other beauty treatment
- **96022** Beauty salon activities
- **69101** Barristers' chambers (high-ticket professional, email-responsive)
- **74101** Interior design (careful — overlaps with competitor agencies; gate tightly)
- **86210** General medical practice, **86220** specialist medical practice, **86230** dental practice (private clinics — proven Kachmo-fit vertical)

For each new company: grab `company_number`, query the profile endpoint, pull registered office address + nature of business, then **probe for a website locally**: DNS A-record on `{name-without-spaces}.co.uk` and common variants, or a HEAD request. If no DNS record resolves → `no_site_confirmed: true` → Track B lead. If a site exists, pass it to **Track A** (site-audit) instead — the same infrastructure feeds both tracks from one registration event. Companies House also exposes charges, filing history, and accounts due dates; a newly incorporated company that has *already* filed charges (borrowed money) is a stronger buying signal than one with none.

**Why the UK and not the US/India:** Companies House is the only registry in this class that is (a) free, (b) programmatic, (c) bulk-capable at 600 req/5 min, and (d) structured enough to filter by SIC + incorporation date in one call. India's MCA21 offers no public bulk API — only paid per-CIN verification services (AuthBridge, Surepass, Zyla) that destroy unit economics at $2.50/mo. US state registries are a 50-jurisdiction patchwork of fees and HTML-only portals; the engineering cost to normalize them exceeds any likely return for a two-person studio. **Pick the one clean lane.**

### 6.4 The Google Ads Transparency Center — how to actually use it (manually)

It has no API and cannot power a pipeline at this budget. But it is excellent for *curating the top 10 dreams*: find 5–10 UK/US tradies or clinics actively spending on Google Ads whose landing pages are weak, then send a highly tailored manual email referencing the ad itself. Volume: 10 research sessions, not 10,000 rows. File this under "sniper," not "machine gun."

### 6.5 Verdict: GO (UK leg), MANUAL (US/AU + Ads Center), SKIP (bulk tech-list providers)

The tradie thesis is correct; only the UK execution path fits the constraints. Build the Companies House ingestion module (it is ~150 lines of TypeScript using the existing axios pattern), run it weekly, and let it feed both Track A (site exists → audit) and Track B (no site → zero-presence email).

---

## 7. Idea 5 — New Business Registrations (UK, India, US)

### 7.1 Premise validity: CONFIRMED with asymmetry

"A business incorporated in the last 6–18 months probably has no website yet" is directionally right, but the *actionability* differs wildly by jurisdiction:

- **United Kingdom — excellent.** Covered in detail in §6.3. Free API, SIC filtering, same module doubles as a Track A/Track B splitter. **This is the one to build.**
- **India — poor.** MCA21 has **no public bulk API**. data.gov.in hosts a "Company Master Data" catalog but no machine-readable bulk download for fresh incorporations; commercial APIs (CompanyData, AuthBridge, Surepass) charge per CIN lookup, which is uneconomic at volume under $2.50/mo. Director/owner details are also paywalled. For Indian zero-presence discovery, **Idea 1 (Maps bootstrap) strictly dominates** — it gives you the phone number, which a company registry would not.
- **United States — poor-to-moderate.** Fragmented across 50 Secretaries of State; a handful (Delaware, Wyoming, California) offer decent free search, but bulk exports are generally paid ($50–200/state). Not a CLI-friendly target at this budget.
- **Worth watching (free, smaller markets):** New Zealand Companies Office and Singapore ACRA both publish free searchable registers with reasonable rate limits. Useful once the UK leg is proven and Dev wants geographic diversification.

### 7.2 The inference gap (important precision)

A registry tells you a company *exists*; it almost never tells you definitively that it has *no website*. Companies House does not store website URLs in a reliable field. So "zero-website" status must be **inferred by absence of evidence** — no resolvable domain for `{name}.co.uk` and no site found on the registered name. That is probabilistic, not certain. Mitigate by labeling these leads honestly in copy: *"we couldn't find a website for [Company]"* rather than *"you have no website."* Small honesty difference, large trust difference.

### 7.3 Verdict: GO for the UK leg (build once, reuse for §6), SKIP India/US legs for now

Do not build three registries. Build one (UK), instrument it, measure reply rate, then decide whether NZ/SG are worth a second module.

---

## 8. Expansion — Channels Beyond the Five

### 8.1 myip.ms free technology/hosting lists (Track C: "dated site, real business")

myip.ms publishes **completely free, no-key, daily-updated lists** of every website hosted on a given IP range or provider. Their Shopify IPs alone list ~440,000 stores; they also carry WordPress, Wix, Squarespace, and critically for Idea 4, **GoDaddy Website Builder, 1&1 IONOS, and Weebly** host ranges. Download pattern:

```
https://myip.ms/browse/sites/1/own/<host_id>   # e.g. Shopify.com host id 376095
# CSV/XLS export buttons present per page; browse paginates by IP block
```

**How Kachmo uses it:** build Track C — a weekly CLI job that downloads the GoDaddy/IONOS/Weebly lists filtered to UK/IN/US IP geos (myip.ms exposes country), cross-references against HISTORY to drop already-contacted domains, and feeds the survivors into the **existing Playwright audit** with a niche-tuned prompt ("outdated DIY-builder site owned by a paying trade business"). These are businesses *with* sites (so Track A works) but with a stack signature that strongly predicts upgrade intent. Cost: $0. Risk: myip.ms rate-limits aggressive bots — one polite weekly download, respect robots.txt.

### 8.2 Founder-led startup discovery at $0 (Track A sourcers)

Replace generic `"backed by Antler India startup"` queries (which attract aggregator listicles) with live founder signals, all free:

- **Product Hunt "Coming Soon" + launched-this-week pages:** maker email frequently public; launch-week founders know their landing page is weak. RSS: `https://www.producthunt.com/rss`.
- **BetaList** (`betalist.com`) and **Indie Hackers** (`indiehackers.com/products`) — founder emails/bios public, early-stage bias means low pride-of-authorship about rough sites.
- **Hacker News "Show HN"** launches — same Firebase/Algolia pipeline as §5.2; a Show HN with a raw README-style landing page is a textbook visual_mismatch lead.
- **YC "Work at a Startup"** company profiles — hiring engineers = funded enough to pay, and hiring pages link to the product site.

Add these as SOURCES queries rather than as a separate subsystem. Example query strings for the SOURCES tab:

```
"Show HN" (landing page OR waitlist) site:news.ycombinator.com 2026
site:betalist.com (India OR "San Francisco" OR London) 2026
"founder" email "looking for" web designer site:indiehackers.com
```

### 8.3 Google-indexed social bios (adjunct to Idea 2, manual)

As noted in §4.2, Google does the Instagram-crawling Kachmo cannot:
```
site:instagram.com "specialty coffee" roastery India "WhatsApp"
site:instagram.com "handmade jewellery" India "DM to order"
site:linkedin.com/in "founder" "artisan" Pune "DM"
```
Curate 10–15/week by hand into an `INTENT-MANUAL` tab.

### 8.4 Paid tools to consciously avoid at this stage

| Tool | Price | Why skip |
|---|---|---|
| SerpApi | $25/mo starter | Exceeds entire monthly budget alone |
| BuiltWith datasets | $295/mo | Two orders of magnitude over budget; myip.ms covers the same stack-signal need for free |
| Wappalyzer bulk | Paid tiers | Same |
| Apollo/ZoomInfo/Crunchbase Pro | $49–99+/mo | Over budget; the leads are not warmer than HN/Companies House |
| Apify premium actors | Usage-based | Only use free-tier actors; never attach a paid actor to a $2.50 budget |

### 8.5 The uncomfortable meta-point: discovery is not the binding constraint

This is the senior-consultant truth the dossier's failure post-mortems point toward but do not say. After three iterations and six defect fixes, the engine now finds *real* businesses with *real* observable problems. Yet Dev is a second-year student running a studio with **zero shipped client work** and a standing rule against fabricating proof. Cold-reply-rate reality:

- Generic cold outbound to strangers: 1–5% reply.
- Excellent targeting + specific observed insight: 5–10% reply.
- Explicit intent (HN `SEEKING FREELANCER`, Wellfound job posts): 20–40% reply.

At 1–2 projects/month at ₹1.5–2.5L, even the optimistic 10% cold rate means **10–20 serious conversations/month**, which requires more volume than a single-student evening can sustain — and more social proof than the studio currently holds. Therefore the highest-leverage investment in late 2026 is probably **not another discovery channel**, but a credibility bridge:

1. **Spec-concept teardown packets** (15 min each): for the top 3 prospects of the week, build a one-screen Figma mock of a stronger hero/CTA, watermarked *"Concept — not commissioned work"*, and attach it to the outreach. This converts "unknown studio making claims" into "someone who already did the work." It is compatible with Commandment #2 *so long as it is explicitly labeled as speculative concept work and never presented on kachmo.in or in the OUTCOMES tab as a client project.* Judgment call for Dev & Aadi to ratify; the guardrail is the watermark + label.
2. **Portfolio-building pricing, time-boxed:** accept 1–2 Tier-1 projects (₹60–90k) at slightly below target in Q4 2026 expressly to generate real case studies, testimonials, and an OUTCOMES entry marked WON. The dossier's own pricing ladder anticipates this ("Even at the very floor — ₹10,000 fast landing pages — cashflow is welcome"). Raise to target pricing once two real wins exist.
3. **Owned-audience distribution** (zero cost): weekly LinkedIn/X posts documenting the teardown reasoning (no client names, no fabricated metrics), tagged with the craft — this pulls inbound interest that arrives warmer than anything a scraper produces. The studio has no shipped work to show, but it *can* show its eyes and its standards.

None of this is in the dossier's hypothesis list, and it likely moves the needle more than any sixth channel. Include it in the roadmap.

---

## 9. Recommended Architecture — Consolidated View

```
                     ┌──────────────────────────────────────────────┐
                     │              SOURCES tab (SHEET)             │
                     │  ─────────────────────────────────────────  │
                     │  TRACK A QUERIES          TRACK B SOURCES    │
                     │  • Show HN launches       • Companies House  │
                     │  • Product Hunt RSS       • Outscraper CSV   │
                     │  • Betalist/IndieHackers  • (manual Maps)    │
                     └───────────────┬──────────────────┬───────────┘
                                     │                  │
          ┌──────────────────────────┘                  └────────────┐
          ▼                                                          ▼
┌─────────────────────┐                                  ┌──────────────────────┐
│  TRACK A: SITE-AUDIT│                                  │ TRACK B: ZERO-PRESENCE│
│  (existing engine)  │                                  │ (NEW)                │
│                     │                                  │                      │
│ Stage A  Search     │                                  │ B1  Discovery        │
│   Grounding          │                                  │     (API-free first) │
│ Stage B  Dedupe      │                                  │ B2  Enrich           │
│ Stage C  Pre-filter  │  + new Gate-1 rule:              │     (DNS/MX, phone)  │
│ Stage D  Playwright  │    "digital acquisition          │ B3  Score            │
│ Stage E  Gemini eval │     signal REQUIRED"             │     (deterministic)  │
│ Stage F  Sheets      │                                  │ B4  Gemini draft*    │
└──────────┬──────────┘                                  └──────────┬───────────┘
           │                                                        │
           ▼                                                        ▼
   TODAY tab                          HISTORY tab      TODAY-ZERO tab   HISTORY-ZERO tab
   OUTCOMES tab (SENT/REPLIED/WON/LOST — shared conversion tracker)
                                      INTENT-HN tab (weekly)
                                      INTENT-MANUAL tab (weekly ritual)
                                      TRACK-C tab (myip.ms builder-stack)
```

*\*Optional — one Gemini gemini-2.5-flash-lite call per accepted lead at ~$0.005, identical to Track A's unit cost.*

**Deduplication across tracks:** HISTORY should grow a `lead_type` column (`site_audit` / `zero_presence` / `intent`) and dedupe on `(domain)` for tracks A/C, `(phone + locality)` for track B, and `(source_url)` for intent leads. Cross-track dedup prevents the embarrassment of emailing the same company through two different angles in one week.

---

## 10. Build Specifications

### 10.1 Gate-1 tightening (drop-in replacement rules for v2.2.1)

Amend the existing fit_gate module (no new dependencies) with these additions, applied before the current ACCEPT list:

```ts
// Pseudo-spec — adapt to reachout's actual schema
if (companyAgeYears > 15 || employeeCountHint >= 50) fit_level = "medium";

const digitalAcquisitionSignals = [
  "join waitlist", "early access", "request invite",      // startup motion
  "book now", "book an appointment", "online booking",    // local service motion
  "add to cart", "checkout", "shop now",                  // commerce motion
  "view pricing", "start free trial", "demo",             // SaaS motion
  "accelerator", "seed round", "pre-seed", "backed by"    // funding motion
];
const hasSignal = pageTextLower.matchCount(digitalAcquisitionSignals) >= 1;
if (!hasSignal && fit_level === "medium") reject("no digital acquisition path");
if (!hasSignal && !isStartupVertical) reject("no observable web-dependent revenue motion");
```

Effect: IMK/MQA/KNS-type firms (Failure #2) fail Gate 1 automatically because a government-tender architecture practice has no waitlist, booking, cart, or funding signal. The engine stops wasting AI calls on them.

### 10.2 Zero-Presence Opportunity Score (TypeScript-ready)

Deterministic, no AI. Scale 0–100; threshold `≥62` to accept for drafting, `≥75` auto-prioritize to top of TODAY-ZERO.

```ts
function opportunityScore(l: ZeroPresenceLead): number {
  const categoryPremium: Record<string, number> = {
    dental_clinic: 22, aesthetic_clinic: 22, cosmetic_injector: 24,
    dental_practice_uk: 20, medical_practice_uk: 20,
    specialty_coffee: 14, cafe_roastery: 14,
    wedding_photographer: 16, photography_studio: 14,
    roofing: 20, hvac: 20, landscaping: 16, plumbing: 18, electrical: 18,
    interior_design: 16, law_firm_uk: 18, boutique_retail: 12,
    gym_yoga: 12, bakery: 10, jewellery: 14,
  };
  const score = 0
    + (categoryPremium[l.category] ?? 12)                       // max 24
    + Math.min(18, Math.log1p(l.review_count) * 4.2)            // up to 18; 50 rev≈16.5, 300 rev≈18
    + (l.rating >= 4.5 ? 10 : l.rating >= 4.2 ? 7 : l.rating >= 4.0 ? 4 : 0)  // up to 10
    + (l.listing_age_days && l.listing_age_days <= 365 ? 14     // new-ish business: 14
       : l.listing_age_days && l.listing_age_days <= 730 ? 8 : 4)
    + (l.whatsapp_capable ? 10 : l.email ? 6 : 2)               // reachable decision-maker: up to 10
    + (l.no_site_confirmed ? 16 : 4)                            // confirmed no-site bonus: 16
    - (categoryPremium[l.category] !== undefined ? 0 : 6)       // unknown category penalty
    - (isLikelyChainOrFranchise(l.name) ? 12 : 0);              // franchise → no owner autonomy
  return Math.max(0, Math.min(100, Math.round(score)));
}
```

Rationale for weights: review volume and rating proxy commercial health without any paid data; WhatsApp/email directness proxies reachability (Gate 4); the no-site confirmation bonus encodes the paradox insight; the franchise penalty avoids national chains where local managers can't buy websites.

### 10.3 Companies House ingestion module (concrete contract)

```ts
// config
const CH_KEY = process.env.COMPANIES_HOUSE_API_KEY; // basic-auth password; key is username ""
const BASE = "https://api.company-information.service.gov.uk";

// Step 1: search (1 call, returns up to 20 per page; page via start_index)
GET `${BASE}/companies/search?q=&sic_codes=${SICS.join(",")}&incorporated_after=${sixMonthsAgoISO}&items_per_page=20&start_index=${n}`
  → items[].company_number, title, address_snippet, date_of_creation

// Step 2: profile (1 call each, ~50/day is fine under 600/5min)
GET `${BASE}/company/${number}`
  → company_name, registered_office_address, company_status, type,
    has_charges, has_insolvency_history, last_full_members_list_date,
    accounts.next_due, confirmation_statement.next_due

// Enrichment (local, $0):
//   - variants of registered name → dns.resolveAny() A + MX
//   - if no A record for any variant → no_site_confirmed = true
//   - phone/email NOT in Companies House → mark null; manual find later

// Output row → TODAY-ZERO tab via existing Sheets append helper
```

Rate discipline: 20 searches + 40 profiles = 60 calls per weekly run. Well under the 600/5-min window even with retries. Cost: £0.

### 10.4 Hacker News intent parser (concrete contract)

```ts
// Step 1: latest item id
GET https://hacker-news.firebaseio.com/v0/maxitem.json → 458xxxxx
// Step 2: walk backwards ~400 items until finding "Ask HN: Freelancer? Seeking freelancer?" title (monthly)
GET https://hacker-news.firebaseio.com/v0/item/${id}.json → {type:"story", kids:[...]}
// Step 3: fetch each kid comment; keep those whose text startsWith "SEEKING FREELANCER"
//         extract first 200 chars + author + permalink (https://news.ycombinator.com/item?id=${cid})
// Output → INTENT-HN tab; cache seen comment ids in a small local JSON set to dedupe across runs
```

Run weekly on Monday 06:00 UTC alongside the batch, in the same CLI under a `--intent` flag. Cost: $0.

### 10.5 Sheet-schema changes (add to existing CRM)

New tabs (24-column discipline preserved on TODAY):
- `TODAY-ZERO`: mirror TODAY columns 1–24, prepend `lead_type="zero_presence"` and `priority_score` = opportunity_score.
- `HISTORY-ZERO`: `phone, locality, name_hash, contacted_date, outcome`.
- `INTENT-HN`: `date_seen, author, title, url, snippet, location, remote, status`.
- `INTENT-MANUAL`: `date_added, source_platform, person, company, role_hiring, url, status`.
- `TRACK-C-BUILDER`: `domain, builder_stack, country, niche_hint, status`.

One shared `OUTCOMES` tab continues to hold SENT/REPLIED/WON/LOST keyed by `lead_id` so conversion rates compare fairly across tracks. **Instrumentation requirement:** every appended row carries `track:` so Dev can see, month over month, which channel actually converts. Blind volume is how pipelines become busywork.

### 10.6 Circuit breaker re-tune (change in `src/cost-guard.ts`)

```ts
const MONTHLY_CAP_SOFT = 2.00;   // was 2.50 (breaker); 2.50 becomes a hard emergency abort
const MONTHLY_CAP_HARD = 2.50;   // new: absolute last-resort exit
// alert at 70% of soft cap (~$1.40) via a GitHub Actions job summary line
```

Rationale in §1.1. Also log per-run cost into a tiny `artifacts/spend-log.json` so the actual unit cost is measured, not assumed — the $0.064 vs $0.088 spread matters for capacity planning.

---

## 11. Recommended SOURCES Tab (replacement matrix)

The current 10 queries are strong on Indian startups (and did find AMnova/Kroop). Keep them; **append** these, organized by track. When SOURCES has rows it overrides the built-in bank, so keep the active set tight — 12–16 enabled queries max to protect the alternate-day budget.

**Track A — site-audit sourcers (startup/D2C-with-site):**
1. `"Show HN" (landing page OR waitlist) "looking for" designer` — live founder launches
2. `site:betalist.com ("India" OR "United States") 2026` — pre-launch startups
3. `site:indiehackers.com/products founder email 2026` — bootstrapped makers
4. `"backed by" ("Antler India" OR "100X.VC") startup site:linkedin.com/company 2025..2026` — funded, narrower than generic web search
5. `site:wellfound.com/company ("web designer" OR "framer" OR "webflow")` — startups already hiring design help (cross-post to INTENT-MANUAL)

**Track B — zero-presence sourcers:**
6. *(manual)* Outscraper CSV import — "specialty coffee" cafe roastery Pune OR Mumbai, 50–500 reviews, no website
7. *(manual)* Outscraper CSV import — dental clinic / aesthetic clinic Pune OR Bangalore, 100+ reviews, no website
8. `site:company-information.service.gov.uk incorporated 2026 (roofing OR plumbing OR landscaping)` — UK tradie names for manual follow-up (the API handles the rest)

**Intent (appended as enabled queries that route to INTENT-HN / INTENT-MANUAL, not to TODAY):**
9. `hnrss.org/newest?q=SEEKING+FREELANCER` — parsed by the HN module
10. `site:news.ycombinator.com "Seeking freelancer" 2026` — backup HN surface

Disable the three weakest legacy queries from the original ten (generic `"boutique consulting" firm India partners services`, generic `"branding studio"` which skews competitor-heavy, and broad `"new D2C brand India launch"` which surfaces press releases) once the Show HN + BetaList queries prove themselves. Measure via the `track:` column in OUTCOMES before cutting.

---

## 12. Outreach Copy Guardrails + Compliant Templates

All templates honor the six commandments: plural voice ("we"), zero fabrication, no SEO spam (no H1/meta/PageSpeed mentions, no DOM metrics), peer-to-peer tone, **under 120 words**, and the required signature block.

### Template 1 — Zero-presence, Indian clinic (WhatsApp-capable, email-first)

**Subject:** Your Koregaon Park listing — and the missing website

> Hello — we noticed your clinic shows around 300 reviews on Google Maps but there's no website linked to the listing, so people land on your profile and have to call to book.
>
> We run a small design-and-engineering studio in Pune. We build clean, fast single-page sites for clinics — clear services, visible phone/booking, mobile-first — typically delivered in 10–14 days.
>
> If a simple site that turns your Maps visitors into enquiries is useful, reply and we'll share a short concept sketch. Either way, keep up the strong work on the reviews.
>
> Dev & Aadi | Kachmo Studios | studios@kachmo.in | https://www.kachmo.in/

*(~85 words)*

### Template 2 — Zero-presence, UK newly incorporated company (email-found via domain probe)

**Subject:** Quick question about [Company Name]'s online presence

> Hello — we're a design and engineering studio that works with newly established UK practices. While researching [sector] firms incorporated this year, we couldn't find a website for [Company Name].
>
> Many founders leave the site for later, then find it slows down enquiries once trading begins. We specialise in concise, high-performance sites for professional practices — services, credentials, and a clear way to get in touch — delivered in 3–4 weeks.
>
> Worth a brief conversation? Reply and we'll send a one-page outline tailored to [sector].
>
> Dev & Aadi | Kachmo Studios | studios@kachmo.in | https://www.kachmo.in/

*(~80 words; note the honest "couldn't find" framing from §7.2)*

### Template 3 — Site-audit, startup with observable gap (Track A)

**Subject:** The hero on [ProductName] reads differently on mobile

> Hello — we were looking at [ProductName] and the concept is compelling, but the hero section loses its hierarchy on a phone viewport: the primary action sits below the fold and the value proposition competes with the background.
>
> We're a design-led studio in Pune. We help early-stage teams ship landing pages where the first screen earns the signup — scroll-driven polish without the bloat. A focused hero + CTA pass typically takes us 7–10 days.
>
> If this resonates, reply and we'll mock up what a tightened first screen could look like.
>
> Dev & Aadi | Kachmo Studios | studios@kachmo.in | https://www.kachmo.in/

*(~85 words; cites only what a mobile viewport visibly shows — no H1, no meta, no LCP number)*

**Golden rule for all Track B messages:** never reference anything the listing does not prove. "Your listing shows 312 reviews with no website linked" is defensible. "Your website is slow" when they have no website is a credibility killer. If in doubt, delete the claim.

---

## 13. Prioritized Roadmap

### Week 1 — Stabilize and seed (engineering: ~4h; operator: ~2h)
- [ ] Switch GitHub Actions cron from daily to **alternate-day** (e.g., Mon/Wed/Fri 06:00 UTC). Rationale §1.1.
- [ ] Lower soft circuit breaker to **$2.00**, hard to $2.50; add per-run cost logging to `artifacts/spend-log.json`.
- [ ] Implement Gate-1 tightening (digital-acquisition signal requirement + age/staff cap→medium→never-email).
- [ ] Outscraper one-time export: **500 Indian businesses** across 3 niches, 50–500 reviews, no website. Populate `TODAY-ZERO` manually. First sends begin.
- [ ] Operator ritual locked: Mon/Wed/Fri batch review; Tue/Thu 20-min intent scan.

### Week 2 — Track B backbone (engineering: ~5h)
- [ ] Companies House module (§10.3): weekly cron, UK premium SIC codes, DNS-based no-site inference, dual-feed to Track A when a site exists and Track B when absent.
- [ ] Opportunity Score (§10.2) wired into TODAY-ZERO; threshold 62 accept / 75 priority.
- [ ] New tabs: TODAY-ZERO, HISTORY-ZERO, OUTCOMES gains `track` column.

### Week 3 — Intent channel (engineering: ~2h; operator: ~1h setup)
- [ ] HN `SEEKING FREELANCER` parser (§10.4): weekly Monday run, INTENT-HN tab, local dedupe set.
- [ ] Wellfound + LinkedIn saved-search ritual documented; INTENT-MANUAL tab seeded.
- [ ] First spec-concept teardown packet built for the top-ranked zero-presence lead; watermark + "Concept — not commissioned work" label applied. Measure reply delta vs non-attached emails in OUTCOMES.

### Week 4 — Consolidate and measure
- [ ] Track C (myip.ms GoDaddy/IONOS lists) — only if Weeks 1–3 show ≥8 qualified sends/week consistently. Otherwise defer.
- [ ] **Read the numbers, not the hopes:** sends, replies, positive replies, calls booked, WON by `track`. Kill or halve any channel whose reply rate is below 3% after 60 sends. Double down on the top performer.
- [ ] Decide the pricing question from §8.5: if reply volume is healthy but close-rate is low due to zero case studies, approve one below-target Tier-1 project explicitly as portfolio acquisition.

### Weeks 5–6 — Iterate
- [ ] Add ONE new SIC cluster or ONE new Maps niche based on what replied.
- [ ] Consider NZ (Companies Office) or SG (ACRA) registration feed only if UK reply rate clears 8%.
- [ ] Publish first teardown-style craft post on LinkedIn/X (no client identifiers, no fabricated metrics) to seed inbound.

---

## Appendix A — Data Source Scorecard

| Source | Cash cost | Automation fit | ToS / ban risk | Freshness | Role in plan |
|---|---|---|---|---|---|
| UK Companies House API | £0 | Excellent (600 req/5 min) | None (official register) | Daily filings | **Track B backbone + Track A feeder** |
| Outscraper Maps free tier | $0 one-shot (500 records) | Manual export | None (provider absorbs anti-bot) | Live | **Track B seed** |
| Apify Google Maps actors | $5 credits/mo free plan | Good | Low (via provider) | Live | Monthly top-up |
| Google Places API (official) | $7–32/1k req after Mar-2025 credit removal | Good | None | Live | ❌ Priced out at $2.50/mo |
| HN Firebase/Algolia API | $0 | Excellent | None | Real-time | **INTENT-HN (GO)** |
| Wellfound job board | $0 | Manual only | ToS-grey for scraping | Daily | INTENT-MANUAL weekly |
| LinkedIn Jobs | $0 (manual) / $30+ (scrapers) | Poor | High for scraping | Daily | INTENT-MANUAL weekly; skip automation |
| X / Twitter API | Pay-per-use (free gone Feb-2026) | N/A | N/A | Real-time | ❌ SKIP |
| Reddit API (.json) | $0 but killed May 30, 2026; OAuth gated | Dead | N/A | — | ❌ SKIP |
| Instagram Graph API | $0 | Cannot filter third-party profiles | High for scraping | Live | MANUAL-ONLY, deprioritized |
| myip.ms hosting lists | $0 | Good (weekly static download) | Low if rate-respected | Daily | **Track C candidate** |
| BuiltWith datasets | $295/mo | Excellent | Clean | Weekly | ❌ SKIP — myip.ms covers need |
| Wappalyzer bulk | Paid | Good | Clean | Daily | ❌ SKIP |
| MCA21 (India) | Paid per-CIN only; no bulk API | Poor | Clean | — | ❌ SKIP — use Maps for India |
| US SOS registries | $10–50/state, fragmented | Poor | Varies | — | MANUAL only, low priority |
| Google Ads Transparency Center | $0 | Manual only | Clean | Live | Top-10 sniper research |

---

## Appendix B — Evidence Notes (for reconciliation)

- Google Business Profile website shutdown: multiple independent confirmations, effective **March 1, 2024**, redirects removed June 2024; ~21M affected businesses estimated.
- Google Maps Platform credit removal: recurring $200/mo credit ended **March 1, 2025**, replaced by Essentials/Pro/Enterprise subscription tiers; new accounts receive a **one-time $300 trial credit** only. Places Nearby Search observed at $7–32/1k requests; Autocomplete/Text Search lower end ~$2–5/1k.
- X API: free tier discontinued **February 2026**, pay-per-use credits thereafter; no search access on free tier.
- Reddit: unauthenticated `.json` endpoints returned 403 as of **May 30, 2026**; OAuth read access exists but requires app approval under the Responsible Builder Policy.
- UK Companies House API: free, **600 requests per 5-minute window**; `/companies/search` supports `sic_codes=` and `incorporated_after=`; no per-call charge.
- Instagram Graph API: no third-party public username lookup; follower metrics limited to owned Business/Creator accounts; Business Discovery restricted.
- HN: Firebase official API (`hacker-news.firebaseio.com`) and Algolia index (`hn.algolia.com`, ~10k req/day fair use) both free and unauthenticated for light read access.
- myip.ms: free daily website-by-host lists with CSV/XLS export; rate-limit aggressive crawlers.
- Reachout codebase status: the `Clients/reachout/` engine lives in a **separate repository** not connected to this MCP session (per CLAUDE.md workspace layout: "`Clients/reachout/` is a separate repo"). Recommendations above are grounded in the dossier's authoritative architecture description and independent verification of external systems; implementers should reconcile against the live codebase before merging.

---

## Closing Recommendation

The lead engine's next inflection does not come from a sixth discovery idea. It comes from three disciplined moves: **(1)** cut to alternate-day batches and re-tune the circuit breaker so the system lives within its own rules; **(2)** split the single site-audit pipeline into Track A (audited sites, now gated against the "good enough" trap) and Track B (zero-presence leads from Companies House + the Outscraper seed), which is where the genuinely high-intent inventory lives; and **(3)** acknowledge that discovery without proof caps close-rates, and deliberately build proof through labeled spec-concept outreach and one or two portfolio-priced wins. Execute Weeks 1–3, instrument everything by `track`, and let October's OUTCOMES tab decide the rest.

— *End of report*