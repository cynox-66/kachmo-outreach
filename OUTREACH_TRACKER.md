# Kachmo Studios — Client Acquisition Tracker & Conversion Ledger

**Operational Rule**: 40 clients mailed per day. Sourcing & research triggers automatically whenever the uncontacted queue drops below 40.

---

## 1. Operating Protocols & Rules of Engagement

### The 40-a-Day Cadence
- **Target Volume**: 40 fresh emails sent daily via Titan Mail (`studios@kachmo.in`).
- **Batching**: Can be dispatched in 2 batches of 20 (Morning UK/EU window ~1:30 PM IST, Afternoon US East window ~6:30 PM IST).
- **Replenishment Threshold**: If active queue < 40 uncontacted leads with verified emails, execute Lead Engine / targeted research to add the next batch of 50–100 targets before the next morning.

### Status State Machine
Every lead in the ledger exists in exactly one state:
1. `DRAFTED`: Created in Titan Mail Drafts.
2. `SCHEDULED`: Staged in `scheduled-queue.json` for autonomous cloud dispatch via GitHub Actions.
3. `SENT`: Dispatched directly via Titan SMTP by the GitHub Actions cloud runner or CLI sender.
4. `FOLLOW_UP_DUE`: Exactly 72 hours have elapsed since `SENT` with zero response.
5. `FOLLOWED_UP`: Bump email sent.
6. `REPLIED_WARM`: Recipient responded with interest, questions, or asking for rates.
7. `REPLIED_NOT_NOW`: Positive/neutral response noting no immediate need; logged for 60-day check-in.
8. `REPLIED_NO`: Explicit "not interested" or unsubscribe; immediately removed.
9. `CALL_BOOKED`: 15-minute intro/scoping call scheduled on calendar.
10. `PROPOSAL_SENT`: Scoped sprint agreement or launch partner proposal sent.
11. `WON`: Contract signed + 50% deposit received ($3,000–$6,000+ / ₹2.5L–₹5L+).

---

## 2. Communication & Response Protocols

### The 72-Hour Bump Protocol
If no reply arrives after 3 business days, send a single, casual 1-line reply bump directly on the original thread:
- **Rule**: Never sound needy, robotic, or pushy. Under 35 words. Zero guilt-tripping.
- **Agency Bump (Arch-1)**:
  > *"Hey [Name], just bumping this in case dev overflow isn't on your radar this week. Either way, love the latest work on [Project]!"*
- **Startup Bump (Arch-2)**:
  > *"Hey [Name], quick bump on this. Happy to record a 60-second screen share showing that hero interaction idea if you're curious?"*
- **Brand / Craft Bump (Arch-3 & 4)**:
  > *"Hey [Name], just checking in quickly. Hope the team is having a great week!"*

### First Response Protocol (SLA: < 2 Hours during business hours)
When a reply lands in Titan Mail:
1. **Never send a generic corporate brochure or automated Calendly link without context.**
2. **The "Casual Peer" tone**:
   > *"Thanks for getting back to me, [Name]! Really glad this resonated. We're currently wrapping up a sprint and have bandwidth opening up next week.*
   > 
   > *Would love to do a casual 15-minute sync to hear what's on your plate, or I can share a private Loom walkthrough showing how our motion handoff works.*
   > 
   > *Let me know what works best for you!"*

### Objection Handling Cheatsheet
- **"We already have in-house developers / a team"**:
  > *"Completely get that! Most of the studios we support have great internal teams; they just tap us invisibly when 2–3 client launches collide at once or when a project needs heavy GSAP/Three.js work that would tie up their core team.*
  > 
  > *Always happy to stay on your radar as a backup for peak seasons."*
- **"Where are you based? / Timezone concerns"**:
  > *"We're based in Pune, India, and our workflow is designed for US/UK/EU overlap. We run daily async updates and overlap 4–5 hours with London/New York for live coordination."*
- **"What are your rates?"**:
  > *"We work on fixed, transparent sprint pricing so there are never runaway hourly bills. Typical motion landing page sprints range between $3k–$6k (₹2.5L–₹5L) with a strict 1–2 week turnaround."*

