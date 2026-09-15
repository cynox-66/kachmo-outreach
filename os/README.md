# Kachmo Outbound OS (`os/`)

Private internal application around the Kachmo lead-intelligence engine. **The engine is `../core/`; this package is
an interface and infrastructure around it.** No qualification, scoring, provenance or suppression rule may be
implemented here. Services call `core/`, and React components only display what services return.

```
Browser ──► Next.js (App Router, server components / actions)
               │  authN (Better Auth) + authZ (server-side RBAC, roles from DB)
               ▼
            services (os/server/services)  ──►  core/  (Methodology v1.0, pure)
               │
               ▼
            Drizzle ──► Neon PostgreSQL   (append-only history enforced by triggers)

Titan email (GitHub Actions cron, OUTREACH_TRACKER.md, scheduled-queue.json) stays OUTSIDE this app: read-only.
```

> Status: Phase 1.2 (database foundation) complete. Authentication (1.3) and the application shell (1.4) sections below
> are filled in as those phases land.

## Local development

```bash
cd Clients/mails/os
npm install              # os/ has its own package.json; the repository root (and the Titan cron) is untouched
cp .env.example .env.local
npm test                 # database foundation tests on in-memory PostgreSQL (no hosted DB, no network)
npm run typecheck        # strict, includes ../core
npm run lint
npm run db:rehearse      # migration dry run over the committed canonical data (see below)
```

Node ≥ 20.9. Pinned: Next 16.3.5, React 19.3, Drizzle ORM 0.45.2 / drizzle-kit 0.31.10, Better Auth 1.7.5,
@neondatabase/serverless 1.1.0, PGlite 0.5.8 (tests only), Zod 4, TypeScript 5.9, ESLint 9 (ESLint 10 is not yet
supported by `eslint-config-next`'s plugins).

## Database

Neon PostgreSQL through Drizzle. Schema: `server/db/schema/`. Generated migrations: `server/db/migrations/`
(`npm run db:generate`; review every generated SQL file before committing).

| Table | Why it exists |
|---|---|
| `user`, `session`, `account`, `verification` | Better Auth core tables. Users are never deleted (`deactivated_at` instead). |
| `user_role` | Role assignments, read server-side on every request. |
| `methodology_version` | Attributes every evaluation to a methodology. v1.0 = `core/`, pinned by the golden baseline. At most one ACTIVE; an activated version is immutable. |
| `lead` | Canonical lead store. `record` (jsonb) is the complete `KachmoLead`, lossless and the single source of truth; typed columns are projections for querying. Original `lead_id` kept. Never deleted. |
| `lead_evaluation` | Append-only history of gates / completeness / scores per methodology version and engine revision. |
| `lead_evidence` | Claim-level provenance with human review status (Phase 2). Created, deliberately not populated yet. |
| `suppression_entry` | Suppression list, append-only; lifting = one attributed revocation. Order preserved. |
| `analytics_event` | The engine's operational event log (`analytics/events.jsonl`), in original order. |
| `audit_event` | Security audit log (who did what, when). Append-only. |

Deliberately **not** created yet: call / WhatsApp / pipeline tables (that history lives inside `lead.record` until the
write paths are extracted into `core/`, so a second source of truth never exists) and research missions / imports
(Phase 2).

### Enforced by the database, not just the app (`0001_append_only_guards.sql`)

- `audit_event`, `lead_evaluation`, `analytics_event`: no UPDATE, DELETE or TRUNCATE.
- `lead`, `user`: no DELETE or TRUNCATE.
- `suppression_entry`: no DELETE/TRUNCATE; identifiers and reason immutable; a single revocation with user and reason.
- `methodology_version`: once activated, content immutable and undeletable; may only move ACTIVE → RETIRED.
- Check constraints mirror `core/` value sets (provenance, research states, priorities; asserted by tests), keep
  `record.lead_id`/`target_number` equal to the row identity, and forbid `do_not_contact` without DISQUALIFIED.

## Migration safety (JSON store → PostgreSQL)

**No real data has been migrated to any hosted database.** Importing the real leads requires explicit owner approval.

`npm run db:rehearse [-- --ref=<git ref>]`:

1. Snapshots `database/kachmo_leads.json`, `database/suppression.json`, `analytics/events.jsonl` **as committed at the
   ref** into a temp directory (never the working tree).
2. Validates with the engine's own rules and fails closed: structure, invariants, UUID identities, suppression entries,
   every event line (a truncated line is an error, not silently dropped).
3. Creates an in-memory PostgreSQL, applies all migrations, imports in **one transaction** (refuses non-empty tables;
   any error rolls everything back), records a `migration.import` audit event (counts and file hashes only).
4. Reconciles: counts; lead IDs and target numbers; canonical hash of every record; projections equal record; contact
   provenance; invariants; suppression and events identical and in order; and `core/` gates, completeness, scores
   and suppression blocks identical from stored data.
5. Proves a second import is refused. Writes a report (no contact data) to `server/db/migration/out/` (gitignored).

Latest rehearsal (commit `3227afd`): 120 leads · 0 suppression entries · 240 events · all 15 checks passed.

Production migration checklist (to run only after approval): fresh `npm run audit:baseline` and git snapshot →
rehearsal passes at the exact commit being migrated → Neon **branch** created as the rollback point → `db:migrate`
(schema) on the branch → import + reconcile on the branch → owner sign-off → same steps on production → reconcile again →
the JSON store stays in git, read-only, as the archived pre-cutover state.

`npm run db:migrate` applies **schema only** to a hosted database and refuses unless `DATABASE_URL` is set **and**
`KACHMO_MIGRATE_CONFIRM_HOST` equals its host exactly. It contains no data import.

## Environment variables

See `.env.example`. All are server-only; none may be prefixed `NEXT_PUBLIC_`.

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | server, `db:migrate` | Neon connection string. Use a branch outside production. |
| `KACHMO_MIGRATE_CONFIRM_HOST` | `db:migrate` | Must equal the host in `DATABASE_URL`. |
| `BETTER_AUTH_SECRET` | auth (1.3) | ≥ 32 random bytes. |
| `BETTER_AUTH_URL` | auth (1.3) | Deployment base URL. |
| `KACHMO_BOOTSTRAP_OWNER_EMAIL` / `_NAME` | owner bootstrap (1.3) | One-time; remove after use. |

## Authentication

_Phase 1.3._

## Authorization

_Phase 1.3._

## Deployment

_Phase 1.4._ Vercel Pro (Hobby is non-commercial), project Root Directory = `Clients/mails/os`, Neon via the Vercel
Marketplace.

## Security considerations (so far)

- History tables are append-only at the database level; leads, users and suppression entries are never deleted.
- Migrations fail closed, run in one transaction, never overwrite, and are reconciled field by field.
- Reports and audit metadata never contain contact values.
- ESLint forbids importing `nodemailer`/`imapflow` or the legacy `scripts/` into the app (no second email pipeline).
- Rehearsal output and `.env*` files are gitignored.
