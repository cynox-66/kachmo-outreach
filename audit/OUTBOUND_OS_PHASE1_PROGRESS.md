# Kachmo Outbound OS — Phase 1 progress log

> Authority: Phase 1 brief (2026-09-15) · Phase 0 assessment: `audit/OUTBOUND_OS_PHASE0_ASSESSMENT_2026-09-15.md`
> Repository: `Clients/mails` (`github.com/cynox-66/kachmo-outreach`, confirmed PRIVATE by the owner) · branch `main`
> Nothing in Phase 1 is pushed without explicit authorisation.

| Sub-phase | Status |
|---|---|
| 1.0 Pure logic extraction | ✅ complete |
| 1.0A Golden behaviour verification | ✅ complete — 120/120 leads identical |
| 1.1 Titan security hardening | ✅ complete (isolated commit, not pushed) |
| 1.2 Hosted database foundation | ✅ complete — schema, migrations, rehearsal tooling; **no real migration performed** |
| 1.3 Authentication + authorisation | ✅ complete |
| 1.4 Application shell | not started |

---

## Phase 1.0 + 1.0A — Core extraction with golden verification

### Git state at start
`main` = `origin/main` at `48cfbc0`. Pre-existing uncommitted changes (not from this work, left untouched and never
staged): regenerated `AADI_DAILY_CALLS.md`, `DAILY_WAR_ROOM.md`, `RESEARCH_QUEUE.md`, `WHATSAPP_QUEUE.md`,
`database/research-queue.json`, `queues/*.json`.

### Order of work (why the result is trustworthy)
1. **Baseline first, from untouched code.** A snapshot harness (`scripts/__tests__/golden/snapshot.ts`) was written
   and the v1.0 baseline captured from the legacy script modules **before any logic moved**.
2. The harness was run again on the unchanged code: 36/36 identical (proves the harness itself is deterministic).
3. `core/` was written and checked against the baseline **before any script was rewired**: 36/36 identical.
4. The scripts were switched to thin wrappers over `core/`; the legacy 225-assertion suite and the golden suite
   (through the CLI modules and through `core/` directly) were both re-run: all identical.

### Golden input and determinism
- Input: the real 120-lead dataset, read with `git show 48cfbc0:<path>` (lead DB, suppression, research queue, events,
  tracker, scheduled queue, CSV) into a throwaway temp directory. The working tree is never read or written.
- Fixed date `2026-09-15` (`KACHMO_TODAY`) and fixed clock for call spacing. No network, no LLM.
- The committed baseline contains **no email addresses or phone numbers** (scanned): contact-bearing values are
  SHA-256 hashes; run-time timestamps are stripped.

### Behaviour verification — old (legacy baseline) vs new

| Dimension | Legacy baseline | via CLI modules | via `core/` directly |
|---|---|---|---|
| Lead IDs (120) | captured | 100% identical | 100% identical |
| 8 gates, missing intelligence, reasons, research state | RESEARCH_REQUIRED 107 · QUALIFIED 13 (pure) | identical | identical |
| Research completeness | per lead | identical | identical |
| Heuristic scores + tiers + priority confidence | A+ 2 · A 18 · B 80 · C 20 · all PROVISIONAL | identical | identical |
| Contact provenance (phone / email route / WhatsApp) | per lead | identical | identical |
| Suppression match + outreach block | per lead + 840 synthetic probes (lead_id 120, target 120, email 60, domain 105, phone 18, DNC flag 120, ledger REPLIED_NO 120 blocked) | identical | identical |
| Call queue eligibility | 0 callable (every phone UNVERIFIED) | identical | identical |
| Research tasks, call cards, WhatsApp drafts | hashed per lead | identical | identical |
| Dedupe findings, invariants, timezone, tracker parse | 0 duplicates · 0 violations | identical | identical |
| Full pipeline after `leads:refresh` (lead records, research queue order, calling/WhatsApp queues, war room, weekly report, event log, operator markdown) | RESEARCH_REQUIRED 107 · QUALIFIED 10 · OUTREACH_READY 3 · research queue 120 · events 240 | identical | n/a (pipeline is CLI) |

