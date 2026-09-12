# Outreach Strategy, Templates & Adaptive Learning Loop

> **Status:** Canonical & Active  
> **Owner:** Solo Operator / Principal Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## 1. Outreach Philosophy & Copywriting Commandments

Outreach must never read like automated marketing spam or a junior freelance coder hunting for bug fixes. It must read like an independent creative + technology studio (**Kachmo Studios**) sending a concise, polite, and technically specific observation to a fellow professional.

> See [docs/KACHMO_ALIGNMENT.md](KACHMO_ALIGNMENT.md) for the complete positioning strategy and test batch critique.

```
┌────────────────────────────────────────────────────────────────────────┐
│                   THE 7 COPYWRITING COMMANDMENTS                       │
│                                                                        │
│ 1. Under 120 Words: Keep it scannable on mobile viewports.             │
│ 2. Specific Evidence First: Cite a real project name and exact flaw.   │
│ 3. Plural Studio Voice: Write as "we" / "the studio" (never "I").      │
│ 4. Zero SEO Fluff: Never pitch missing H1s or missing meta tags.       │
│ 5. Low-Friction CTA: Offer a 90-second video walkthrough, not a call.  │
│ 6. Lowercase Subject Lines: Conversational and non-salesy.             │
│ 7. Official Signature: Kachmo Studios | studios@kachmo.in | kachmo.in   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Production Outreach Template Library

### Template A: Mobile Portfolio Layout (Primary Angle — Luxury / Architecture)
```markdown
Subject: quick note on {{name}} mobile layout

Hi {{first_name}},

We were admiring your recent work at {{name}}—specifically the {{recent_project_name}} project. The spatial hierarchy and material detailing are exceptional.

While reviewing your portfolio on a mobile viewport, we noticed the project grid overflows horizontally at 390px, causing the {{element_name}} to clip against the screen edge.

We run Kachmo (https://www.kachmo.in/)—a creative and technology studio specializing in bespoke, high-performance web experiences for architecture and design practices. Happy to share a quick 90-second video walkthrough showing the exact CSS fix if helpful?

Best,
Dev & Aadi
Kachmo Studios | studios@kachmo.in | https://www.kachmo.in/
```

### Template B: Performance & Asset Delivery (Heavy Imagery / Film / Photo)
```markdown
Subject: {{name}} portfolio mobile load speed

Hi {{first_name}},

Came across {{name}} while reviewing top {{business_type}} practices in {{city}}. Your visual work is stunning.

While browsing your site on mobile data, we noticed the homepage takes ~6 seconds to render due to uncompressed full-res media assets, creating an extended loading screen before the work appears.

We engineer ultra-fast, high-craft portfolio sites that load instantly without sacrificing visual sharpness. Would you be open to a quick breakdown of how to make the mobile experience seamless?

Best,
Dev & Aadi
Kachmo Studios | studios@kachmo.in | https://www.kachmo.in/
```

### Template C: Modern Stack & Visual Freedom Migration
```markdown
Subject: question re: {{name}} web stack

Hi {{first_name}},

Love the recent work you published for {{client_name}}.

We noticed your current site is running on a legacy {{tech_stack}} setup, which can make updating project case studies and mobile animations cumbersome.

We build modern bespoke Next.js and Webflow experiences that give creative practices complete visual freedom, fluid motion, and effortless content updates. Would it be worth sending over a few examples of recent studio rebuilds?

Best,
Dev & Aadi
Kachmo Studios | studios@kachmo.in | https://www.kachmo.in/
```

### Template D: Conversion & Clarity (Bespoke Showcase Upgrade)
```markdown
Subject: quick note on {{name}} mobile hero showcase

Hi {{first_name}},

We were exploring your portfolio at {{name}}—your client roster and case studies are impressive.

While reviewing the mobile homepage at 390px, we noticed the initial viewport displays a static container without an immediate value statement or direct route to your featured projects, requiring visitors to scroll blind before seeing your best work.

We design and engineer bespoke digital experiences that position creative practices at the top of their market. Happy to share a concise 90-second video walkthrough with a few layout ideas if useful?

Best,
Dev & Aadi
Kachmo Studios | studios@kachmo.in | https://www.kachmo.in/
```

### Template E: Creative Agency Engineering Co-Pilot (White-Label Partnership)
```markdown
Subject: frontend engineering co-pilot for {{name}}

Hi {{first_name}},

We've been following {{name}}'s branding and packaging work—the typography and identity systems you craft are world-class.

We run Kachmo (https://www.kachmo.in/), an independent creative engineering studio. We partner with top branding studios to build the bespoke, high-performance interactive websites their teams design in Figma—handling complex animations, smooth interactions, and custom Next.js builds.

When your branding clients need websites that match the caliber of your visual identities, we'd love to be your engineering co-pilot. Open to a brief intro exchange?

Best,
Dev & Aadi
Kachmo Studios | studios@kachmo.in | https://www.kachmo.in/
```

---

## 3. Demo Generation Policy & Gmail Protocol

- **The Demo Verdict:** Do **NOT** generate custom website mockups for cold leads. Demos (2-minute Loom videos or live staging builds) are produced **only after a prospect responds with positive interest**.
- **Dispatch Schedule:** Send between **08:30 AM and 10:30 AM** in recipient's local timezone from native Gmail.
- **Follow-up Policy:** If no reply after 4 business days, send **one single 2-sentence follow-up**. Never run automated 5-step follow-up sequences.

---

## 4. The Adaptive Learning Loop

Every outreach response becomes empirical training data to calibrate upstream discovery queries and scoring weights without complex machine learning:

```
[ OUTCOMES Tab Historical Tracking ]
├── 1. Query Reply Rate Analysis:
│   • Query Reply Rate >= 4.0% ──► Expand query in SOURCES with geographic variations.
│   • Query Reply Rate < 1.0%  ──► Disable query in SOURCES immediately.
│
└── 2. Defect Type Win Rate Analysis:
    • Mobile Layout Overlap: 6.7% Reply Rate ──► Retain 3 Priority Points.
    • PageSpeed Scores:      1.2% Reply Rate ──► Downgrade to 1 Priority Point.
```
