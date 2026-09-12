# Lead Engine Overhaul — Complete Context & Execution Brief

> **Document Type:** AI Agent Execution Brief (Handoff to Claude Code)  
> **Authority:** This document is the single source of truth for all lead engine changes.  
> **Status:** APPROVED — Execute immediately upon reading.  
> **Created:** September 2026  
> **Author:** Dev Jaiswal (Co-Founder, Kachmo Studios)  

---

## 0. HOW TO USE THIS DOCUMENT

You are Claude Code. You have been given this document as the complete context needed to overhaul the Kachmo Lead Engine at `Kachmo/Clients/reachout/`. Read it top to bottom before writing any code. Every section matters.

**Your mission:** Transform the lead engine from a tool that discovers fellow designers and sends SEO-spam emails into a tool that discovers real paying businesses with outdated websites and crafts peer-level studio outreach.

**Key constraint:** Kachmo is a brand-new studio (early 2026). We have zero shipped client case studies. We cannot bluff. We can only demonstrate craft through our own website (`kachmo.in`) and offer genuine technical value. Even ₹10,000 ($120) clients are acceptable at this initial stage.

---

## 1. WHAT IS KACHMO STUDIOS (Full Context)

### 1.1 Identity

**Kachmo Studios** is an independent creative and technology studio co-founded by **Dev** and **Aadi**. Based in Pune, India, operating globally.

- **Website:** `https://www.kachmo.in/`
- **Email:** `studios@kachmo.in`
- **Phone:** `+91 9756777417` / `+91 8779786640`

### 1.2 Core Positioning

> **A creative studio with serious technical capability.**

Kachmo occupies the intersection of design-led visual craft and production-grade software engineering. It is NOT a generic web development agency, NOT an SEO firm, NOT a template flipper, NOT a DevOps consultancy.

### 1.3 What Kachmo Actually Sells (Services)

**Tier 1 — Primary Commercial Focus (What We Actively Sell):**
- Bespoke marketing websites and digital experiences
- Creative frontend and interactive web development (animations, scroll-driven effects, responsive systems)

**Tier 2 — Secondary (Delivered as Part of Website Projects):**
- Brand identity and visual design (selective, on fit)
- Custom dashboards and internal tools
- Payment integrations (Stripe, Razorpay)
- Performance and accessibility optimization
- Custom CMS wiring (Sanity, MDX, headless)

**Tier 3 — Excluded from Current Brand:**
- Cloud-native infrastructure (future sister brand)
- Security engineering (future sister brand)

### 1.4 Studio Voice Commandments (MUST be reflected in all outreach)

1. **Plural Voice:** Always "we" / "our studio" / "the studio". NEVER "I" or "my".
2. **Specificity Over Cleverness:** Name exact problems, exact CSS issues, exact load times. Not buzzwords.
3. **Active Voice & Plain Verbs:** "We build", "We scope", "We ship".
4. **Zero Filler:** Kill words like "synergy", "paradigm", "cutting-edge", "digital transformation".
5. **Transparent Honesty:** State what we do and don't do. No fabrication.
6. **Reader-Centric:** Frame everything from the client's business problem.

### 1.5 What Kachmo MUST NEVER Feel Like

| MUST NOT Feel Like | MUST Feel Like |
| :--- | :--- |
| A cheap SEO audit spammer | An elite, specialized creative studio |
| A generic digital marketing agency | Deliberate, bespoke, and modern |
| A solo freelancer sending cold emails | A peer-level creative-technology partnership |
| A template flipper from Fiverr/Upwork | Confident, specific, and direct |
| A DevOps/infrastructure consultancy | Design-led, engineering-capable |

### 1.6 The Zero-Fabrication Rule

Kachmo has NO shipped client case studies yet. We CANNOT reference:
- Past client logos
- Client testimonials
- "Trusted by X companies"
- Any made-up portfolio pieces

We CAN reference:
- Our own studio website (`kachmo.in`) as a demonstration of craft
- Our technical capabilities and standards
- Genuine observations about the prospect's website
- Our studio principles

---

## 2. WHAT WENT WRONG: POST-MORTEM OF THE AUGUST 2026 BATCH

The first live run produced 16 "qualified" leads into Google Sheets. Every single one was useless. Here is the forensic breakdown.

### 2.1 The Leads Were Fellow Designers, Not Clients