---

## 3. Daily Conversion Ledger

### Batch 1: Sent on 2026-09-11 (First 5 White-Label Agency Directors)

| # | Target Name | Recipient Contact | Archetype | Sent Date | Follow-up Due | Current Status | Thread Notes & Conversion Outcome |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **001** | **Deuce Studio** | `info@deucestudio.com` | Arch-1 (White-Label Agency) | 2026-09-11 | 2026-09-14 | **SENT** | Initial outreach dispatched. Hook: White Rabbit & Phizz packaging translation into digital motion. |
| **003** | **Fellow Partners** | `info@fellow.partners` | Arch-1 (White-Label Agency) | 2026-09-11 | 2026-09-14 | **SENT** | Initial outreach dispatched. Hook: Cross-border brand campaign digital build overflow. |
| **006** | **SUM Design** | `info@sumdesign.co.uk` | Arch-1 (White-Label Agency) | 2026-09-11 | 2026-09-14 | **SENT** | Initial outreach dispatched. Hook: Founder-led branding heavy production engineering. |
| **007** | **Order Design** | `brooklyn@order.design` | Arch-1 (White-Label Agency) | 2026-09-11 | 2026-09-14 | **SENT** | Initial outreach dispatched. Hook: Jesse's identity systems for Herman Miller & standards manual. |
| **008** | **Saint Urbain** | `info@sainturbain.com` | Arch-1 (White-Label Agency) | 2026-09-11 | 2026-09-14 | **SENT** | Initial outreach dispatched. Hook: Alex's beauty/hospitality brand work needing interactive digital. |

---

### Batch 2: Sent on 2026-09-12 (Morning Dispatches)

| # | Target Name | Recipient Contact | Archetype | Sent Date | Follow-up Due | Current Status | Thread Notes & Conversion Outcome |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **010** | **Splash Creative** | `hello@splashcreative.com` | Arch-1 (White-Label Agency) | 2026-09-12 | 2026-09-15 | **SENT** | Dispatched. Hook: High-interaction features and launches beyond senior-led studio scope. |
| **011** | **Moniker** | `hello@monikerSF.com` | Arch-1 (White-Label Agency) | 2026-09-12 | 2026-09-15 | **SENT** | Dispatched. Hook: Translating refined identity and motion systems into production Next.js/GSAP code under NDA. |
| **014** | **Elixir Design** | `info@elixirdesign.com` | Arch-1 (White-Label Agency) | 2026-09-12 | 2026-09-15 | **SENT** | Dispatched. Hook: Purpose-driven identity practice digital build overflow partner. |
| **015** | **Wunder** | `hello@wunder.nl` | Arch-1 (White-Label Agency) | 2026-09-12 | 2026-09-15 | **SENT** | Dispatched. Hook: Strategy-led Amsterdam branding bureau production engineering layer. |
| **031** | **End Close** | `founders@endclose.com` | Arch-2 (Funded Startup) | 2026-09-12 | 2026-09-15 | **SENT** | Dispatched. Hook: YC W26 payment automation first fold clarity and conversion pass. |

---

### Batch 3: Drafted in Titan Mail on 2026-09-12 (20 Targets Ready in Drafts)

