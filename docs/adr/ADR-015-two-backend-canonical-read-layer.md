# ADR-015: One Read Interface, Two Backends

> **Status:** Approved & Canonical (Phase 2)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-16
> **Version:** 1.0.0

---

## Purpose

Records how the application became useful *before* the database migration, without breaking the single-writer model.

---

## Context

[ADR-009](ADR-009-single-writer-canonical-state.md) makes the committed JSON store canonical until cutover, and the hosted database holds no production data. That left two bad options:

1. Migrate the 120 leads so the app has something to show — forbidden, and premature.
2. Ship an app that displays zeros and placeholder text until migration day — a product nobody can evaluate, and a migration nobody can rehearse against a real UI.

---

## Decision

`server/repo/canonical.ts` exposes **one read interface with two backends**, selected by the declared cutover phase:

| Phase | Leads, suppression, events read from |
| :-- | :-- |
| `PRE_CUTOVER` | the committed JSON store, **read only** |
| `CUTOVER_WINDOW` | the committed JSON store, **read only** |
| `POST_CUTOVER` | hosted Postgres |

The Titan email ledger is read from its files in **every** phase, because Titan owns email send state in every phase.

Everything above this line — services, pages, the research pipeline — is written against the interface and never learns which backend answered. Cutover is therefore a configuration change (`KACHMO_CUTOVER_PHASE`), not a rewrite.

Three properties make this safe rather than merely convenient:

- **Nothing in the layer writes.** In PRE_CUTOVER the CLI owns every lead write; the app physically cannot modify the JSON files.
- **It fails closed.** A malformed lead store throws rather than rendering a partial list — a page showing 80 of 120 leads is worse than a page showing an error.
- **It is honest.** Every snapshot records `source`, and the layout renders a banner naming the canonical store. The app never implies Postgres holds data it does not.

An undeclared phase resolves to `PRE_CUTOVER`, so a deployment that forgets to configure itself is read-only.

---

## Consequences

**Accepted:**
- The whole database is read per request. At 120 leads this is correct and fast; it is the repository boundary, not the query strategy, that matters.
- Two code paths exist for reads until cutover completes.

**Gained:**
- The app is fully exercisable against real data today, so the migration is validated against a working UI rather than against hope.
- The single-writer model is preserved exactly: the app is a reader in every phase where it is not the writer.

---

## Implementation

`server/repo/phase.ts`, `server/repo/canonical.ts`, `os/tests/app.ts` §1.
