# Project Charter, Context & Product Vision

> **Status:** Canonical & Active  
> **Owner:** Solo Operator / Principal Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## 1. Problem Statement & Mandate

### The Studio Client Acquisition Imperative
**Lead Engine** exists for one singular commercial mandate: **To serve as the automated client discovery and qualification engine for Kachmo Studios** (`https://www.kachmo.in/`), landing high-paying clients ($1,500–$5,000+ / ₹1,20,000–₹4,00,000) to build an elite creative-technology studio and achieve **complete financial independence for Dev as a second-year B.Tech student**.

Manual prospecting—searching directories, inspecting mobile responsive viewports, extracting emails, and drafting high-craft bespoke pitches—consumes 2–3 hours per day. Lead Engine automates this research and DOM layout evaluation at near-zero cost, delivering high-conviction opportunities into Google Sheets for a time-boxed 30-minute evening review and manual Gmail dispatch session.

> [!IMPORTANT]
> **Canonical Studio Alignment:**
> For the comprehensive strategy on target client archetypes, pricing tiers, query recalibration, and the post-mortem critique of the initial test batch, see [docs/KACHMO_ALIGNMENT.md](KACHMO_ALIGNMENT.md).

---

## 2. Operating Reality & Constraints

These constraints are binding and govern all engineering decisions:

| Constraint | Boundary | Rationale |
| :--- | :--- | :--- |
| **Studio Identity** | Kachmo Studios (`kachmo.in`) | Design-led, serious technical capability, plural studio voice ("we"). |
| **User Base** | Exactly 1 operator (Dev / Kachmo) | Eliminates multi-tenancy, authentication, and RBAC complexity. |
| **Operating Cost** | ~$1.38 / month ($2.50 hard cap) | Student financial constraints; revenue must precede infrastructure. |
| **Operator Time** | ≤ 30 minutes / day | Sustainable alongside university college coursework and exams. |
| **Deal Target** | $1,500–$5,000+ (₹1.2L–₹4L) | High-ticket projects (1-2/month) to achieve full financial independence. |
| **System Model** | Single script batch runner | Eliminates 24/7 server maintenance, containers, and queue daemons. |
| **Outreach Model**| 100% manual dispatch | Eliminates domain blacklisting risks; enforces high-touch human craft. |

---

## 3. Historical Context & Research Synthesis

The project architecture emerged from synthesizing two foundational technical evaluations:

```
REJECTED: Overengineered Micro-SaaS ($154/mo, 3.5 Dev Weeks)
┌──────────┐   ┌─────────┐   ┌────────────┐   ┌────────────┐   ┌──────────┐
│ Railway  │──►│ Docker  │──►│ Redis/Bull │──►│ Stagehand  │──►│ Supabase │
└──────────┘   └─────────┘   └────────────┘   └────────────┘   └──────────┘
     │                                                               │
     ▼                                                               ▼
┌──────────┐   ┌─────────┐   ┌────────────┐   ┌────────────┐   ┌──────────┐
│ Claude   │   │ Gemini  │   │ Cloudflare │   │ Hunter.io  │   │Instantly │
└──────────┘   └─────────┘   └────────────┘   └────────────┘   └──────────┘

APPROVED: Canonical Lead Engine V1 ($0/mo, 3-4 Dev Evenings)
┌────────────────┐     ┌──────────────────┐     ┌───────────────┐
│ GitHub Actions │────►│ Single TS Script │────►│ Google Sheets │
└────────────────┘     └──────────────────┘     └───────────────┘
                                │                       │
                     ┌──────────┴──────────┐            ▼
                     ▼                     ▼    ┌───────────────┐
               ┌───────────┐         ┌─────────┐│ Manual Gmail  │
               │Playwright │         │ Gemini  ││ Review & Send │
               └───────────┘         └─────────┘└───────────────┘
```

### Synthesis of Source Research Reports:
1. **Gemini Deep Research Report:** Recommended replacing complex worker infrastructure with a single TypeScript CLI executed via GitHub Actions, using **Gemini 3.5 Flash-Lite** with Google Search Grounding for discovery and single-pass multimodal evaluation.
2. **Apodex Architecture Review:** Demonstrated that anti-bot scraping (Behance/LinkedIn) triggers account bans and costs money; urged radical simplification to **Google Sheets** and deterministic-first rules.
3. **Canonical Consensus:** Build a deterministic-first batch pipeline using Playwright and Gemini 3.5 Flash-Lite, outputting directly to Google Sheets for manual review.

---

## 4. Product Vision: The Lean Discovery Engine

Lead Engine occupies the sweet spot between low-volume manual prospecting and high-volume automated spam:

```
   [ Low Volume / High Effort ]           [ High Volume / Low Quality ]
       Pure Manual Prospecting                 Automated Mass Spammers
  (2-3 hours/day, 5-10 emails/day)          (10,000 emails/month, 0.1% reply)
                 \                                     /
                  \                                   /
                   ▼                                 ▼
              ┌───────────────────────────────────────────┐
              │           LEAD ENGINE SWEET SPOT          │
              │  • 100-200 Candidate Sites Scanned/Run    │
              │  • 30-50 Verified Qualified Prospects/Run │
              │  • 30 Minutes Human Review & Customization│
              │  • 80% Outreach Precision Rate            │
              │  • ~$1.38 / Month Running Cost            │
              └───────────────────────────────────────────┘
```

### The Division of Labor:
- **What the Machine Does:** Search index querying, HTTP status verification, mobile viewport rendering, DOM layout shift extraction, contact regex parsing, and structured JSON copy drafting.
- **What the Human Operator Does:** Brand and aesthetic evaluation, relationship tone calibration, and manual email dispatch in native Gmail.

---

## 5. Scope Boundaries for Version 1

- **Included in V1:** Search grounding discovery, canonical deduplication, lightweight HTTP pre-checks, Playwright mobile viewport auditing, Gemini 3.5 multimodal evaluation, Google Sheets CRM synchronization, and manual Gmail review workflow.
- **Permanently Excluded from V1:** Multi-user SaaS features, custom React/Next.js dashboards, relational databases (PostgreSQL/Supabase), automated cold sequence engines (Instantly/Smartlead), paid enrichment APIs (Hunter/Apollo), and automated cold demo generators.
