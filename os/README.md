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
npm test                 # database + auth + shell suites (in-memory PostgreSQL, no hosted DB, no network)
npm run test:db          # schema, constraints, history guards, migration rehearsal
npm run test:auth        # authentication, authorization, audit
npm run test:shell       # application shell boundaries (static)
npm run typecheck        # strict, includes ../core
npm run lint
npm run build            # production build
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
| `KACHMO_CUTOVER_PHASE` | canonical read layer | **Production must set `POST_CUTOVER`.** Unset means PRE_CUTOVER, which reads the frozen JSON store (not deployed, so every page errors). |
| `KACHMO_BOOTSTRAP_OWNER_EMAIL` / `_NAME` | owner bootstrap (1.3) | One-time; remove after use. |

## Authentication

Better Auth with email + password, sessions in Postgres (`server/auth/auth.ts`). Policy constants live in
`AUTH_POLICY` and are pinned by tests.

- **Invite-only.** Public sign-up is disabled (`disableSignUp`). Accounts are created by the owner bootstrap or, later,
  by a user manager inside the application.
- **No email-based password reset.** This application never sends email (Titan owns email), so `sendResetPassword` is
  not configured. An owner resets a password; `revokeSessionsOnPasswordReset` signs the account out everywhere.
- **Passwords**: 12–128 characters, stored only as scrypt hashes (Better Auth default, `node:crypto`).
- **Sessions**: 12 hours, refreshed at most hourly, validated against the database on every request
  (`cookieCache` disabled, so deactivation takes effect immediately).
- **Cookies**: `kachmo.` prefix, `HttpOnly`, `SameSite=Lax`, `Secure` and `__Secure-` prefixed in production.
- **Origin and CSRF checks stay on**; the only trusted origin is `BETTER_AUTH_URL`.
- **Rate limiting** is database-backed (holds across serverless instances): 5 sign-in attempts per 15 minutes per IP,
  3 password-reset requests per hour, 100 requests per minute overall. On Vercel the client IP comes from
  `x-forwarded-for`, which the platform sets; do not run this behind a proxy that lets clients forge it.
- **Deactivated users** (`user.deactivated_at`) cannot create a session and resolve to no actor.

### First owner (`npm run owner:bootstrap`)

Creates the first OWNER on a fresh deployment and refuses once any OWNER exists. Email and name come from
`KACHMO_BOOTSTRAP_OWNER_EMAIL` / `KACHMO_BOOTSTRAP_OWNER_NAME`; the password is typed interactively (hidden, twice) or
piped on stdin — never in source, never in an environment variable, never logged. The action is audited. Remove the
bootstrap variables afterwards. Further accounts are created by an owner from inside the application.

## Authorization

Deny by default. Roles are read from `user_role` on every request; nothing the browser sends is trusted, and hidden UI
is never a security control.

| Role | Holds |
|---|---|
| OWNER | everything, including `methodology.manage`, `suppression.revoke`, `api_clients.manage` |
| ADMIN | everything except those three |
| RESEARCHER | view leads + contacts, create/edit leads, create and upload research, view suppression, analytics |
| OUTREACH | view leads + contacts, call / WhatsApp / email-prepare, email ledger, pipeline, create suppression, analytics |
| INTERN | view leads (contacts masked), create and upload research — no approve, export, contact or suppression |
| VIEWER | view leads (masked), analytics |

`server/authz/permissions.ts` is pure and testable: `permissionsFor(roles)`, `hasPermission`, `canAssignRole`
(only an OWNER may grant OWNER). `server/authz/authorize.ts` resolves the actor from the database and
`assertPermission` throws. In Next.js, use `requirePermission('lead.approve')` from `server/auth/current-actor.ts`
inside **every** server action, route handler and data loader; denials are audited as `authz.denied`.

No permission exists to send email, force or bypass anything.

## Audit

`server/audit/audit.ts` appends to `audit_event` (append-only in the database). Actions are namespaced and validated
(`lead.approve`, `auth.sign_in_failed`). Metadata, `before` and `after` are redacted first: keys naming contact values,
passwords, tokens or cookies are replaced, and email/phone-shaped strings in free text are masked. IP addresses are
stored only as a keyed hash.