| Lead Discovered | What They Actually Are | Why It's Terrible |
| :--- | :--- | :--- |
| **Elephant Design** | 100+ person design institution (est. 1989, Pune/Delhi/Singapore) | Pitching India's oldest design house as a student offering H1 fixes = instant spam |
| **The Minimalist** | 150+ employee brand agency in Mumbai | Has full in-house engineering. Missing meta description pitch = marked as spam |
| **Monsoonfish** | 50+ person dedicated UI/UX agency in Pune | Selling CSS fixes to a UI/UX studio founder. Insulting. |
| **Thought Over Design** | High-end Mumbai branding boutique | Scraped email was `hrteam@...`. Pitched HR about font loading. |
| **NH1 Design** | Established branding studio | Fellow peer. Should be pitched as PARTNER, not client |
| **Stratedgy** | Branding studio | Same — wrong relationship framing |
| **Beyondesign** | Branding studio with own developers | Has its own tech team |
| **DesignerPeople** | Packaging design studio | Not a client archetype |
| **OH! Design Studio** | Branding studio | Competitor, not client |
| **Octet Design Studio** | UI/UX design studio | Direct competitor |
| **Granth** | Advertising agency | Has own production team |
| **Litmus Branding** | Full-service branding agency | Has own digital team |
| **Yellow** | Creative agency | Has own digital capabilities |
| **Yellow Frames** | Video production + branding agency | Marginal fit at best |
| **152Co.** | Content studio | Not a website buyer |
| **Fruture Studio** | Digital marketing agency | Competitor, not client |

**Root cause: The discovery queries searched for designers, not for businesses that NEED designers.**

### 2.2 The Queries Were Searching for Competitors

```
FAILED QUERIES (what we searched):
- "freelance graphic designer"        → finds other freelance graphic designers
- "ui ux designer portfolio"          → finds other UI/UX studios
- "copywriter portfolio"              → finds copywriters showing their work
- "photographer portfolio"            → finds photographers, not photo businesses
- "webflow designer"                  → finds Webflow developers
```

**These queries are BACKWARDS.** Searching for `"ui ux designer portfolio"` returns pages of designers showing off their own work — exactly our competitors.

### 2.3 The Outreach Emails Were SEO Spam

The drafted emails contained lines like:
- *"Your site is missing an H1 heading element..."*
- *"The meta description tag is currently missing from your head..."*
- *"Failed network request for font GraficalBold..."*
- *"Blocked Wix analytics request..."* (which was OUR OWN browser interception!)

> **This is the exact playbook of cheap offshore SEO spammers.** Every creative director in India has received 500 of these. Sending this from `studios@kachmo.in` destroys our premium positioning before the recipient even opens `kachmo.in`.

---

## 3. THE TARGET CLIENT TAXONOMY (Exhaustive)

This is the core of the overhaul. The lead engine must search for **BUSINESSES WITH MONEY WHOSE CURRENT WEBSITE DOESN'T MATCH THEIR REAL-WORLD QUALITY**. Not fellow designers.

### 3.1 ARCHETYPE 1: High-Ticket Boutique Service Firms (Direct Clients)

These are businesses that charge ₹5L–₹1Cr+ per engagement but have embarrassingly bad websites. A ₹60K–₹2.5L website is trivial cost for them and pays for itself by landing one additional client.

#### Architecture & Spatial Design
```
SEARCH FOR THESE:
- "architecture firm" + city (Mumbai | Delhi | Bangalore | Hyderabad | Chennai | Pune | Ahmedabad | Goa | Jaipur | Kolkata | Chandigarh | Kochi)
- "architecture studio" portfolio projects
- "residential architecture" + city + portfolio
- "commercial architecture" + city + projects
- "interior architecture" + city + portfolio
- "landscape architecture firm" + city
- "sustainable architecture studio" + India
- "heritage conservation architect" + India
- "hospitality architecture" + city + projects
- "retail architecture design" + India
- "institutional architecture" + city
- "industrial architecture firm" + India
```

**Why they buy from Kachmo:** Architecture firms do ₹50L–₹10Cr physical projects. Their websites are often 2018 WordPress themes with pixelated renders. When pitching high-net-worth residential clients or winning commercial tenders, a slow ugly website undermines their credibility. They have ZERO in-house tech talent.

#### Interior Design Studios
```
- "interior design studio" + city + "residential projects"
- "luxury interior designer" + city
- "commercial interior design" + city
- "hospitality interior design" + city
- "office interior design firm" + city
- "retail interior design" + city
- "turnkey interior solutions" + city
```

**Why they buy:** Same as architecture. High-ticket physical work, terrible digital presence. No tech staff.

