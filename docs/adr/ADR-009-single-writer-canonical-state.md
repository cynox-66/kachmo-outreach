# ADR-009: Single-Writer Canonical State and a Phased Cutover

> **Status:** Approved & Canonical (Phase 1.5)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-16
> **Version:** 1.0.0
> **Supersedes:** [ADR-002](ADR-002-google-sheets-over-database.md) for lead state storage. ADR-002 remains the record of why Google Sheets was originally chosen; it is not the architecture the Outbound OS is built on.

---

## Purpose

Records how lead state moves from the committed JSON store to hosted Postgres without a window in which two systems both believe they are authoritative.

---

## Context

Three stores hold lead state today:

| Store | What it is |
| :-- | :-- |
| `GIT_JSON` | `database/kachmo_leads.json`, `database/suppression.json`, `analytics/events.jsonl`, committed to git |
| `POSTGRES` | the hosted Outbound OS database (empty of production data as of Phase 1.5) |
| `TITAN` | `OUTREACH_TRACKER.md` and `scheduled-queue.json`, written by the GitHub Actions email cron |

The obvious way to move between the first two is to sync them. That is the thing this ADR exists to forbid.

---

## Decision

**Every field has exactly one writer in every phase. There is no bidirectional sync anywhere in the system.**

The cutover is a sequence of three named phases, and the current phase is an explicit recorded decision — never inferred from whether a database happens to be reachable.

| Phase | Canonical for leads | Canonical for suppression | Accepts lead writes |
| :-- | :-- | :-- | :-- |
| `PRE_CUTOVER` | GIT_JSON | GIT_JSON | GIT_JSON |
| `CUTOVER_WINDOW` | GIT_JSON | GIT_JSON | **nothing** |
| `POST_CUTOVER` | POSTGRES | POSTGRES | POSTGRES |

`TITAN` owns email send state (`lead_state`, `email_outreach_status`, `email_follow_up_sent_at`, `batch_history`) in **every** phase. The Outbound OS mirrors that state as a read-only projection and never writes it.

`CUTOVER_WINDOW` exists so the transition is a state the system can be *in*, with both stores loaded and compared, rather than an instant during which nobody knows which store is right. Nothing accepts lead writes during it, so drift cannot appear mid-comparison and rollback costs nothing: no data has changed.

All 133 fields present on the real lead records are classified into 14 ownership groups. An **unclassified field is deny-by-default** — nobody may write it until someone classifies it. Identity (`lead_id`, `target_number`, `created_at`, `migrated_from_csv`) and the never-estimated fields (`conversion_probability`, `expected_revenue`) are immutable in all phases.

---

## Consequences

**Accepted:**
- A field cannot be edited in the app before cutover, even when that would be convenient.
- The cutover window is downtime for lead editing. Email keeps running.
- Adding a lead field requires classifying it before it can be written.

**Gained:**
- Conflicts are impossible by construction rather than resolved by policy.
- Drift is a defect with a known cause, not an expected condition to be merged away.
- Rollback from the window is free.

---

## Implementation

- `core/reconciliation/ownership.ts` — phases, groups, `mayWrite()`, immutability
- `core/reconciliation/drift.ts` — pure comparison, graded by consequence, never a merge
- `scripts/__tests__/reconciliation.ts` — 59 checks, including full field coverage against the live database

---

## Cross References

- [ADR-010](ADR-010-one-way-suppression-publish.md) — how suppression crosses to Titan
- [../../audit/OUTBOUND_OS_PHASE1.5_AUDIT.md](../../audit/OUTBOUND_OS_PHASE1.5_AUDIT.md)