## API authentication (planned, Phase 4)

For IDE-generated research imports: bearer tokens issued per client, stored only as a hash in an `api_client` table
with scopes, `created_by`, `last_used_at` and `revoked_at`; rate limited per client; every request audited; payloads
schema-validated and routed into the review queue — never straight into the canonical lead database. No token grants
send, force or suppression-bypass abilities.

## Upload security (planned, Phase 2)

Research report uploads: authenticated and permission-checked (`research.upload`), size-capped, type sniffed by magic
bytes (not by filename or client MIME), stored privately under a random key (never the user's filename), never served
back as HTML, never executed, and text-extracted in isolation. Extracted content is untrusted input: it is treated as
data only — never as instructions — and reaches leads only through human review.

## Application shell

App Router, every authenticated route server-rendered on demand (`force-dynamic`) — nothing about a lead is ever
statically pre-rendered.

| Route | Permission |
|---|---|
| `/` Today | `lead.view` |
| `/leads` | `lead.view` (contacts shown only with `lead.view_contacts`) |
| `/research` | `research.create` |
| `/calls` | `outreach.call` |
| `/whatsapp` | `outreach.whatsapp` |
| `/email` Email ledger (read-only) | `email.view_ledger` |
| `/pipeline` | `pipeline.update` |
| `/analytics` | `analytics.view` |
| `/settings` | `settings.manage` |
| `/login`, `/api/auth/*` | public |

- `app/(app)/layout.tsx` resolves the actor with `requireActor()`; each page calls `requirePermission(...)` again.
  Navigation is filtered by permission for convenience only — hidden links are never the security boundary.
- `proxy.ts` (Next 16's renamed middleware) only redirects based on the *presence* of a session cookie. It validates
  nothing and makes no authorization decision.
- Sign-in posts to a server action that calls Better Auth's own handler, so rate limiting, origin checks and cookie
  attributes behave exactly as for any other client; the error never reveals whether an account exists, and failures
  are audited with a hashed IP.
- Pages contain no engine logic: they display stored values. With an empty database the dashboard says so plainly
  instead of rendering zeros as if they were findings.

### Note on imports

`os/` uses extensionless relative imports because Turbopack does not map NodeNext `.js` specifiers onto `.ts` files.
`core/` keeps its `.js` specifiers (required by NodeNext) and is currently imported by the app only as types. **Before
the app imports `core/` at runtime** (Phase 1.5+), give `core/` a package entry point (a `package.json` with exports,
consumed via `transpilePackages`) so those specifiers resolve in the bundler too.

## Deployment

Not deployed yet. Planned: Vercel **Pro** (Hobby forbids commercial use), project **Root Directory =
`Clients/mails/os`**, Neon Postgres via the Vercel Marketplace.

Checklist for the first deployment:

1. Create the Neon project and a development branch; keep production and development URLs separate.
2. Set `DATABASE_URL`, `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), `BETTER_AUTH_URL` and
   `KACHMO_CUTOVER_PHASE=POST_CUTOVER` in Vercel (all server-side; never `NEXT_PUBLIC_`).
3. Apply the schema: `KACHMO_MIGRATE_CONFIRM_HOST=<neon host> npm run db:migrate`.
4. Create the first owner: `npm run owner:bootstrap` (password typed at the prompt), then remove the bootstrap
   variables.
5. Give the application a least-privilege database role (no ability to drop the history triggers).
6. Turn on Vercel deployment protection so only the team can reach preview URLs.

Importing the real lead data is a separate, approved step — see "Migration safety" above.

## Security considerations (so far)

- History tables are append-only at the database level; leads, users and suppression entries are never deleted.
- Migrations fail closed, run in one transaction, never overwrite, and are reconciled field by field.
- Reports and audit metadata never contain contact values.
- ESLint forbids importing `nodemailer`/`imapflow` or the legacy `scripts/` into the app (no second email pipeline).
- Rehearsal output and `.env*` files are gitignored.