| # | Company Name | Email Address | Archetype | Current Status | Primary Solution Angle |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **016** | **Wonderland** | `hello@wonderland.studio` | Arch-1 | **DRAFTED** | Motion & 3D WebGL overflow |
| **017** | **Helder** | `studio@helder.design` | Arch-1 | **DRAFTED** | Bespoke typography in React |
| **018** | **A New Day Studio** | `hello@anewday.studio` | Arch-1 | **DRAFTED** | White-label campaign engineering |
| **020** | **studio sesenta** | `hi@studiosesenta.com` | Arch-1 | **DRAFTED** | European brand dev partnership |
| **021** | **Granyon** | `hello@granyon.com` | Arch-1 | **DRAFTED** | Copenhagen values-led production dev |
| **022** | **Side Perspectives** | `hello@sideperspectives.com` | Arch-1 | **DRAFTED** | Discrete brand dev overflow |
| **030** | **Thonik** | `info@thonik.nl` | Arch-1 | **DRAFTED** | Dutch experimental motion |
| **033** | **Moss** | `founders@moss.dev` | Arch-2 | **DRAFTED** | Dev tools hero interactive revamp |
| **035** | **Poth Labs** | `matthew@pothlabs.com` | Arch-2 | **DRAFTED** | Founder pitch hero conversion |
| **042** | **Dome** | `support@domeapi.com` | Arch-2 | **DISQUALIFIED** | ❌ Gate 2 violation: `support@` inbox. Remove from Titan Drafts. |
| **049** | **Semble** | `info@sembleai.com` | Arch-2 | **DRAFTED** | AI product interactive narrative |
| **052** | **The Context Company** | `founders@thecontextcompany.com` | Arch-2 | **DRAFTED** | Enterprise clarity sprint |
| **061** | **Holloway Li** | `studio@hollowayli.com` | Arch-3 | **DRAFTED** | Architectural spatial digital folio |
| **069** | **Jono Pandolfi Designs** | `care@jonopandolfi.com` | Arch-3 | **DISQUALIFIED** | ❌ Gate 2 violation: `care@` inbox. Remove from Titan Drafts. |
| **073** | **Cosmedocs Aesthetic** | `info@cosmedocs.com` | Arch-4 | **DRAFTED** | High-ticket consultation booking UX |
| **074** | **Luxury Aesthetics** | `info@luxuryaestheticclinic.com` | Arch-4 | **DRAFTED** | Clinic appointment conversion lift |
| **078** | **Acacia Gardens** | `info@acacia-gardens.co.uk` | Arch-4 | **DRAFTED** | High-ticket landscape quote UX |
| **079** | **Perry Guillot Inc.** | `p@guillotinc.com` | Arch-4 | **DRAFTED** | Hamptons estate landscape portfolio |
| **080** | **Laurel Group** | `info@thelaurelgroup.net` | Arch-4 | **DRAFTED** | Design/build consult path polish |
| **083** | **Insight Legal** | `info@insightlegal.co.in` | Arch-4 | **DRAFTED** | Dispute practice digital trust overhaul |


---

### Batch 4: Generated & Scheduled via /mail-start on 2026-09-12 (10 Targets in Titan Drafts)

| # | Target Name | Recipient Contact | Archetype | Sent Date | Follow-up Due | Current Status | Thread Notes & Conversion Outcome |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **002** | **Slice Design** | `hello@slicedesign.co.uk` | Arch-1 (White-Label Agency) | 2026-09-14 | 2026-09-17 | **SENT** | Biotiful packaging & clean typographic identity. Subject: Style A. Scheduled for Mon ~9:00 AM (Europe/London). |
| **005** | **LMPP Studio** | `info@lmpp.studio` | Arch-1 (White-Label Agency) | 2026-09-14 | 2026-09-17 | **SENT** | Luxury editorial work & identity restraint. Subject: Style B. Scheduled for Mon ~9:00 AM (Europe/London). |
| **009** | **Other Means** | `us@othermeans.us` | Arch-1 (White-Label Agency) | 2026-09-14 | 2026-09-17 | **SENT** | Cultural & institutional typography benchmark. Subject: Style A. Scheduled for Mon ~9:00 AM (America/New_York). |
| **012** | **Shawn Scott Studio** | `hello@shawnscott.studio` | Arch-1 (White-Label Agency) | 2026-09-14 | 2026-09-17 | **SENT** | Packaging systems & typographic detail craft. Subject: Style B. Scheduled for Mon ~9:00 AM (America/Los_Angeles). |
| **019** | **Violet Office** | `info@violetoffice.com` | Arch-1 (White-Label Agency) | 2026-09-14 | 2026-09-17 | **SENT** | Intersection between physical spaces and brand. Subject: Style A. Scheduled for Mon ~9:00 AM (Europe/Berlin). |
| **023** | **We Are Colette** | `business@wearecolette.com` | Arch-1 (White-Label Agency) | 2026-09-14 | 2026-09-17 | **SENT** | Art direction & visual narrative storytelling. Subject: Style B. Scheduled for Mon ~9:00 AM (America/Toronto). |
| **024** | **Lolo Agency** | `info@loloagency.com` | Arch-1 (White-Label Agency) | 2026-09-14 | 2026-09-17 | **SENT** | Distinct warmth & character in identity work. Subject: Style A. Scheduled for Mon ~9:00 AM (America/Toronto). |
| **034** | **Marker** | `founders@onmarker.com` | Arch-2 (Funded Startup) | 2026-09-14 | 2026-09-17 | **SENT** | Workflow product first fold value proposition. Subject: Style B. Scheduled for Mon ~9:00 AM (America/Los_Angeles). |
| **037** | **Corsair** | `dev@corsair.dev` | Arch-2 (Funded Startup) | 2026-09-14 | 2026-09-17 | **SENT** | Translating engineering depth into first-screen story. Subject: Style A. Scheduled for Mon ~9:00 AM (America/New_York). |
| **051** | **Specific** | `hello@specific.dev` | Arch-2 (Funded Startup) | 2026-09-14 | 2026-09-17 | **SENT** | Replacing generic dark-mode template with motion hero. Subject: Style B. Scheduled for Mon ~9:00 AM (America/Los_Angeles). |

