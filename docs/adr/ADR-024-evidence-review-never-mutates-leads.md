# ADR-024: Only a Person Quoting the Page Makes Evidence SUPPORTED; Evidence Never Changes a Lead

> **Status:** Approved & Canonical (Phase B)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-19
> **Version:** 1.0.0

---

## Decision

A reviewer (`evidence.review` **and** `lead.view_contacts`) reads the retrieved page and records one verdict:

| Verdict | Recorded as | Derived level |
| :-- | :-- | :-- |
| SUPPORTS | CHECKED + the quoted passage | SUPPORTED |
| NOT_SUPPORTED | REJECTED + the reason | stays RETRIEVED |
| CONTRADICTS | a **new** human row pointing at the claim, with the quote; the original closed as REJECTED | CONTRADICTED |

- **The quote must appear verbatim in the stored retrieval** (whitespace aside, ≥ 8 characters). A reviewer chooses
  what to quote; they cannot compose it. No retrieval, no review.
- Reviewed rows are final (database guard). A new judgement is a new row.
- The level is **derived** by core's `deriveEvidenceLevel` on every read; no level is stored.
- Audit rows record the verdict and field, never the quoted text (a page can quote a phone number).

**Evidence never changes the lead or a gate.** A SUPPORTED phone source does not upgrade `phone_status`; the reviewer
records that as an explicit `lead.research_recorded` write. Wiring evidence levels into the gates is
**Methodology v1.1** — it needs owner approval, a measured diff over the live data and a new golden baseline.

### Finding

The 120 migrated leads carry **no URL source at all** — every legacy source is prose such as
"kachmo_targets.csv (legacy research, no source URL)". There was therefore nothing to backfill, and no backfill tool
ships: evidence begins with the sources people cite (`lead.research_recorded`) and those carried by approved or
merged candidates.

### Suppression semantics (release-candidate review, 2026-09-19)

Revoked means lifted, everywhere in Postgres (ADR-010): the canonical read layer, every writer (including the
duplicate check), the publisher, verification and the dispatch preflight all read ACTIVE entries only. The published
artifact stays additive by design. Before this was aligned, a new opt-out equivalent only to a revoked entry was
swallowed as a duplicate and never published; `os/tests/lead-writes.ts` §5 is the regression test.

## Implementation

`os/server/evidence/{store,review,actions}.ts`, `os/tests/evidence.ts` §4–§6.
