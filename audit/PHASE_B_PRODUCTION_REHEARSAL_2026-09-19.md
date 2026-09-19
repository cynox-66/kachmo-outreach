# Phase B — Production Rehearsal (loopback replica)

> **Date:** 2026-09-19 · **Code:** `e3f3414` (branch `phase-b-write-path`) · **Production touched:** NO

A production-shaped replica on loopback Postgres 16 **with verified TLS** (a locally generated CA, so the operator
tools ran with their production TLS settings unchanged): schema at production's current level (migrations
0000–0003) plus the canonical data exactly as committed — 120 leads, 0 suppression entries, 240 events, the counts
production holds. Every command ran with `KACHMO_NO_LOCAL_ENV=1` and an explicit loopback `DATABASE_URL`, so
`os/.env.local` (which points at production) was never read.

## Results

| Runbook step | Command | Result |
| :-- | :-- | :-- |
| Standard rehearsal | `db:rehearse` (PGlite, exact commit) | all reconciliation checks pass; schema 0000–0004, 19 tables |
| Schema | `db:migrate` without confirmation | refused (`KACHMO_MIGRATE_CONFIRM_HOST` required) |
| Schema | `KACHMO_MIGRATE_CONFIRM_HOST=127.0.0.1 db:migrate` | 0004 applied; 5 migrations; lead hash **identical** before/after (`600964ef…`), 240 events unchanged; rerun is a no-op |
| Bind people | `actor:bind` ×2 | bound; an agent-shaped `--actor` refused |
| Re-evaluate (dry run) | `leads:reevaluate` | **23 would change, 97 evaluation-only** — every change is `next_action` only |
| Re-evaluate (apply) | wrong digest → refused; right digest → applied | 23 rewritten, 120 evaluations, **0 research-state or priority changes, 0 new events** |
| Idempotency | `leads:reevaluate` again | 0 to change, 0 to record |
| Evidence | `evidence:fetch` (dry run) | 0 source URLs (as expected — no legacy lead has one) |
| Rollback | `leads:revert --lead=016 --to-version=1` | dry run → digest → applied as a new version (see finding 2) |
| Titan boundary | `suppression:verify` | artifact IN_SYNC; dispatch preflight clears all 5 queued emails against the migrated schema |

## Findings

1. **The re-evaluation diff is 23 leads, not 18.** All 23 are Titan-ledger-driven `next_action` text:
   - 18 are the webmail sends reconciled on 2026-09-18 (`"Drafted in Titan…"` → `"Watch Titan inbox…"`);
   - 5 (106–110) were sent by the Titan cron on 2026-09-14 (`e922b03`, ledger `SENT`) while their stored text still
     said `"Scheduled in production email queue"`.
   No gate, score, state or priority changes. **The production dry run should show exactly these 23 leads, each
   changing only `next_action`. Anything else: stop and investigate.**
2. **`leads:revert` writes a version even when nothing changes.** It re-evaluates the restored record against today's
   ledger, so reverting a purely derived change reproduces the current state; it still wrote version 3 with
   `fieldsChanged: []`. Harmless (history and audit only), not a safety issue. Small follow-up: refuse "nothing to
   revert" when no field would change.

## Not rehearsed here (owner actions)

- `db:rehearse:hosted` on a disposable **Neon** branch (real Neon endpoint and pooler). Needs a branch created in the
  Neon account.
- Anything against production.