---

### Batch 5: Generated & Scheduled via /mail-start on 2026-09-14 (10 Targets in Titan Drafts)

| # | Target Name | Recipient Contact | Archetype | Sent Date | Follow-up Due | Current Status | Thread Notes & Conversion Outcome |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **101** | **Spin** | `studio@spin.co.uk` | Arch-1 (White-Label Agency) | 2026-09-15 | 2026-09-18 | **SCHEDULED** | Unit Editions & AIR Studios typography craft. Subject: dev overflow for Spin?. Scheduled for Tue ~9:00 AM (Europe/London). |
| **102** | **OMSE** | `hello@omse.co` | Arch-1 (White-Label Agency) | 2026-09-15 | 2026-09-18 | **SCHEDULED** | Kinetic typography for Printworks London. Subject: kinetic web builds for OMSE?. Scheduled for Tue ~9:00 AM (Europe/London). |
| **103** | **A Practice for Everyday Life** | `n@apracticeforeverydaylife.com` | Arch-1 (White-Label Agency) | 2026-09-15 | 2026-09-18 | **SCHEDULED** | Tate & Bauhaus Dessau institutional typography. Subject: interactive digital builds for APFEL?. Scheduled for Tue ~9:00 AM (Europe/London). |
| **104** | **Accept & Proceed** | `partnership@acceptandproceed.com` | Arch-1 (White-Label Agency) | 2026-09-15 | 2026-09-18 | **SCHEDULED** | Nike & NASA brand installations. Subject: creative dev for Accept & Proceed?. Scheduled for Tue ~9:00 AM (Europe/London). |
| **105** | **NIMU Agency** | `nieke@nimuagency.com` | Arch-1 (White-Label Agency) | 2026-09-15 | 2026-09-18 | **SCHEDULED** | Editorial art direction & tactile luxury craft. Subject: dev overflow for NIMU Agency?. Scheduled for Tue ~9:00 AM (Europe/Amsterdam). |
| **106** | **Cuckoo** | `yonghee@cuckoo.so` | Arch-2 (Funded Startup) | 2026-09-14 | 2026-09-17 | **SENT** | Real-time audio translation first fold demo. Subject: Cuckoo first fold. Scheduled for Tue ~9:00 AM (America/Los_Angeles). |
| **107** | **Roe AI** | `richard@roe-ai.com` | Arch-2 (Funded Startup) | 2026-09-14 | 2026-09-17 | **SENT** | Multimodal SQL query interactive first screen. Subject: Roe AI first fold. Scheduled for Tue ~9:00 AM (America/Los_Angeles). |
| **108** | **Greptile** | `daksh@greptile.com` | Arch-2 (Funded Startup) | 2026-09-14 | 2026-09-17 | **SENT** | Codebase RAG architecture hero visual narrative. Subject: Greptile first fold narrative. Scheduled for Tue ~9:00 AM (America/Los_Angeles). |
| **109** | **Cerebrium** | `michael@cerebrium.ai` | Arch-2 (Funded Startup) | 2026-09-14 | 2026-09-17 | **SENT** | Sub-second ML cold starts benchmark visual. Subject: Cerebrium first fold speed. Scheduled for Tue ~9:00 AM (America/Los_Angeles). |
| **110** | **Martin** | `dawson@trymartin.com` | Arch-2 (Funded Startup) | 2026-09-14 | 2026-09-17 | **SENT** | Autonomous voice agency interactive soundwave hero. Subject: Martin first screen interaction. Scheduled for Tue ~9:00 AM (America/Los_Angeles). |