### What moved into `core/` (19 files, pure TypeScript)
`leads/schema.ts` · `leads/validation.ts` · `leads/invariants.ts` · `leads/dedupe.ts` · `leads/opportunity.ts` ·
`contact/provenance.ts` · `suppression/match.ts` · `qualification/gates.ts` · `qualification/completeness.ts` ·
`scoring/score.ts` · `research/tasks.ts` · `queues/calls.ts` · `queues/whatsapp.ts` · `email-ledger/tracker.ts` ·
`email-ledger/queue-check.ts` · `geo/timezone.ts` · `util/text.ts` · `index.ts` · `platform.d.ts`.
Full interface table and dependency rules: `core/README.md`.

Structural changes made during extraction (behaviour identical, proven by golden):
- Research completeness split out of `evaluateLeadGates` into `researchCompleteness()`; its missing-intelligence
  entries are appended at exactly the same position.
- The "write result onto the lead" loops became `applyQualification`, `applyScores`, `applyOpportunity` (same field
  order, same change rules); event logging and saving stay in the scripts.
- `loadLeads` validation → `validateLeadDatabase`; suppression list validation → `suppressionEntryProblems`; duplicate
  suppression detection → `isEquivalentSuppression`. Error messages unchanged (the legacy recovery tests assert them).
- `parseTracker(path)` → `parseTrackerContent(content)` (the file read stays in `scripts/lib/email-state.ts`).
- `normalizeCompanyName`: the literal combining-mark range became the escaped `[̀-ͯ]` (same characters).

### Deliberately NOT extracted yet
Research recording (`leads-record.ts`), call / WhatsApp / pipeline state machines, suppression propagation, CSV
migration, war room and weekly report. They mix rules with CLI argument handling; they move in Phase 1.4 with their own
golden coverage. Listed in `core/README.md`.

### Dependency boundary (enforced)
- `core/tsconfig.json` compiles `core/` with **no Node and no DOM types**: `fs`, `process`, `fetch`, `Buffer` cannot
  compile. Only the WHATWG `URL` parser is declared (`platform.d.ts`).
- The golden runner asserts: no Node I/O imports, no persistence/mail/auth/framework packages, no `process.`/`fetch`,
  no import escaping `core/`, and no second copy of gate / scoring / call-eligibility / suppression logic in `scripts/`.

### Known v1.0 limitation recorded, not changed
`isUrl()` is a format check. A URL-shaped string counts as "sourced". Changing that would change Methodology v1.0; the
fix belongs to the Phase 2 evidence-validation layer (external URLs stay unreviewed until a human checks them).

### Tests

| Suite | Before | After | Notes |
|---|---|---|---|
| Legacy (`npm run test:legacy`) | 225 passed / 0 failed | **225 passed / 0 failed** | 3 existing assertions now *also* scan `core/` (template names/URLs ×2, no mailer/network code ×1) so moving code there cannot hide it. Count unchanged. |
| Golden (`npm run test:golden`) | — | **42 passed / 0 failed** | new: 36 behaviour + 6 boundary |
| `npm test` (both) | 225 | **267 passed / 0 failed** | |
| Type-check `core/` (no Node types) | — | ✅ clean | new |
| Type-check `scripts/` + `core/` strict | 1 error | 1 error | the same pre-existing error in protected `send-titan-smtp.ts:305` (`dayOfWeek`) — fixed in 1.1 |
| Lint | — | **not available** | no linter exists in the repository; adding one to the root `package.json` would change what the cron's `npm install` pulls. ESLint arrives with `os/` (1.4) and will lint `core/` from there. |
| Build | — | n/a | no build step for CLIs (tsx) |

Production data was hashed before and after every test run (lead DB, suppression, research queue, events, tracker,
scheduled queue, queues, operator markdown, CSV): **unchanged**.

### Files touched (Phase 1.0)
- Added: `core/**` (19 files + `README.md` + `tsconfig.json`), `scripts/tsconfig.json`,
  `scripts/__tests__/golden-v1.ts`, `scripts/__tests__/golden/{snapshot,impl-legacy,impl-core,capture-baseline}.ts`,
  `scripts/__tests__/golden/methodology-v1.0.baseline.json`, this file.
- Modified (now thin wrappers over `core/`, same exports): `scripts/lib/{schema,text,invariants,contact,geo,email-state,store}.ts`,
  `scripts/{leads-qualify,leads-score,leads-opportunity,leads-research-queue,queue-calls,queue-whatsapp,leads-dedupe,email-queue-check}.ts`.
- Modified: `scripts/__tests__/run-tests.ts` (3 scans extended to `core/`), `package.json` (`test` now runs both suites;
  added `test:legacy`, `test:golden`, `typecheck`).