#### Real Estate Developers & Brokers (Boutique)
```
- "luxury real estate developer" + city
- "boutique real estate" + city + projects
- "premium apartments" + city + developer (NOT property portals)
- "villa projects" + city + developer
- "commercial real estate developer" + city
- "plotted development" + city
- "real estate brokerage firm" + city (boutique, not national chains)
```

**Why they buy:** Sell ₹1Cr–₹20Cr properties. Need stunning project showcase websites with virtual tours, gallery pages, and clear CTA for site visits. Currently using generic builder templates or Justdial listings.

#### Commercial Film & Video Production
```
- "production house" + city + "commercials" showreel
- "ad film production" + city
- "commercial video production" + city
- "brand film production house" + city
- "corporate video production" + city
- "music video production" + city + portfolio
- "documentary production house" + city
```

**Why they buy:** Charge ₹5L–₹50L per ad film but showcase reels via YouTube links or broken Squarespace sites. Need a cinematic portfolio website with smooth video playback.

#### Photography Studios (Commercial, Not Hobbyist)
```
- "commercial photography studio" + city
- "advertising photography" + city
- "product photography studio" + city
- "food photography studio" + city
- "fashion photography studio" + city
- "wedding photography studio" + city + "luxury"
- "industrial photography" + city
- "corporate event photography" + city
- "architectural photography" + city
```

**Why they buy:** Charge ₹50K–₹5L per shoot. Portfolio is their #1 sales tool but often hosted on slow WordPress galleries with no mobile optimization. Need fast-loading, full-bleed image showcases.

#### Law Firms & Legal Advisory (Boutique)
```
- "boutique law firm" + city + "partners" "practice areas"
- "corporate law firm" + city
- "IP law firm" + city
- "real estate law firm" + city
- "tax advisory firm" + city
- "arbitration law firm" + city
- "litigation firm" + city + partners
```

**Why they buy:** Charge ₹1L–₹50L per matter. Website is their credibility signal to potential clients. Currently running early-2010s WordPress themes. Zero tech knowledge.

#### Medical & Healthcare Specialists (Premium)
```
- "cosmetic dermatology clinic" + city
- "aesthetic clinic" + city
- "dental clinic" + city + "cosmetic"
- "IVF clinic" + city
- "hair transplant clinic" + city
- "plastic surgery clinic" + city
- "ayurvedic wellness center" + city
- "physiotherapy clinic" + city + "sports"
- "eye surgery clinic" + city + "LASIK"
- "mental health clinic" + city
- "veterinary hospital" + city + premium
```

**Why they buy:** Patient acquisition is 80% digital. Charge ₹50K–₹10L per procedure. Current websites are either ugly WordPress themes or generic template builders. Need trust-inspiring, modern websites with appointment booking.

#### Hospitality & Restaurants (Premium)
```
- "boutique hotel" + city
- "luxury resort" + city + India
- "heritage hotel" + city
- "fine dining restaurant" + city
- "cafe" + city + "specialty coffee"
- "cloud kitchen brand" + city
- "catering company" + city + premium
- "event venue" + city
- "co-living space" + city
- "hostel" + city + "premium"
```

**Why they buy:** Guests judge by website before booking. Charge ₹5K–₹50K/night. Current sites are often Wix/Squarespace with broken booking flows.

#### Financial Services & Wealth Management (Boutique)
```
- "wealth management firm" + city
- "financial advisory firm" + city
- "chartered accountant firm" + city
- "mutual fund distributor" + city
- "insurance advisory" + city
- "family office" + city + India
- "portfolio management service" + city
```

**Why they buy:** Manage ₹1Cr–₹500Cr portfolios. Trust and credibility are everything. Their websites look like 2005 GeoCities pages.

#### Education & Training (Premium)
```
- "coaching institute" + city + (IIT | NEET | CAT | UPSC)
- "music school" + city
- "dance academy" + city
- "art school" + city
- "language institute" + city
- "skill training center" + city
- "study abroad consultancy" + city
- "preschool" + city + premium
- "international school" + city
- "driving school" + city
```

**Why they buy:** Student/parent acquisition is digital. Charge ₹50K–₹5L/year per student. Need clean, informative, trust-building websites.

#### Fitness & Wellness
```
- "gym" + city + premium (NOT chain gyms)
- "yoga studio" + city
- "pilates studio" + city
- "crossfit gym" + city
- "martial arts academy" + city
- "personal trainer" + city + studio
- "spa" + city + luxury
- "wellness retreat" + city
```

**Why they buy:** Membership-driven. Need online booking, class schedules, trainer profiles. Current sites are Instagram-only or broken WordPress.

