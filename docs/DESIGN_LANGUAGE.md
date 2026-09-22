# Outbound OS — Design Language

> **Status:** Adopted 2026-09-22
> **Source of truth:** the Kachmo website as implemented (`kachmo-website/src/app/globals.css`, `layout.tsx`,
> `components/Spatial/destinations/*`, which serves kachmo.in). `archive/DESIGN_SPEC.md` is its historical spec.
> **Rule:** this is Kachmo's *language* applied to operational software, not the marketing site turned into a dashboard.

---

## 1. What the website actually is

Read from the code, not the brief:

| Element | Website implementation | Its job |
| :-- | :-- | :-- |
| Ground | `--ink-black #0B0A09` (never `#000`) | the dark state; the default field |
| Type on dark | `--paper-bone #EDE9E0` | all reading type in the dark state |
| Field | `--field-yellow #E3F32B` | the *paint state*: the whole surface flips to it in one frame; never a small accent, never type on ink |
| Vermilion | `--dragon-vermilion #E2402A` | the dragon and the **misregistration ghost** (a 1–2px down-right offset print of a heading); never a button, border or hover |
| White | `#FFFFFF` | specular only; never a fill |
| Display face | **Cinzel Black 900**, self-hosted (OFL) | the wordmark and landmark titles |
| Utility face | system monospace stack, uppercase, tracked `0.11–0.14em` | every label, mark and register |
| Plates | bone washes over ink (`4.5%` fill, `7.5%` lift), hairlines at bone `12–22%` / `46%` strong, radius `2–4px` | composed surfaces with printed marks |
| Rhythm | a seven-step spacing scale; label tight to its heading, copy, then a visual, then the action | one rhythm, not ad-hoc gaps |
| Motion | one reveal (12px + fade), `opacity`/`transform` only, disabled under reduced motion; state flips are hard cuts | arrival, never decoration |
| Discipline | "each colour has exactly one job"; "spend no boldness elsewhere" | the reason it doesn't look like a template |

## 2. The translation

An operator spends hours here, reading research, email copy and history. The website's absolute rules exist to make a
*marketing* surface read as a printed plate. Each one is kept, or deliberately adapted, as follows.

| Website rule | In the Outbound OS | Why |
| :-- | :-- | :-- |
| Ink ground, bone type | **Kept** as the dark theme (and the default in dark mode) | It is the brand's material |
| No light theme | **Adapted**: a *bone paper* theme (bone ground, ink type), chosen by the OS setting | Long daylight sessions. It is the same print inverted, not a new palette: no sixth colour |
| Yellow = the paint state | **Kept as one job: "act here."** The primary action on a screen is a yellow plate with ink type | On the website yellow is the surface the visitor acts on (the *Book a project* plate flips to it). One yellow thing per screen tells the operator where to act |
| Vermilion = the misregistration ghost only | **Kept** on the page title, **plus one job: "stop."** The do-not-contact banner rule and the stop chip. Never decoration, never hover, never a generic "error red" | An operational tool needs a stop signal. Giving vermilion exactly that one extra job keeps "each colour has one job" true |
| Two type sizes only (hero) | **Adapted** to four: title, heading, reading, utility | The website itself lifted the rule for destinations that "carry reading copy" |
| Monospace for everything | **Adapted**: monospace for labels, statuses, dates, numbers and buttons; a system sans for sentences | Reading research and emails in monospace for hours is tiring. The mono register stays everywhere the website uses it: marks, registers, labels |
| Cinzel for the wordmark and landmarks | **Kept**: wordmark, page title, company name on its page. Nowhere else | Identity at the anchor points, no cost to legibility |
| Plates and hairlines | **Kept**: every grouped surface is a plate | This is what makes it feel like Kachmo rather than generic SaaS |
| Hard-cut state flips, minimal motion | **Kept**: no transitions on colour; only a quiet loading pulse and native `<details>` | Speed. Nothing animates that the operator has to wait for |

Rejected on purpose: gradients, glows, glass, shadows as decoration, stat-card walls, dark-mode "neon", icon sets, and
the permanently excluded observatory direction (`context/06` §6).

## 3. Tokens

All colours are the five website values, or mixes of ink and bone. There is no sixth hue.