- **Not touched:** all 11 protected Titan files, the workflow, every data file.

### Decisions taken in 1.0
- Tests for the golden suite use git-pinned input rather than a copied fixture, so no additional copy of prospect
  data enters the repository (`.gitignore` already treats data copies as sensitive).
- The root repository gets **no `tsconfig.json`**, because tsx resolves tsconfig from the working directory and the
  GitHub cron runs `npx tsx scripts/cron-dispatch.ts` from the root.

### Risks carried forward
- Rules not yet extracted (recording, state machines) still exist only in `scripts/`; the hosted app must not
  reimplement them — it waits for their extraction in 1.4.
- Golden input depends on commit `48cfbc0` being present in the clone (true for any normal clone of this repo).

### Migration status
No migration performed. No database exists yet.

---

## Phase 1.1 — Titan security hardening

### Git state at start
`main` at `0e81e91` (Phase 1.0), 2 commits ahead of `origin/main`, not pushed. Same pre-existing uncommitted derived
files as before, still untouched.

### Problem (Phase 0 finding D3)
`npm run send:titan` (`scripts/send-titan-smtp.ts`) could send any JSON payload with no suppression check, no
already-sent check and no ledger update; it crashed with `ReferenceError: dayOfWeek` on the outside-window path; and
both Titan SMTP transports accepted any TLS certificate.

### Pre-check before restoring TLS verification
Connected without logging in (STARTTLS / TLS handshake only, no credentials, no email) using Node's own CA store:
`smtpout.secureserver.net:587` and `imap.secureserver.net:993` both present valid, trusted Starfield certificates
(valid to 2027). Turning verification on therefore does not break sending from the configured host. **Residual risk:**
the GitHub Actions secret `TITAN_SMTP_HOST` could name a different host; it defaults to the same one.

### What changed

| File | Change |
|---|---|
| `core/email-ledger/send-guard.ts` (new, pure) | `evaluateSendGuard(payloads, {suppression, leads, ledger, scheduledQueue})`. Blocks, in order: invalid recipient; duplicate target/recipient within the batch; suppressed **target**, **recipient** (any case), **domain** (https/www/path/case variants); lead-level `outreachBlock` (DNC flag, REPLIED_NO/OPT_OUT statuses, lead_id-only suppression entries); recipient already emailed under another target; target with no ledger row. **First touch** needs ledger state DRAFTED/SCHEDULED, is refused if already in any sent state, and is refused while the cron still holds it in `scheduled-queue.json`. **Follow-up** (subject `Re:`, the `/mail-followup` convention) needs SENT/FOLLOW_UP_DUE and is refused after FOLLOWED_UP or a follow-up logged via `pipeline:log` (single-bump protocol). No override parameter exists. |
| `core/email-ledger/ledger-update.ts` (new, pure) | `applyLedgerSendUpdate`: header-driven tracker transition after a real send. DRAFTED/SCHEDULED → SENT with sent date and +3-day follow-up (what the cron writes); SENT/FOLLOW_UP_DUE → FOLLOWED_UP. Rows in other states are never rewritten. |
| `scripts/lib/titan-send-guard.ts` (new) | File adapter, **fail closed**: suppression list (missing / invalid JSON / not an array / malformed entry), email ledger (missing / no rows), lead database, scheduled queue; refuses when the checkout is known to be behind origin; atomic ledger write. |
| `scripts/send-titan-smtp.ts` (protected, approved) | Guard runs right after the payload is read, before confidence routing, SMTP, drafts and dry-run output; blocked payloads are neither sent nor drafted. Each successful send updates the ledger immediately; if that update fails, no further email is sent in the run. `dayOfWeek` defined from the recipient-timezone weekday. `tls.rejectUnauthorized: true` (via exported `smtpTransportOptions`). `calculateSendWindow(tz, now)` exported; `main()` only runs when executed as the command, so tests can import it without sending. Payload format, SMTP code path, timezone maps, throttling, IMAP drafts and `--test` are unchanged. |
| `scripts/cron-dispatch.ts` (protected, approved) | One line: `rejectUnauthorized: false` → `true`. Nothing else. |
| `scripts/__tests__/run-tests.ts` | Group 24's "dispatcher unchanged since the approved suppression patch" now permits exactly that single TLS line and nothing else. |
| `audit/baseline-2026-09-15T0709/protected-checksums.txt` | New protected-file baseline via `npm run audit:baseline`. Versus the previous baseline, only `send-titan-smtp.ts` and `cron-dispatch.ts` differ; the other 9 protected files are byte-identical. |
| `package.json` | `test` also runs the Titan suite; `test:titan` added. |

