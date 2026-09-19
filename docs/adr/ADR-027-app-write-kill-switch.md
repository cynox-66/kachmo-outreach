# ADR-027: Application Writes Are Off Unless Switched On; Legacy Queue Files Are Stale

> **Status:** Approved & Canonical (Phase B)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-19
> **Version:** 1.0.0

---

## Decision

0. **A development server can never write to a hosted database.** `writeRefusal` allows a write only when the
   phase is POST_CUTOVER, `KACHMO_APP_WRITES` is exactly `on`, and the target is either a loopback database or — in a
   production build (`NODE_ENV=production`) — exactly the host named by `KACHMO_APP_WRITES_HOST`. `next dev` always
   runs with `NODE_ENV=development`, so the `os/.env.local` situation (production `DATABASE_URL` on a laptop) is refused
   whatever else is set; a missing or unreadable `DATABASE_URL` is refused too. The only way a laptop could write
   production is a production build (`next build && next start`) configured with BOTH the switch and the exact
   production host — two deliberate lines, never an accident. Neither may ever be placed in `os/.env.local`.

1. **`KACHMO_APP_WRITES=on`** must be set, exactly, for the application to write canonical state: lead mutations,
   suppression, evidence reviews and the candidate → lead crossing (import and merge). Unset, empty, `true`, `yes` —
   all off. `os/.env.local` points a local `next dev` at the production database, so without this every developer
   machine would become a production writer the moment the app could write. It is also the instant rollback lever:
   switching it off stops every application write without touching data.

   Scope, stated precisely: Phase 2 research writes that never touch a canonical lead (briefs, report uploads,
   non-import review decisions) are unchanged. Operator CLIs (`leads:reevaluate`, `leads:revert`, `evidence:fetch`,
   `actor:bind`) are dry-run-first, named-human, digest-bound tools run against an explicit DATABASE_URL and are
   governed by the cutover phase, not by the switch.

2. **The legacy markdown/JSON queues** (`AADI_DAILY_CALLS.md`, `WHATSAPP_QUEUE.md`, `RESEARCH_QUEUE.md`,
   `DAILY_WAR_ROOM.md`, `queues/*.json`, `database/research-queue.json`) are produced by CLI read commands from the
   **frozen** JSON store. After cutover they are stale derived artifacts, not queues anyone should work from. The
   application computes every queue live from Postgres. They are not deleted: git history keeps them as evidence.

## Implementation

`os/server/repo/phase.ts` (`appWritesEnabled`, `writeRefusal`), `os/tests/lead-writes.ts` §1.