```css
/* shared */
--ink:        #0B0A09;   --bone: #EDE9E0;   --act: #E3F32B;   --stop: #E2402A;
/* dark theme (ink ground) */
--ground: var(--ink);                 --type: var(--bone);
--type-dim:   bone 64% over ink  = #9C9993
--plate:      bone 4.5%          = #151413     --plate-lift: bone 7.5% = #1C1B19
--hair:       bone 18%                         --hair-strong: bone 46% = #73716C
/* light theme (bone paper) */
--ground: var(--bone);                --type: var(--ink);
--type-dim:   ink 64% over bone  = #5C5A56
--plate:      ink 4.5%           = #E3DFD6     --plate-lift: ink 7.5% = #DCD8D0
--hair:       ink 18%                          --hair-strong: ink 46% = #85827D
```

### Measured contrast (WCAG 2.x)

| Pair | Ratio | Use |
| :-- | --: | :-- |
| bone on ink / ink on bone | 16.33 | all reading type |
| ink on yellow | 16.13 | primary action label |
| dim on ground (dark / light) | 6.96 / 5.68 | secondary text |
| dim on plate-lift (dark / light) | 6.06 / 4.84 | secondary text inside plates |
| ink on vermilion | **4.71** | the stop chip ("DO NOT CONTACT"), both themes |
| vermilion vs ink / vs bone | 4.71 / 3.47 | stop rule (non-text, ≥ 3:1) |
| strong hairline vs ground (dark / light) | 4.06 / 3.16 | input and control boundaries (≥ 3:1) |
| yellow vs bone | 1.01 | ⇒ in the light theme, yellow plates carry an ink border |

Vermilion **text** on bone (3.47) fails AA for body text and is never used. Stop text is always ink on a vermilion
chip.

## 4. Type

| Role | Face | Size / tracking | Used for |
| :-- | :-- | :-- | :-- |
| Title | Cinzel Black | 30px (24px mobile), +0.02em, vermilion ghost `1px 1px` | page title, company name, wordmark |
| Heading | system sans 600 | 15px | section headings inside a page |
| Reading | system sans 400 | 15px / 1.55 | sentences, facts, email preview |
| Utility | system mono, uppercase | 11.5px, 0.11em | labels, statuses, dates, counts, nav, buttons |

## 5. Components

- **Plate**: `--plate` fill, 1px `--hair` border, 3px radius. A *lifted* plate (`--plate-lift`) marks the one surface
  the page is about (Next step, the email preview).
- **Label** (`.label`): the mono utility register. A label sits tight to what it names (`--space-2`).
- **Status**: a mono label with a shape, never colour alone: `● Checked`, `◐ Source recorded, not checked`,
  `○ No source`. Stop state: the vermilion chip.
- **Buttons**: mono uppercase. **Primary** = yellow plate, ink type (one per screen). **Secondary** = hairline.
  **Stop** = hairline with a vermilion rule, and the chip language on its confirmation.
- **Disclosure**: native `<details>`/`<summary>` with a mono `+`/`−` mark. Works without JavaScript, keyboard- and
  screen-reader-native.
- **Stop banner**: a plate with a 4px vermilion left rule and the stop chip. Reserved for "do not contact" and
  "automatic email is on hold".
- **Attention banner**: a plate with a 4px yellow left rule ("act here"). Reserved for things that need a person.
- **Tables**: kept only where comparing rows is the task (companies, email records, audit). Hairline rows, mono
  numerals, no zebra, no cards-as-rows.

## 6. Layout and rhythm

- Sidebar 216px on desktop; a single scrollable row of links on screens under 820px.
- Content column up to 1080px; the company page reads in one column of about 720px for text, with plates for structure.
- Spacing scale: `4 · 8 · 12 · 20 · 28 · 40 · 56` px (the website's seven steps, fixed for an app).
- The page title sits `--space-2` under its utility label; sections are separated by `--space-6`.

## 7. Motion and accessibility

- No colour transitions (the website's hard-cut rule). A 1.2s loading pulse, off under `prefers-reduced-motion`.
- Visible focus on every control: 2px outline in `--type` with 2px offset.
- Every status is carried by words and shape, never by colour alone.
- Targets ≥ 36px tall for primary actions; hit areas for links in lists span the row.
- Semantic landmarks: `nav`, `main`, headings in order, `aria-current="page"` on the active nav item.
- The display face is loaded with `next/font/local` (self-hosted, no third-party request; CSP `font-src 'self'`).