### Behaviour change operators should know
- `send:titan` now refuses a target that has **no OUTREACH_TRACKER.md row** or is in a non-sendable ledger state. The
  ledger must record a target (DRAFTED/SCHEDULED) before it can be sent directly.
- A first touch for a target still queued in `scheduled-queue.json` must be removed from the cron queue first.
- A follow-up must use a `Re:` subject (as `/mail-followup` already specifies) and is allowed once.
- `send:titan` now writes `OUTREACH_TRACKER.md` after each real send (the same transition the cron writes). Commit and
  push that change as usual, outside a cron run.

### Tests

| Suite | Before 1.1 | After 1.1 |
|---|---|---|
| Legacy | 225 / 0 | **225 / 0** (group 24 dispatcher assertion re-pinned to the approved TLS line) |
| Golden | 42 / 0 | **42 / 0** |
| Titan direct-send (`npm run test:titan`) | — | **56 / 0** (new) |
| `npm test` total | 267 | **323 passed / 0 failed** |
| Type-check `core/` (no Node types) | clean | clean |
| Type-check `scripts/` + `core/` strict | 1 error (`dayOfWeek`) | **clean** |

The new Titan tests cover: suppressed recipient / domain / target; lead-level DNC and lead_id-only entries; missing and
five kinds of malformed suppression list (spawned sender exits non-zero before touching any payload); missing ledger,
unreadable lead DB, malformed scheduled queue; already-sent, replied, disqualified, unknown target, same recipient under
another target, cron-queued target, duplicates in one batch; single follow-up allowed, second refused (ledger or
pipeline log), no follow-up after a reply; ledger transitions and "re-run is blocked after the ledger update"; no
force/skip flag and guard ordering in the source; Saturday / Friday-late / Tuesday-late / Sunday-India / in-window /
before-window send-window results without a crash; certificate verification in all three Titan scripts.

**Nothing was sent.** The sender is only spawned with `--dry-run`, a fake password, SMTP/IMAP host `127.0.0.1:9`, in a
temp directory without `.env`; the test helper throws if `--dry-run` is missing. Production data hashed before and after:
unchanged. No GitHub Action was triggered; nothing was pushed.

### Remaining Titan risks (not changed in 1.1)
- `create-titan-drafts.ts` still reads the CSV directly with no suppression check (drafts only, never sends).
- The workflow's `git push` without `pull --rebase` (duplicate-send race during a concurrent push) is unchanged.
- The cron's own suppression check does not match lead_id-only entries (`suppress:add` always also writes the target).
- The protections reach GitHub only once these commits are pushed; until then the cron runs the previous code
  (which already has suppression, but no certificate verification).

---

## Phase 1.2 — Hosted database foundation

### Git state at start
`main` at `3227afd` (Titan hardening), 3 commits ahead of `origin/main`, not pushed.

### Placement
New package `os/` with its own `package.json` / lockfile (Phase 0 decision D6). The repository root `package.json`,
lockfile and workflow are unchanged, so the cron's `npm install` + `npx tsx scripts/cron-dispatch.ts` is unaffected.
Versions checked on npm at install time and pinned exactly. ESLint pinned to 9.39.5 because `eslint-config-next`
16.3.5's plugins declare `eslint ≤ 9` (ESLint 10 produced invalid peer dependencies).

### Schema (12 tables, each justified in `os/README.md`)
Auth: `user` (never deleted, `deactivated_at`), `session`, `account`, `verification`, `user_role`.
Domain: `methodology_version`, `lead` (lossless `record` jsonb = source of truth + typed projections + `version`),
`lead_evaluation` (append-only), `lead_evidence` (Phase 2 provenance structure, not populated),
`suppression_entry` (append-only, attributed single revocation), `analytics_event`, `audit_event` (append-only).
Deliberately deferred: call / WhatsApp / pipeline tables (would duplicate `lead.record` → two sources of truth),
research missions / imports (Phase 2).

Migrations: `0000_initial_schema.sql` (drizzle-kit generated, reviewed) and `0001_append_only_guards.sql` (hand-written
triggers: append-only history, no deletion of leads/users/suppression, single attributed revocation, immutable activated
methodology). No destructive statement in any migration (tested).