#### Professional Services & Consulting
```
- "management consulting firm" + city + boutique
- "HR consulting firm" + city
- "IT staffing company" + city
- "recruitment agency" + city + niche
- "PR agency" + city (NOT large national)
- "event management company" + city
- "wedding planner" + city + luxury
- "immigration consultancy" + city
- "patent attorney" + city
```

**Why they buy:** Professional services = trust = digital credibility. Most have template-built sites that don't reflect their actual quality.

#### Retail & E-Commerce (Boutique Brands)
```
- "handmade jewelry brand" + city
- "organic skincare brand" + India
- "designer clothing brand" + city
- "home decor brand" + India
- "artisan food brand" + India
- "custom furniture" + city
- "leather goods brand" + India
- "stationery brand" + India
- "eyewear brand" + India
- "fragrance brand" + India
```

**Why they buy:** D2C brands need beautiful, fast, converting storefronts. Many are running generic Shopify themes that look identical to competitors.

#### NGOs, Social Enterprises & Trusts
```
- "NGO" + city + education
- "charitable trust" + city
- "social enterprise" + India
- "foundation" + city + (health | education | environment)
- "animal shelter" + city
```

**Why they buy:** Need donation pages, impact storytelling, volunteer signup. Current sites are ancient. Often have grant/CSR funding for website projects. Lower budget (₹10K–₹60K) but great portfolio pieces and feel-good work.

### 3.2 ARCHETYPE 2: Funded Startups & Tech Ventures

```
- "backed by" + (Surge | "Peak XV" | "Y Combinator" | "Blume" | "Sequoia" | "Accel" | "Matrix Partners" | "Kalaari" | "Lightspeed" | "3one4" | "Stellaris" | "100X.VC" | "Better Capital" | "Titan Capital" | "AngelList India") + site:*.com
- "pre-seed startup" + India + (fintech | healthtech | edtech | agritech | climatetech | legaltech | proptech)
- "seed funded startup" + India + 2025 OR 2026
- "series A startup" + India + 2025 OR 2026
- "YC startup" + India
- crunchbase.com OR tracxn.com + "India" + "seed" + 2025 OR 2026 (for discovery, not for pitching)
```

**Why they buy:** Need to announce a fundraise, launch a product, recruit talent. Generic Webflow templates look identical to every competitor. Big agencies quote $40K+ and 16 weeks. Kachmo offers elite craft in 3-4 weeks for ₹60K–₹2.5L.

### 3.3 ARCHETYPE 3: Design Studios as WHITE-LABEL PARTNERS (Not Clients!)

> **CRITICAL: These are NOT pitched as customers. They are pitched as PARTNERS.**

```
- "branding studio" + city + portfolio (2-15 people, NO 50+ agencies)
- "graphic design studio" + city
- "packaging design studio" + city
- "brand identity studio" + city
```

**The Partnership Pitch (NOT the client pitch):**
> *"We don't do branding. We engineer the interactive digital experiences your team designs in Figma. When your clients need high-performance custom Next.js or interactive Webflow builds, we are your engineering co-pilot."*

**Why it works:** These studios are masters of brand strategy, logos, and packaging but hate coding. When their branding clients ask for a website, they either turn it down, botch it with Elementor, or struggle with unreliable freelance coders. Kachmo becomes their reliable tech arm.

### 3.4 ARCHETYPE 4: Small Businesses & Local Services (Entry-Level, ₹10K–₹60K)

Since Kachmo is just starting, even small gigs build portfolio and cash flow:

```
- "bakery" + city
- "salon" + city + premium
- "pet grooming" + city
- "florist" + city
- "tailor" + city + custom
- "print shop" + city
- "auto garage" + city + specialist
- "tuition teacher" + city
- "music teacher" + city
- "dance class" + city
- "home cleaning service" + city
- "pest control" + city
- "plumber" + city (business, not individual)
- "electrician" + city (business, not individual)
- "courier service" + city + local
- "laundry service" + city
- "dietitian" + city
- "psychologist" + city
- "physiotherapist" + city
- "dentist" + city (independent practice)
```

**Why they buy:** Need a simple, clean website for Google presence. Currently have only a JustDial listing or no web presence at all. Budget is ₹10K–₹30K but this is fast work (2-3 days), builds portfolio, and generates cash flow.

---

## 4. EXACT CODE CHANGES REQUIRED

### 4.1 File: `src/discover/query-builder.ts`

**REPLACE** the entire `DEFAULT_QUERIES` array. The current queries search for designers. The new queries must search for BUSINESSES that need websites.