---

### Batch 6: Indian Direct Calling & WhatsApp Pipeline (Assigned to Aadi on 2026-09-14)

| # | Target Name | City | Decision Maker | Direct Phone / WhatsApp | Call Status | Notes & Conversion Outcome |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **111** | **Royal Heritage Haveli** | Jaipur | Kanwar Pradip Singh (*Owner & MD*) | `+91 99833 17271` | **PENDING** | Hook: 18 suites & courtyards, direct booking engine bypassing OTA fees. |
| **112** | **The Esthetic Clinics** | Mumbai | Dr. Rinky Kapoor (*Co-Founder & MD*) | `+91 70280 65165` | **PENDING** | Hook: Live doctor slot booking portal + before/after visual sliders. |
| **113** | **A Advani Realty** | Pune | Anil Advani (*Founder & MD*) | `+91 90201 42222` | **PENDING** | Hook: 3D floor plan explorer for Koregaon Park luxury residences. |
| **114** | **Tivoli Hospitality Group** | New Delhi | Amit Kumar Sood (*CEO*) | `+91 70650 53035` | **PENDING** | Hook: 3D wedding layout visualizer + live auspicious date checker. |
| **115** | **Sunita Shekhawat Fine Jewellery** | Jaipur | Sunita Shekhawat (*Founder & CD*) | `+91 99297 77005` | **PENDING** | Hook: 360° macro zoom Meenakari catalog + VIP private salon booking. |
| **116** | **Bombay Shirt Company** | Mumbai | Akshay Narvekar (*Founder & CEO*) | `+91 95134 46201` | **PENDING** | Hook: Ultra-fast 60fps WebGL shirt visualizer with tactile fabric drape. |
| **117** | **MuseLAB** | Mumbai | Jasem Pirani (*Co-Founder & Principal*) | `+91 93723 61016` | **PENDING** | Hook: Spatial AD100 architecture portfolio walkthrough for luxury residences. |
| **118** | **Santé Spa Cuisine** | Pune | Sonal Barmecha (*Founder & MD*) | `+91 82379 02020` | **PENDING** | Hook: Interactive macro digital menu + direct table booking portal. |
| **119** | **2IIM** | Chennai | Rajesh Balasubramanian (*Founder & CEO*) | `+91 99626 48484` | **PENDING** | Hook: Interactive CAT score-to-percentile estimator + video pedagogy trial. |
| **120** | **The Painfree Dentist** | Mumbai | Dr. Diksha Batra (*Founder & Head Dentist*) | `+91 70454 97915` | **PENDING** | Hook: Bandra celebrity cosmetic dentistry smile makeover slider + VIP booking. |

---

## 4. Pipeline Velocity Metrics (Updated Daily)

- **Total Sent to Date**: 20 (5 on 2026-09-11 + 5 on 2026-09-12 + 10 on 2026-09-14)
- **Total Drafted in Titan Mail**: 20 (Batch 3)
- **Total Scheduled in Titan Mail**: 10 (Batch 5, queued in Titan Drafts & scheduled-queue.json for Tuesday morning windows)
- **Total Targets Processed**: 50
- **Daily Target**: 40 (Warmup Phase 1: 10 emails/batch cap)
- **Total Replied**: 0
- **Positive Reply Rate**: —
- **Calls Booked**: 0
- **Proposals Active**: 0
- **Deals Won**: 0
- **Pipeline Value Closed**: ₹0 / $0