### Methodology architecture
`os/server/methodology/v1.ts` describes Methodology v1.0 (gate list, outcome vocabulary, provenance levels, scoring
thresholds and basis, archetype scope defaults, calling limits) by importing the constants **from `core/`**, links the
golden baseline, records the `isUrl` limitation, and lists the conflicting prose versions as unadopted proposals. It is
seeded as the single ACTIVE methodology on import. It describes the engine; it does not configure or change it.

### Migration tooling (dry run only)

| File | Role |
|---|---|
| `server/db/migration/source.ts` | Loads the canonical JSON data from a snapshot directory; validates with `core/` (`validateLeadDatabase`, `findInvariantViolations`, `suppressionEntryProblems`) plus UUID identities, jsonb-storability and strict event parsing. Fails closed. |
| `server/db/migration/transform.ts` | Pure record → row mapping and inverses. |
| `server/db/migration/import.ts` | One transaction; refuses non-empty tables; seeds methodology v1.0; audit event with counts + file hashes. |
| `server/db/migration/reconcile.ts` | 14 before/after checks incl. core engine parity from stored data. Details list target numbers only. |
| `server/db/migration/rehearse.ts` | `npm run db:rehearse`: git snapshot → in-memory PostgreSQL → import → reconcile → second-import refusal → report (gitignored). |
| `server/db/migrate.ts` | `npm run db:migrate`: schema only, refuses without `DATABASE_URL` and exact `KACHMO_MIGRATE_CONFIRM_HOST`. |

### Rehearsal result (real data, commit `3227afd`, in-memory PostgreSQL)

| Check | Result |
|---|---|
| Lead count | 120 → 120 ✅ |
| Every lead_id present, none extra; target → lead_id mapping identical; no duplicates | ✅ |
| Every stored record identical to source (canonical SHA-256) | 120/120 ✅ |
| Typed columns equal stored record | ✅ |
| Contact provenance (status + source) preserved | 120/120 ✅ |
| Invariant violations in stored data | 0 ✅ |
| Suppression identical and ordered | 0 → 0 ✅ |
| Analytics events identical and ordered | 240 → 240 ✅ |
| Core gates / completeness / scores / suppression blocks from stored data = from source | 120/120 ✅ |
| Second import refused | ✅ |

### Migration status
**No real migration performed. No hosted database has been created or connected to.** Only in-memory PGlite
databases were used.

### Tests

| Suite | Result |
|---|---|
| `os` database foundation (`cd os && npm test`) | **60 passed / 0 failed** (new) |
| Root `npm test` (legacy + golden + Titan) | **225 + 42 + 56 = 323 passed / 0 failed** (unchanged) |
| Root `npm run typecheck` | clean |
| `os` `tsc --noEmit` (strict, includes `core/`) | clean |
| `os` ESLint (next core-web-vitals + typescript, no-restricted-imports for mailers / scripts) | **clean — 0 errors, 0 warnings** (1 error + 4 warnings fixed before commit) |

The 60 `os` tests cover: schema value lists equal `core/` sets; exactly the 12 tables; no destructive migration
statement; full real-data rehearsal (every reconciliation check); invalid provenance, record/identity mismatch and
DNC-without-DISQUALIFIED rejected; lead/user/suppression/audit/analytics deletion and truncation blocked; audit
edits blocked; namespaced audit actions; unknown roles rejected; suppression identifier immutability and single
attributed revocation; activated methodology immutable and undeletable; single ACTIVE version; reconciliation detects a
silently edited provenance value and never prints contact data; failed import leaves zero rows (rollback); populated
tables refuse import; one audit event without contact data; source rejection for missing file, corrupt JSON, duplicate
lead, non-UUID id, invariant violation, truncated event line, identifier-less suppression; `db:migrate` refusals without
URL, without or with mismatched host confirmation (credentials never printed), and no data import in it.

Production data hashed before/after all runs: unchanged.

### Risks
- PGlite is PostgreSQL compiled to WASM; Neon behaviour is expected to match for this schema, but the first run of
  `db:migrate` against a Neon **branch** is still the real proof.
- `lead.record` jsonb normalises key order; losslessness is therefore proven by canonical hashing (tested), not bytes.
- Triggers protect against the application's connection; a database owner role can still disable them. Production
  should use a separate least-privilege role for the app (1.4 deployment step).