```typescript
// CURRENT (BROKEN):
export const DEFAULT_QUERIES: SourceQueryConfig[] = [
  { query: '"branding studio" portfolio', targetNiche: 'Branding Studio', enabled: true },
  { query: '"design agency" projects case studies', targetNiche: 'Design Agency', enabled: true },
  // ... all of these find other designers
];

// REPLACE WITH queries from Section 3 of this document.
// Organize by archetype and niche. Include city rotation.
```

**Implementation guidance:**
- Each query should have a `targetNiche` that maps to the business type (e.g., `'Architecture Firm'`, `'Luxury Interior Studio'`, `'Cosmetic Clinic'`)
- Add city rotation: queries should cycle through Indian metro cities (Mumbai, Delhi, Bangalore, Hyderabad, Chennai, Pune, Ahmedabad, Jaipur, Kolkata, Chandigarh, Kochi, Goa)
- Also add international cities for higher-ticket leads: Dubai, Singapore, London, New York, Toronto, Sydney
- Add `-site:` exclusions for JustDial, Practo, Sulekha, IndiaMart, TradeIndia, and other directory/listing sites
- Keep the existing exclusions for social media and portfolio platforms

### 4.2 File: `src/evaluate/prompts.ts`

#### 4.2.1 REPLACE `buildSystemPrompt()` — System Identity

**CURRENT (BROKEN):**
```typescript
`You are the senior technical prospect analyst for an elite freelance web developer`
`specializing in custom responsive web builds, performance engineering, and modern`
`CMS migrations (Webflow, Next.js, Framer).`
```

**This says "freelance web developer" — that's exactly what Kachmo is NOT.**

**REPLACE WITH:**
```
You are the senior prospect analyst for Kachmo Studios (https://www.kachmo.in/),
an independent creative and technology studio specializing in bespoke, high-performance
websites and interactive digital experiences. Kachmo is co-founded by Dev and Aadi,
and positioned as a design-led studio with serious engineering capability.

Your task is to evaluate whether a discovered business website represents a genuine
commercial opportunity for Kachmo Studios — meaning the business has real revenue,
their current website visibly underperforms compared to the quality of their actual
work or services, and they would benefit from a modern, high-craft website rebuild.

You are NOT looking for fellow designers or agencies. You are looking for BUSINESSES
(architecture firms, clinics, law firms, restaurants, real estate developers, funded
startups, etc.) whose website doesn't match their real-world professional quality.
```

#### 4.2.2 OVERHAUL Gate 1 (FIT) — Stop Qualifying Competitors

**CURRENT (BROKEN):**
```
GATE 1 — FIT:
  Must be: independent design agency, branding studio, architecture firm,
  commercial photographer, boutique creative service, or web/product studio.
  REJECT: SaaS, enterprise, government, student resumes, e-commerce stores,
  large agencies (50+ employees), marketplaces, blogs, personal portfolios
  with no client work.
```

**This ACCEPTS design agencies and branding studios as leads. They are our COMPETITORS.**

**REPLACE WITH:**
```
GATE 1 — FIT:
  Must be a REAL BUSINESS that sells products or services to end customers
  and would benefit from a professional website. Acceptable business types include
  (but are not limited to):
    - Architecture firms, interior design studios, real estate developers
    - Medical/dental/aesthetic clinics, wellness centers, fitness studios
    - Law firms, CA firms, financial advisory, wealth management
    - Restaurants, cafes, hotels, resorts, event venues
    - Photography studios (commercial, not hobby), film production houses
    - Funded startups (seed to Series A)
    - Education institutions, coaching centers, training academies
    - Boutique retail brands (jewelry, fashion, skincare, food)
    - Professional services (consulting, HR, recruitment, event planning)
    - NGOs, foundations, social enterprises
    - Local service businesses (salons, bakeries, pet services, etc.)
  
  SPECIAL CASE — Design/Branding Studios:
    If the discovered entity is a branding studio, graphic design studio, or
    visual design agency (2-15 people, no large agencies), classify them as
    fit_level: "medium" with pitch_angle: "white_label_partnership" — they are
    potential PARTNERS for Kachmo's engineering services, NOT direct website
    clients. Never pitch them as if they need their website fixed.
  
  REJECT:
    - Web development agencies, digital marketing agencies, SEO firms (COMPETITORS)
    - UI/UX design agencies with their own dev teams (COMPETITORS)
    - Large agencies with 50+ employees
    - SaaS platforms, enterprise software companies
    - Government departments
    - Student resumes, personal hobby blogs, portfolio-only sites with no business
    - Directory/listing/aggregator sites (JustDial, Practo, etc.)
    - E-commerce marketplaces (Amazon sellers, Flipkart sellers)
```

