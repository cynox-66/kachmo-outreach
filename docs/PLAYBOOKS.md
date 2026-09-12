# Operational Playbooks, Query Banks & Template Specifications

> **Status:** Canonical & Living  
> **Owner:** Solo Operator / Principal Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## 1. Institutional Knowledge & Kachmo Lead Archetypes

> See [docs/KACHMO_ALIGNMENT.md](KACHMO_ALIGNMENT.md) for the authoritative strategy and post-mortem analysis of the August 2026 test batch.

### High-Yield Prospect Archetypes for Kachmo ($1,500 – $5,000+ / ₹1.2L – ₹4L):
1. **High-Ticket Service Boutiques (Direct Clients):**
   - **Profile:** Luxury architecture practices, high-end interior design firms, commercial film/production houses, boutique advisory/law firms (3–20 people).
   - **Characteristics:** Their client projects are ₹10L–₹1Cr+ ($15k–$150k+). Zero in-house developers. Their current website is slow, template-driven, or mobile-clipped, failing to match their luxury physical craft.
   - **Budget Authority:** ₹1,50,000 – ₹3,50,000 ($2,000 – $4,500) without procurement friction.

2. **Funded Startups & Emerging Tech Ventures (Launch Builds):**
   - **Profile:** Seed to Series A funded startups, niche AI ventures, fintech, modern B2B SaaS.
   - **Characteristics:** Need a distinct Awwwards-caliber launch website to impress investors and top hires. Do not want cookie-cutter Webflow templates or 16-week, $50k agency retainers.
   - **Budget Authority:** $2,500 – $6,000 (₹2L – ₹5L) with fast decision-making.

3. **Visual Branding & Design Studios (White-Label Engineering Partner):**
   - **Profile:** Boutique visual identity, packaging, and print design studios (3–10 people).
   - **Characteristics:** World-class Figma designs, zero internal frontend engineering capability.
   - **Pitch Angle:** Technical co-pilot / interactive engineering partner ("We engineer what your team designs in Figma").
   - **Deal Value:** Repeat ₹1.5L–₹3L website commissions per rebranded client.

### Low-Yield Anti-Archetypes (Drop / Disqualify Immediately):
- **Established Agency Giants & Competitors:** 50–100+ person creative agencies (e.g. Elephant Design, The Minimalist, Monsoonfish). They have full in-house engineering and marketing teams. Pitching them on "missing H1 tags" burns credibility.
- **Fellow Freelancers & Solopreneurs:** Independent freelance graphic designers or copywriters found via portfolio queries. They do not have budgets to hire an external development studio.
- **Broke Solo Artists:** Portfolios on free subdomains (*.canva.site, *.cargo.site) with zero commercial client logos.
- **Satisfied Small Commodity Businesses:** Local gyms or bakeries content with a basic $10/mo Squarespace template.

---

## 2. Industry Vertical Playbooks

| Vertical | Avg Deal Size | Primary Decision Maker | Winning Pitch Angle |
| :--- | :--- | :--- | :--- |
| **Luxury Architecture**| ₹1,50,000 – ₹3,50,000 ($2,500–$5k) | Principal Architect / Partner | Ultra-fast full-res image delivery, spatial typography, fluid mobile galleries. |
| **High-End Interior Design** | ₹1,20,000 – ₹2,50,000 ($2,000–$4k) | Studio Principal / Creative Lead | Editorial project showrooms, before/after visual sliders, mobile portfolio layout. |
| **Film & Production Houses** | ₹1,50,000 – ₹3,00,000 ($2,500–$4.5k) | Executive Producer / Director | Instant mobile video showreels, dark mode cinematic aesthetics, zero lag. |
| **Funded Tech Startups** | $2,500 – $6,000 (₹2L–₹5L) | Founder / Head of Product | Bespoke Next.js engineering, interactive micro-interactions, distinct launch site. |
| **Visual Branding Studios** | ₹1,50,000 – ₹3,00,000 (Repeat) | Creative Director / Founder | Engineering co-pilot for their Figma designs; custom Next.js/Webflow builds. |

---

## 3. Production Sourcing Query Library

> [!NOTE]
> Queries must target **commercial businesses with money**, NOT search for `"freelance designer portfolio"` or competitor agencies.

```
SEARCH SYNTAX PATTERN:
[target_high_ticket_niche] + [tier_1_city_or_global_hub] + [commercial_modifier] -site:[blacklisted_domains]
```

| Vertical | Production Query Example | Target Client Type |
| :--- | :--- | :--- |
| **Architecture** | `"architecture firm" (Mumbai OR Bangalore OR Delhi) portfolio -site:archdaily.com -site:houzz.in` | High-ticket architecture practices |
| **Interior Design** | `"interior design studio" (Mumbai OR Bangalore OR "New York") "residential projects" -site:instagram.com` | Luxury residential interior designers |
| **Film Production** | `"production house" (Mumbai OR Delhi) "commercials" showreel -site:youtube.com -site:vimeo.com` | High-end commercial film & ad studios |
| **Boutique Law / Advisory** | `"boutique law firm" (Mumbai OR Delhi OR Singapore) "partners" "practice areas" -site:linkedin.com` | High-earning boutique legal & advisory |
| **Funded Tech Ventures** | `"backed by" ("Peak XV" OR "Surge" OR "Y Combinator" OR "Blume") portfolio site:*.com -site:ycombinator.com` | Funded seed & Series A tech startups |
| **Global Creative Partners**| `"branding studio" ("London" OR "Amsterdam" OR "Berlin") "packaging" portfolio -site:clutch.co` | International branding co-pilot targets |

---

## 4. Phase 3 Portfolio Demo Specifications

*Custom demos are produced only upon prospect reply expressing interest.*

```
CUSTOMIZATION WORKFLOW (15 Minutes):
1. Select Persona Template ➔ 2. Swap Client Colors & Logo ➔ 3. Deploy to Staging ➔ 4. Record 2-Min Loom
```

| Persona | Key Design Language | Core Sections | Build Time |
| :--- | :--- | :--- | :--- |
| **Writer / Journalist** | Editorial serif typography, reading width | Bio, essays, books, press mentions | 15 min |
| **Graphic Designer** | Swiss brutalism, dark mode visual vault | Case studies, interactive playground | 20 min |
| **Photographer** | Full-bleed masonry, instant touch lightbox | Category galleries, tear-sheets | 15 min |
| **Creative Agency** | Bold typography, video showreel, client grid | Case studies, capabilities matrix | 25 min |
| **Developer** | Monospace terminal aesthetic, live diffs | Stack matrix, projects, open source | 15 min |
| **Copywriter** | Scannable before/after conversion diffs | Hook, proof, sprint offerings | 15 min |

---

## 5. Engineering Experiments Registry

Every modification to queries, scoring weights, or copy is pre-registered as an experiment:

```markdown
### [EXP-001] Viewport Pixel Overlap Citation vs. Generic Mobile Flaw
- Target Variable: Outreach Copy (`draft_body`)
- Hypothesis: Citing exact viewport dimensions ("at 390px viewport") increases positive reply rate from 2.5% to > 5.0%.
- Sample Size: 100 Sent Emails (50 Control / 50 Test)
- Status: Active Baseline.
```