---

## Phase 1.3 — Authentication and authorisation

### Git state at start
`main` at `0ec36e9` (database foundation), 4 commits ahead of `origin/main`, not pushed.

### What was built

| File | Role |
|---|---|
| `os/server/auth/auth.ts` | Better Auth factory. Invite-only (`disableSignUp`), 12–128-char passwords (scrypt), 12-hour DB-backed sessions validated on every request, `kachmo.`-prefixed `HttpOnly` / `SameSite=Lax` / `Secure` (`__Secure-`) cookies, origin + CSRF checks on, database-backed rate limits (sign-in 5 / 15 min per IP), deactivated users refused at session creation. No `sendResetPassword`: the OS never sends email. |
| `os/server/auth/bootstrap-owner.ts` | First-OWNER bootstrap. Refuses when an OWNER exists or the email is taken; password from hidden TTY input or stdin, never from source/env/logs; audited. |
| `os/server/auth/instance.ts` | `server-only` lazy singleton (pool + auth) for Next.js. |
| `os/server/auth/current-actor.ts` | `server-only` `getCurrentActor` / `requireActor` / `requirePermission` for pages, actions and route handlers; audits denials. |
| `os/server/authz/permissions.ts` | Pure permission model: 25 permissions × 6 roles, deny by default, `canAssignRole` (only OWNER grants OWNER). |
| `os/server/authz/authorize.ts` | Actor resolution from the database (roles never from the client), `assertPermission`. |
| `os/server/audit/audit.ts` + `redact.ts` | Append-only audit writes with validated namespaced actions, redaction of contact values/secrets, keyed IP hashing. |
| `os/server/db/client.ts` | `pg` pool with verified TLS. Chosen over the Neon HTTP driver because Better Auth's adapter needs real transactions. |
| `0002_auth_rate_limit.sql` | `rate_limit` table for database-backed limits (13th table). |

### Decisions
- **No self-service password reset**, because it would require sending email and this application must never become a
  second email path. Owners reset passwords; all sessions are revoked on reset.
- **`pg` driver** rather than Neon HTTP: the adapter wraps writes in interactive transactions.
- **Roles in `user_role`**, not in the session or a JWT claim, so deactivation and role changes take effect at once.

### Tests

| Suite | Result |
|---|---|
| `os` auth/authz/audit (`npm run test:auth`) | **60 passed / 0 failed** (new) |
| `os` database foundation (`npm run test:db`) | **61 passed / 0 failed** (13-table assertion added) |
| `os` `tsc --noEmit` strict | clean |
| `os` ESLint | clean |
| Root `npm test` (legacy + golden + Titan) | unchanged — see below |

Auth tests cover: config refusing a short secret or invalid base URL; policy pinned (≥12-char passwords, ≤5 sign-in
attempts, ≤12 h sessions); public sign-up disabled and no account created; bootstrap refusing short password, invalid
email, password containing the email name, and a second owner; exactly one OWNER role; password stored only as a hash;
bootstrap audited without the email; sign-in; `__Secure-kachmo.session_token` with HttpOnly/SameSite/Secure; password
never echoed; server-side session validation; actor roles/permissions from the database; tampered cookie and missing
cookie rejected; wrong password and unknown email indistinguishable (no account enumeration); sign-in rate limited per
IP (correct password also refused while limited) with counters in the database; untrusted origin rejected; deactivated
user cannot sign in and existing sessions resolve to no actor; no-roles user has zero permissions; INTERN denied
contacts/export/approve/suppression/outreach/user-management; role matrix, unknown roles granting nothing, OWNER-only
OWNER assignment, database role list identical to the code list, no send/force/bypass permission; audit redaction,
invalid action rejected, stored before/after free of contact values; no `NEXT_PUBLIC_` variable defined or read;
`server-only` on the auth instance and actor modules; no client component importing server auth/db/authz/audit; the
bootstrap never logging the password nor reading it from the environment.

### Risks
- Rate limiting trusts `x-forwarded-for`; correct on Vercel, wrong behind a proxy that lets clients set it.
- Two bootstrap processes run concurrently against an empty database could both create an owner (single-operator,
  one-time command; the second run is refused once a row exists).
- Owner password resets are not implemented yet (no UI until 1.4); until then an owner without a password must be
  re-bootstrapped on a fresh deployment.