#### 4.2.3 OVERHAUL Gate 3 (NEED) — Retire SEO Nitpicks

**CURRENT (BROKEN):**
```
GATE 3 — NEED (mandatory technical evidence):
  Must have at least ONE verifiable flaw present in the screenshot or DOM
  metrics provided. Acceptable issue types:
    mobile_layout  — Horizontal overflow, broken navigation, oversized text
    performance    — Render-blocking scripts, unoptimized images, LCP delay
    positioning    — Weak hero, no clear CTA, no case study page
    technical      — Missing meta description, missing H1, broken images
```

**The problem:** "Missing meta description" and "Missing H1" are classic cheap-SEO-spammer lines. A luxury architect doesn't care about their H1. They care about whether their website makes their ₹5Cr residential project look as good as it actually is.

**REPLACE WITH:**
```
GATE 3 — NEED (observable mismatch between business quality and web presence):
  Must have at least ONE verifiable issue present in the screenshot or DOM metrics
  that indicates the website is UNDERSERVING the business. Focus on problems that
  a business owner or decision-maker would care about:
  
  HIGH-IMPACT (priority scoring bonus):
    visual_mismatch  — Business does high-end work but website looks dated, generic,
                       or template-built (WordPress theme, Wix template, generic Bootstrap)
    mobile_broken    — Horizontal overflow, broken navigation on mobile, unreadable text,
                       overlapping elements, touch targets too small
    slow_loading     — Site takes 5+ seconds to first contentful paint, unoptimized
                       hero images, render-blocking scripts delaying main content
    conversion_gap   — No clear CTA, no inquiry form, no phone/email visible, buried
                       contact page, no way for a potential customer to take action
  
  MODERATE-IMPACT:
    outdated_tech    — Running on visibly dated CMS (old WordPress themes, Flash remnants,
                       table-based layouts, non-responsive design)
    broken_elements  — Broken images, missing fonts rendering in fallback, dead links,
                       failed video embeds, broken sliders/carousels
    content_gap      — No portfolio/project showcase despite doing visual work,
                       "coming soon" sections, Lorem ipsum placeholder text
  
  DO NOT USE AS PRIMARY QUALIFICATION SIGNALS (these are SEO-spam indicators):
    - Missing H1 tag alone
    - Missing meta description alone
    - Missing alt text on images alone
    - Missing Open Graph tags alone
  These may be mentioned as SECONDARY observations in the evidence field but
  NEVER as the primary reason a lead is qualified.
```

#### 4.2.4 ADD New Pitch Angle: `white_label_partnership`

**Add to the pitch_angle enum in prompts and constants:**
```typescript
// In src/constants.ts, update PITCH_ANGLES:
export const PITCH_ANGLES: readonly PitchAngle[] = [
  'mobile_portfolio_experience',
  'performance_and_speed',
  'modern_cms_migration',
  'conversion_and_clarity',
  'visual_upgrade',        // NEW: for businesses with dated visual presence
  'white_label_partnership' // NEW: for design studios pitched as partners
] as const;
```

#### 4.2.5 OVERHAUL Draft Email Generation

**CURRENT (BROKEN) — the calibration example drafts emails like:**
```
"I specialize in custom responsive builds for creative agencies."
```

**This violates every Kachmo brand rule:**
1. Uses "I" (singular, not plural studio voice)
2. Says "creative agencies" (pitching competitors)
3. Offers "CSS fix" (positions as a cheap coder)
4. Mentions "H1 heading" or "meta description" (SEO spam)

**Replace the calibration example and email generation instructions with Kachmo-aligned templates:**

**Template A — Direct Client (Business with bad website):**
```
Subject: note on {{company_name}}'s mobile experience

Hi {{first_name}},

We came across {{company_name}} while researching {{industry}} in {{city}} — 
{{specific_compliment_about_their_actual_work}}.

While browsing your website on mobile, we noticed {{specific_visual_or_technical_issue}}. 
For a practice of your caliber, the web presence could better reflect the quality 
of the work you actually deliver.

We're Kachmo (https://www.kachmo.in/) — an independent creative and technology 
studio that builds bespoke, high-performance websites for {{industry}} practices. 
Happy to share a quick walkthrough of how your site could look and perform if useful?

Best,
Dev & Aadi
Kachmo Studios | studios@kachmo.in | https://www.kachmo.in/
```

