# ADR-013: The Archetype/Vertical Taxonomy Is Versioned, Not Yet Corrected

> **Status:** Approved & Canonical (Phase 1.5) — records a **deferred** product decision
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-16
> **Version:** 1.0.0

---

## Purpose

Records a real inconsistency in the live data, and the decision to make it explicit rather than silently fix it.

---

## Context

The 120-lead database uses six archetype IDs. `archetype_label`, however, is overloaded:

- Archetype **2** carries two different labels: `2: Startup Craft Upgrade` (25 leads) and `2: Funded Startup` (5 leads).
- Archetype **6** carries **ten distinct industry verticals** as labels — `Dental Clinics & Chains`, `Jewelry Showrooms`, `Wedding Venues & Banquet Halls`, and seven more — one lead each.

So archetype (the play Kachmo runs) and vertical (the market segment) are not currently separate dimensions in the stored data.

Separately, `location_country` holds `Scotland` and `Northern Ireland` alongside `United Kingdom`.

---

## Decision

**Declare the taxonomy as it actually is; do not correct it in Phase 1.5.**

`core/config/taxonomy.ts` records all six archetypes with every `archetype_label` actually observed at commit `48cfbc0`, flags which archetypes carry verticals rather than archetype names, and exposes `verticalFromLabel()`, which recovers a vertical where one is recoverable and returns `null` rather than guessing where it is not.

Nothing in the taxonomy is read by a qualification gate or a score. It declares; it does not configure.

**Not done, deliberately:** no archetype is added, renamed or merged; the paused UK micro-trades / Companies House archetype is not revived; `Scotland` and `Northern Ireland` are left as stored.

---

## Rationale

Correcting the taxonomy would re-segment the live dataset and change which leads appear in which queue. That is a product decision with a commercial consequence, not a cleanup. Making it a versioned configuration boundary means it can be changed later without rewriting any domain logic.

---

## Consequences

**Accepted:**
- Archetype 6 inventory is reported per vertical, so it looks like ten segments of one lead each — which is what the data actually says.
- The inconsistency stays visible until someone decides.

**Gained:**
- Taxonomy can change without touching gates, scoring or queues.
- A test asserts every archetype and label in the live database is declared, so an undeclared one fails loudly.

---

## Open question for the owner

> Should archetype and vertical become separate stored fields, and if so, what are archetype 6's leads' actual archetype?

---

## Implementation

- `core/config/taxonomy.ts`
- `scripts/__tests__/core-extraction.ts` §8