**Template B — White-Label Partnership (Design studio):**
```
Subject: engineering partnership idea for {{studio_name}}

Hi {{first_name}},

We've been following {{studio_name}}'s branding work — 
{{specific_compliment_about_recent_project}}.

We run Kachmo (https://www.kachmo.in/), an independent creative-technology 
studio. We don't do branding — we engineer the interactive digital experiences 
that branding teams design. When your clients need high-performance custom 
websites built from Figma designs, we'd love to be your engineering co-pilot.

Would you be open to a quick chat about how a partnership could work?

Best,
Dev & Aadi
Kachmo Studios | studios@kachmo.in | https://www.kachmo.in/
```

**Template C — Funded Startup:**
```
Subject: note on {{company_name}}'s web presence

Hi {{first_name}},

Congratulations on {{company_name}}'s recent {{funding_round_or_milestone}}. 
We noticed your current website {{specific_observation_about_generic_template_or_issue}}.

At your stage, a distinctive, fast-loading web presence signals seriousness to 
customers, investors, and talent. We're Kachmo (https://www.kachmo.in/) — we 
build bespoke websites and interactive experiences for ambitious startups, with 
rapid 3-4 week turnaround.

Happy to share some ideas if useful?

Best,
Dev & Aadi
Kachmo Studios | studios@kachmo.in | https://www.kachmo.in/
```

### 4.3 File: `src/constants.ts`

**Updates required:**
1. Add `'visual_upgrade'` and `'white_label_partnership'` to `PITCH_ANGLES`
2. Add `'visual_mismatch'`, `'mobile_broken'`, `'slow_loading'`, `'conversion_gap'`, `'outdated_tech'`, `'broken_elements'`, `'content_gap'` to `ISSUE_TYPES`
3. Consider adding a `'partnership'` option to `LEAD_STATUSES`

### 4.4 File: `src/types.ts`

Update the `PitchAngle`, `IssueType` type definitions to match the new constants.

### 4.5 File: `src/evaluate/schema.ts`

Update the Zod schema and the Gemini response schema to accept the new pitch angles and issue types.

### 4.6 File: `src/discover/query-builder.ts` — Grounding Prompt

**CURRENT (BROKEN):**
```typescript
`Find ${maxResults} independent creative studios, branding agencies, or design studios matching: "${query}".`
```

**This literally asks Gemini to find design studios.**

**REPLACE WITH:**
```typescript
`Find ${maxResults} real businesses matching: "${query}".

Return a valid JSON array of objects with: name, domain, website_url, description.

Each result MUST be:
- A real operating business (not a directory, listing site, or portfolio platform)
- A business that sells products or services to end customers
- A business with its own website (custom domain, not just a social media page)

Exclude:
- Web development agencies, digital marketing agencies, SEO firms
- Directories, marketplaces and listing sites (JustDial, Practo, Sulekha, IndiaMart, etc.)
- Social media platforms (LinkedIn, Instagram, Facebook, Twitter/X)
- Large enterprises or chains with 500+ employees
- Government websites
- Sites hosted on free builder subdomains (*.canva.site, *.webflow.io, *.framer.website, *.wixsite.com, *.github.io, *.vercel.app, *.netlify.app)
- Job boards, blogs, listicles, news articles and "top 10" roundups

Return ONLY the JSON array — no prose, no markdown, no explanation.`
```

### 4.7 File: `src/evaluate/prompts.ts` — Developer Prompt

In `buildDeveloperPrompt()`, the DOM evidence currently over-emphasizes H1 count and meta description presence. While these data points can be collected, the prompt instructions (Section 4.2.3 above) ensure the AI doesn't use them as primary qualification signals.

### 4.8 Files: `src/sheets/writer.ts` and related

Update column mappings if you add new pitch angles or issue types, ensuring the Google Sheets output correctly reflects the new taxonomy.

---

## 5. PRICING GUIDANCE FOR THE AI

The lead engine should understand Kachmo's pricing to properly score commercial viability:

| Tier | Scope | India Price | International Price |
| :--- | :--- | :--- | :--- |
| **Entry (Local/Small)** | Simple 1-3 page website, basic responsive, contact form | ₹10,000 – ₹30,000 | $200 – $500 |
| **Tier 1: Bespoke Showcase** | 3-5 page high-craft portfolio/business site | ₹60,000 – ₹90,000 | $1,200 – $1,800 |
| **Tier 2: Flagship Presence** | Complete brand experience, CMS, custom interactions | ₹1,50,000 – ₹2,50,000 | $2,500 – $4,000 |
| **Tier 3: Complex Interactive** | WebGL/3D, headless architecture, custom portals | ₹3,00,000 – ₹5,00,000+ | $5,000 – $8,500+ |

**At this stage, even Entry-tier clients are acceptable.** The priority is getting ANY real paid work shipped.

---

## 6. QUALITY GATES FOR OUTPUT VALIDATION

After making all changes, run the pipeline and verify the output against these criteria:

### 6.1 Zero-Tolerance Checks (MUST pass)
- [ ] **Zero competitors in output:** No web agencies, design studios (except as partners), SEO firms, digital marketing agencies
- [ ] **Zero SEO spam pitches:** No email mentioning "H1 heading", "meta description", "Open Graph", "alt text" as the primary pitch
- [ ] **Zero singular voice:** No email using "I" or "my" — all must be "we" / "our studio"
- [ ] **Zero "[Your Name]":** All emails signed "Dev & Aadi / Kachmo Studios"
- [ ] **Zero fabricated claims:** No mention of past clients, portfolio pieces, or case studies that don't exist

### 6.2 Quality Checks (SHOULD pass)
- [ ] At least 70% of leads are real businesses (not other agencies/studios)
- [ ] At least 50% of leads have a clear visual/performance mismatch (high-quality business, low-quality website)
- [ ] Emails reference the specific prospect's actual work or industry, not generic template language
- [ ] Design studio leads (if any) are classified as partnership opportunities, not clients
- [ ] Priority scores reflect commercial opportunity (a ₹10Cr architecture firm with a bad website > a local bakery)

---

## 7. EXECUTION CHECKLIST

```
[ ] 1. Read this entire document
[ ] 2. Read the existing codebase structure at Clients/reachout/
[ ] 3. Update src/constants.ts (new pitch angles, new issue types)
[ ] 4. Update src/types.ts (type definitions matching new constants)
[ ] 5. Update src/discover/query-builder.ts (new DEFAULT_QUERIES + grounding prompt)
[ ] 6. Update src/evaluate/prompts.ts (system prompt, gates, calibration examples, email templates)
[ ] 7. Update src/evaluate/schema.ts (Zod schema + Gemini response schema for new enums)
[ ] 8. Update any sheet writer/column mappings if needed
[ ] 9. Run existing tests: npx vitest run
[ ] 10. Fix any broken tests due to updated constants/types
[ ] 11. Do a test run: npm run dev -- --check (preflight only)
[ ] 12. If preflight passes, do a live run: npm run dev -- --no-sheets (local output)
[ ] 13. Review output against Section 6 quality gates
[ ] 14. Iterate until output meets all zero-tolerance checks
```

---

## 8. REFERENCE FILES

| File | Purpose | What Needs Changing |
| :--- | :--- | :--- |
| `src/constants.ts` | System constants, enums | Add new pitch angles, issue types |
| `src/types.ts` | TypeScript type definitions | Update PitchAngle, IssueType types |
| `src/discover/query-builder.ts` | Search query generation | Replace DEFAULT_QUERIES, update grounding prompt |
| `src/evaluate/prompts.ts` | AI evaluation prompts | Overhaul system prompt, gates, calibration examples |
| `src/evaluate/schema.ts` | Zod validation + API schema | Update enums to match new constants |
| `src/evaluate/index.ts` | Evaluation orchestration | May need minor updates for new pitch angles |
| `src/sheets/writer.ts` | Google Sheets output | Update column mappings if schema changes |
| `docs/KACHMO_ALIGNMENT.md` | Strategic alignment doc | Reference document (do not modify) |
| `context/01-kachmo-overview.md` | Studio identity | Reference document (do not modify) |
| `context/02-brand-and-positioning.md` | Brand rules | Reference document (do not modify) |
| `context/05-client-and-sales-strategy.md` | Sales strategy | Reference document (do not modify) |

---

## 9. SUCCESS CRITERIA

The lead engine overhaul is complete when:

1. **A live run produces 15-30 leads** where at least 70% are real businesses (not agencies/studios)
2. **Zero leads are fellow web/design competitors** pitched as if they need their website "fixed"
3. **All outreach emails use Kachmo's plural studio voice** and reference the specific prospect's business
4. **No email reads like SEO spam** (no H1/meta/alt text nitpicking as the primary hook)
5. **Design studios (if discovered) are classified as partnership opportunities** with the white-label pitch angle
6. **All existing tests pass** after the changes
7. **The pipeline runs end-to-end** without errors

**The ultimate measure of success:** If Dev and Aadi read any email from the output and would feel proud sending it from `studios@kachmo.in`, the engine is working.
