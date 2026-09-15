# Kachmo Outbound OS — Phase 0: Repository Audit & Architecture Assessment

> Date: 2026-09-15 · Scope: read-only audit. **No existing file was modified.** This document is the only file added.
> Repo audited: `Clients/mails` (git `main` = `origin/main` at `48cfbc0`, remote `github.com/cynox-66/kachmo-outreach`).
> Also read: `.agents/` (skills + rules, not in any git repo), `context/` (separate git repo), `kachmo-website/` (stack only).

---

## 1. Verdict

The V2 engine in `Clients/mails` is a real, hardened, well-tested **domain core** (8 gates, provenance, suppression, invariants, append-only events, 225 passing tests). It is worth preserving exactly and building the hosted product around.

It is **not** directly hostable. Every module is bound to the local filesystem and to `OUTREACH_TRACKER.md`/`scheduled-queue.json` living in git, and the email ledger is literally git-as-database written by a GitHub Actions bot. Moving to Vercel + Postgres forces decisions on (a) the email-ledger source of truth and (b) how suppression reaches the cron. Both touch the protected Titan boundary.

Four findings need a decision before Phase 1 starts (§9):

1. **A second, unguarded email send path exists.** `npm run send:titan` (`scripts/send-titan-smtp.ts`) has no suppression check, no already-sent check, and does not update the tracker. The approved 09-15 patch only covers `cron-dispatch.ts`.
2. **The research methodology exists in at least five conflicting versions** (4-gate, 5-gate, 8-gate prose, 8-gate code, "v2.3.0" digital-acquisition gate), with three different archetype taxonomies. You asked me to stop and ask, not silently pick one.
3. **The requested evidence taxonomy (VERIFIED / PARTIALLY VERIFIED / UNKNOWN / CONTRADICTED / DISQUALIFIED) does not match the implemented one** (PASS / UNVERIFIED / PENDING / UNKNOWN / FAIL). There is no CONTRADICTED concept anywhere.
4. **The documented architecture forbids this project** (ADR-001 "never build web dashboards", ADR-002 "Sheets over database", ADR-005 "$2.50/mo"). Vercel Hobby also prohibits commercial use. The ADRs need superseding, and the hosting cost needs accepting.

---

## 2. What exists: implemented vs. documented-only

### 2.1 Implemented and tested (`Clients/mails/scripts`, ~5,000 LOC TypeScript, run via `tsx`)

| Area | Module | State |
|---|---|---|
| Canonical lead schema | `lib/schema.ts` (`KachmoLead`, 133 fields in data) | Real |
| Storage | `lib/store.ts` + `lib/safe-io.ts`: strict load, concurrent-modification guard, invariant check, shrink guard, backup-on-save (30 kept), atomic fsync+rename | Real, single-machine only |
| Invariants | `lib/invariants.ts`: e.g. PUBLICLY_LISTED requires URL, VERIFIED requires basis, WON requires proposal, DNC requires DISQUALIFIED | Real, enforced on every save |
| Contact provenance + suppression | `lib/contact.ts`: `phoneEligibility`, `emailRoute` (generic/no-contact/freemail classes), `whatsappEligibility`, `checkSuppression` (lead_id/target/email/phone-last-10/domain), `outreachBlock` (single block check) | Real |
| 8-gate qualification | `leads-qualify.ts` → `evaluateLeadGates()` (pure) | Real |
| Research completeness | inside `evaluateLeadGates()` (weighted, sourced = full credit, unsourced = half) | Real |
| Heuristic score + priority | `leads-score.ts` → `calculateLeadScores()` (regex signal categories, unknown dims excluded, PROVISIONAL < 60% completeness) | Real, labelled HEURISTIC |
| Opportunity / channel / next action | `leads-opportunity.ts` (archetype scope defaults, channel strategy, OUTREACH_READY, deterministic `next_action`) | Real |
| Research queue | `leads-research-queue.ts` → `taskFor()` per missing field, with evidence requirements | Real |
| Research recording | `leads-record.ts` (provenance rules per field; the only human research input path) | Real, CLI only |
| Dedupe | `leads-dedupe.ts` (flag only, never delete/merge) | Real |
| Calling | `queue-calls.ts` (`callEligibility`: 3 unanswered max, 20h spacing, terminal outcomes), `call-log.ts` | Real |
| WhatsApp | `queue-whatsapp.ts`, `whatsapp-log.ts` (APPROVED → SENT, no duplicate SENT, human send via wa.me) | Real |
| Pipeline | `pipeline-log.ts` (meeting → proposal → won/lost ordering, single-bump follow-up) | Real |
| Suppression CLI | `suppress-add.ts` (+ warns if still in production queue) | Real |
| Email boundary (read-only) | `lib/email-state.ts` (`parseTracker`, `readScheduledQueue`, behind-origin check), `email-queue-check.ts` | Real |
| War room / analytics | `war-room.ts`, `analytics-weekly.ts` (n<20 shown as raw k/n; no probabilities) | Real |
| Migration | `migrate-csv-to-leads.ts` (refuses re-run without `--force`; preserves lead_ids and human data) | Real |
| Event log | `analytics/events.jsonl` append-only, no contact values in payloads | Real (not an audit log: actor is `DEV/AADI/SYSTEM`, no before/after) |
| Tests | `scripts/__tests__/run-tests.ts`: 24 groups, **225 passed / 0 failed** (run today), temp workspaces, one read-only group over real data | Real, custom runner, not in CI |

### 2.2 Production Titan email subsystem (protected)

| File | Behaviour | Guarded? |
|---|---|---|
| `scripts/cron-dispatch.ts` + `.github/workflows/outreach-dispatch.yml` | Reads committed `scheduled-queue.json`, local-morning window, SMTP send, rewrites tracker row → SENT, bot commits + pushes | **Yes**: suppression (email/domain/target, fail-closed) and already-sent checks run before the window, so `--force` cannot bypass them |
| `scripts/send-titan-smtp.ts` (`npm run send:titan`) | Sends a JSON payload (arg/file/stdin) immediately; LOW confidence → IMAP Drafts | **No**: no suppression, no tracker read, no already-sent check, no tracker update (0 occurrences of "suppress"). Also a latent `ReferenceError: dayOfWeek` at line 305 on the outside-window path (strict `tsc` error) |
| `scripts/create-titan-drafts.ts` | Reads `kachmo_targets.csv` directly and writes Titan Drafts; `--fresh` clears the Drafts folder | No suppression (drafts only, not sends) |
| Both SMTP transports | `tls: { rejectUnauthorized: false }` | Credentials sent over a connection that accepts any certificate |
| Workflow | `git push` without `pull --rebase`: a push during a run can cause a re-send (documented in `RECONCILIATION_AND_CRON_PATCH.md`) | Open |

`OUTREACH_TRACKER.md` (markdown tables) is the **authoritative email ledger**. `lead_state` in `kachmo_leads.json` is a stale mirror from migration time and must never drive email decisions.

### 2.3 Documented but NOT implemented on this machine

| Document | Claims | Reality |
|---|---|---|
| `docs/START_HERE.md`, `ARCHITECTURE.md`, `DISCOVERY_AND_QUALIFICATION.md`, `AI_SYSTEM.md`, `DATA.md`, ADR-001…008 | "Lead Engine v1": Gemini grounded discovery, Playwright audit, **4-gate** tree, 0–10 priority, Google Sheets CRM | Code lives in `Clients/reachout/`, which **does not exist** anywhere on disk. None of it is in this repo. |
| `docs/LEAD_ENGINE_V2_MILESTONES.md`, `context/05`, `context/07` | "v2.3.0 production verified, 379 tests": Track B zero-presence, HN intent parser, Companies House ingestion, digital-acquisition Gate 1, $2.00/$2.50 breaker | No such code here. `context/07` is stale on this. |
| `docs/LEAD_ENGINE_OVERHAUL.md` | Execution brief for `src/discover/query-builder.ts`, `src/evaluate/prompts.ts` | Targets the missing repo |
| `.agents/skills/kachmo-client-research` "Mode B Deep Research Refill Brief" | Generates a Deep Research prompt with a dedupe blacklist | Prose instruction to an IDE agent only; no generator, no import path (output was pasted into the CSV by hand) |
| Same skill §5 "Continuous learning" (allocation %, win-signal reweighting) | Adaptive archetype weights | Prose only; no data exists yet (0 replies, 0 meetings, 0 wins) |
| `.agents/skills/founder-review` | "HIGH confidence → send directly via SMTP. No human review needed." | Conflicts with ADR-008 (no autonomous outreach) and your human-approval principle. It is the likely origin of the unguarded `send:titan` path. |
| `OUTREACH_TRACKER.md` header | "40 emails/day cadence" | The 09-14 audit recommended removing it as off-brand |

### 2.4 The data today (read-only counts, no contact values printed)

- **120 leads** (target 001–120), 788 KB. Archetypes: 1: 35 · 2: 30 · 3: 15 · 4: 15 · 5: 15 · 6: 10.
- research_state: RESEARCH_REQUIRED 107 · QUALIFIED 10 · OUTREACH_READY 3 · DISQUALIFIED 0.
- priority: A+ 2 · A 18 · B 80 · C 20, and **all 120 PROVISIONAL**.
- **`research_sources` is empty on all 120 leads.** Completeness is 20–39% everywhere. `kachmo_fit_confirmed_by` is null on all 120.
- phone: UNVERIFIED 18 / UNKNOWN 102 (0 callable) · email: UNVERIFIED 60 / UNKNOWN 60.
- Suppression list: 0 entries. Events: 240 lines. Scheduled queue: 5 (101–105). Tracker: 20 SENT, 10 SCHEDULED, 18 DRAFTED (DB mirror).
- The working tree has uncommitted regenerations of derived queue/markdown files (not mine; untouched).

**Consequence for the UI:** an honest dashboard will show that almost nothing is evidenced yet. The 13 "qualified" leads are qualified on unsourced legacy claims, which the engine allows by design (UNVERIFIED does not block). The UI must say this plainly rather than render "Qualified ✓".

---

## 3. Conflicts that need your decision (stop-and-ask items)

### 3.1 Qualification methodology: five versions

| Version | Where | Gates | Missing / weak evidence handling |
|---|---|---|---|
| A. Lead Engine v1 | `docs/DISCOVERY_AND_QUALIFICATION.md` | 4: Fit → Commercial → Need → Reach | Binary reject |
| B. "v2.3.0" | `docs/LEAD_ENGINE_V2_MILESTONES.md`, `context/05` | v1 + mandatory digital-acquisition signal; ≥15 yrs / ≥50 staff → medium fit, never emailed (except white-label partners) | Reject |
| C. 5-gate protocol | `kachmo-client-research/SKILL.md` §2 (first) | Named DM, direct email, proof, digital gap, city/TZ | **"Fail one gate → discard"** |
| D. 8-gate prose | same SKILL §2 (second) + India adaptations §1a | 8 gates | `support@` → **DISQUALIFIED**; no friction → **FAIL**; A+ requires completeness ≥ 65, else capped at A; DISQUALIFIED if gate 1/2/4/8 fails |
| E. 8-gate code (V2, hardened 09-14) | `leads-qualify.ts`, `leads-score.ts` | 8 gates | Missing data is **never** FAIL (PENDING/UNKNOWN); `support@` → PENDING; A+ **not capped**, labelled PROVISIONAL instead; FAIL only on sourced LOW budget, human fit rejection, or outreach block |

D and E disagree on exactly the rules you said must not change silently. The 09-14 audit changed D → E deliberately (bugs #12–#14) and recorded why, but the SKILL prose was never updated.

The **India adaptations in D §1a** (WhatsApp as valid Gate 2, Google reviews ≥ 4.0 with 50+ as proof, IndiaMART/JustDial listings as DM sources) are **not implemented in E**. E has one Gate 2 rule for all geographies.

**Recommendation:** freeze **E (the running, tested code) as Methodology v1.0**, byte-for-byte in behaviour. Record every D-vs-E difference (including the India adaptations and B's digital-acquisition gate) as a *proposed* v1.1 changelog for you to accept or reject rule by rule. Nothing changes behaviour until you approve a version.

### 3.2 Archetype taxonomy: three versions, plus label drift in the data

- SKILL: **6** archetypes (1 White-Label Agency Partner, 2 Funded Startup, 3 Interactive Craft & Storytelling, 4 High-Ticket Services, 5 Zero-Presence Greenfield, 6 Indian Business Digitization with 45 verticals).
- `LEAD_ENGINE_OVERHAUL.md`: **4** (1 High-Ticket Boutique, 2 Funded Startups, 3 Design Studios as partners, 4 Small Local).
- `KACHMO_ALIGNMENT.md`: **3** (High-Ticket Boutiques, Funded Startups, White-Label Studios).
- Data labels: `"2: Startup Craft Upgrade"` ×25 vs `"2: Funded Startup"` ×5; `"3: Interactive System"`; `"4: Workflow/Booking Overhaul"`; archetype 6 labels carry the vertical.
- The 09-14 audit recommended **retiring Arch-5** (Companies House micro-businesses: no public contacts, below price band, UK GDPR concern with registry personal data).

**Recommendation:** adopt the SKILL's 6-archetype IDs as the canonical keys (they match `archetype_id` in the data, so no lead changes). Split *archetype* from *vertical* (Arch-6's 45 verticals, and verticals inside Arch-3/4). Normalise labels in a mapping table, never by rewriting lead records. Mark Arch-5 `PAUSED` pending your call.

### 3.3 Evidence / verification vocabulary

| You asked for | Implemented today | Proposed mapping (display only; storage enums unchanged) |
|---|---|---|
| VERIFIED | Gate `PASS` (sourced URL, or human confirmation for fit) | VERIFIED means "sourced". The UI must say *"source recorded"*, not *"confirmed true"*, because `isUrl()` only checks URL shape. |
| PARTIALLY VERIFIED | `UNVERIFIED` (claim on file, no source) | "Claimed, unsourced" |
| UNKNOWN | `PENDING` (required, missing) and `UNKNOWN` (optional, not researched) | Keep both distinctions visible: "Missing (required)" vs "Not researched (optional)" |
| CONTRADICTED | **Does not exist** | **New, additive:** an evidence item conflicting with another item or the lead value. It must not change gate outcomes in v1.0; it blocks import approval and flags the lead. Changing gate semantics would be a v1.1 methodology decision. |
| DISQUALIFIED | `FAIL` / research_state DISQUALIFIED | Same |

The contact provenance you proposed (`verified_public`, `verified_company_source`, `verified_research_source`, …) is finer than the implemented `UNKNOWN · INFERRED · UNVERIFIED · PUBLICLY_LISTED · VERIFIED · INVALID`. **Recommendation:** keep the implemented enum (the invariants and tests depend on it) and add a `source_type` on the evidence record (`company_site`, `google_business_profile`, `directory`, `registry`, `press`, `external_research_report`, `ide_agent`, `call`). This gives the finer distinction without breaking Gate 2.

### 3.4 A hole the import pipeline would open (must be designed out)

Gates award PASS to any string that *looks* like a URL. An LLM research report can fabricate plausible URLs, so a naïve importer would turn fabricated sources into PASS gates. That is exactly "LLM confidence treated as evidence".

**Recommendation (no engine change):** externally supplied source URLs are stored as evidence with `origin = EXTERNAL_RESEARCH` and `review_status = UNREVIEWED`. The adapter that maps a candidate into `KachmoLead` fields writes a URL into `*_source` **only after** a reviewer ticks that evidence item as checked. Until then the claim goes in with a null source, so the engine correctly computes UNVERIFIED. An optional server-side HTTP reachability check can be shown as a hint but never counts as verification.

---

## 4. Architecture constraints discovered

| # | Constraint | Impact |
|---|---|---|
| C1 | All domain modules call `loadLeads()/saveLeads()` on `process.cwd()` files and use sync `fs` | Cannot run on Vercel (read-only, ephemeral FS). Pure functions must be extracted from the I/O. |
| C2 | Several "pure" functions live in CLI entry files (`evaluateLeadGates` in `leads-qualify.ts`, `calculateLeadScores` in `leads-score.ts`, `taskFor`, `callEligibility`, `findDuplicates`) that import `store.ts` at module load | Extraction is a refactor. Correctness is proven by a golden test: identical output over the 120 real leads before and after. |
| C3 | The email ledger is `OUTREACH_TRACKER.md` in git, written by the cron bot | The hosted app cannot see live email state unless it reads `origin/main` via the GitHub API. This conflicts with "no git as live DB", but git **is** Titan's DB today. |
| C4 | The cron reads suppression from the **committed** `database/suppression.json` | If suppression moves to Postgres, new opt-outs never reach the cron: a suppression bypass through architecture. Needs a decision (§9 D4). |
| C5 | `target_number` is a 3-digit string; `findLead` pads `/^\d{1,3}$/`; the tracker regex matches `\*\*(\d{3})\*\*` | Breaks at lead #1000. The hosted system keys on `lead_id` (UUID). `target_number` stays a unique legacy label; the tracker parser is untouched until Titan changes. |
| C6 | `Actor = 'DEV' \| 'AADI' \| 'SYSTEM'`; `owner: 'DEV' \| 'AADI'`; the CLI `--by` flag is trusted | Multi-user needs user IDs. Existing events map `DEV`/`AADI` → the two owner accounts at migration. |
| C7 | Whole-file load/save; no locking across machines (documented) | Two operators already risk divergence. Postgres with optimistic concurrency (`version` column) replaces this. |
| C8 | No `tsconfig.json`, no lint, tests not in CI | Add for the new code; leave existing scripts' runtime untouched. |
| C9 | Repo contains named people's emails/phones (`kachmo_targets.csv`, `database/kachmo_leads.json`, tracker) and the remote visibility could not be checked (`gh` not installed) | **Confirm the GitHub repo is private.** DPDP Act 2023 / UK GDPR apply (09-14 audit). |
| C10 | Vercel: 4.5 MB function request body; no persistent disk; function time limits | Uploads go direct to private object storage (e.g. Vercel Blob, private) with size caps; parsing runs server-side with limits. |
| C11 | Vercel **Hobby is non-commercial only**; ADR-005 caps infra at $2.50/mo | Pro plan (~$20/user/mo) plus Postgres. ADR-001/002/005 need a superseding ADR. |

---

## 5. Target architecture (proposed)

### 5.1 Principle: one domain core, many adapters

```
                    ┌──────────────────────────── core/ (pure TS, no I/O) ───────────────────────────┐
                    │ methodology/  (versioned config: gates, archetypes, verticals, exclusions,       │
                    │                evidence rules, output schemas)                                   │
                    │ qualification (evaluateLeadGates — moved, unchanged)                             │
                    │ scoring       (calculateLeadScores — moved, unchanged)                           │
                    │ contact       (provenance, eligibility, suppression match, outreachBlock)        │
                    │ invariants · research-tasks (taskFor) · call-eligibility · dedupe                │
                    │ opportunity/next-action · email-ledger parser · inventory · prompt-builder       │
                    │ import: normalize → dedupe → contradiction detect → map-to-lead (no writes)     │
                    └───────────────▲───────────────────────────────▲────────────────────────────────┘
                                    │                               │
               scripts/ (existing CLIs, same commands)      os/ (Next.js App Router on Vercel)
               JsonFileRepository                           server/services/*  (LeadService, ResearchService,
               (kept until cutover)                           QualificationService, SuppressionService, …)
                                                             PostgresRepository · AuthZ · AuditService
                                                             app/ + features/ (UI calls services only)
```

- **No second implementation.** CLI, UI, upload import, IDE API and manual entry all call the same `core` functions through services.
- **UI holds no business rules.** Components render service results (gates, missing list, reasons, next action), never compute them.
- **Titan stays outside.** `os/` has a read-only `EmailLedgerService` over `origin/main` (GitHub contents API, read-only token) until you approve a Titan change.

### 5.2 Proposed repo layout (inside `kachmo-outreach`, root CI untouched)

```
Clients/mails/
  core/              NEW  extracted pure domain + methodology versions (JSON/TS config)
  scripts/           EXISTING  CLIs re-point imports to core/ (behaviour-identical); Titan files untouched
  os/                NEW  Next.js app, own package.json, Vercel "Root Directory" = os
    app/  features/  server/{auth,authz,audit,db,services,repositories}  components/
  db/migrations/     NEW  SQL migrations (Drizzle-generated, reviewed)
  docs/adr/ADR-009…  NEW  supersede ADR-001/002/005 when you approve
```

The root `package.json`, lockfile and workflow stay unchanged, so the cron's `npm install` and `npx tsx scripts/cron-dispatch.ts` behave exactly as now.

### 5.3 Stack (recommendation; see D2)

| Concern | Recommendation | Why |
|---|---|---|
| App | Next.js App Router + TypeScript (matches `kachmo-website`: Next 16 / React 19) | You asked for it; same team skills |
| DB | Postgres on Neon via the Vercel Marketplace (branching = safe migration rehearsals on a copy) | Branch-per-rehearsal fits §33 |
| ORM | Drizzle (parameterised queries, SQL-first migrations you can review) | No hidden migrations |
| Auth | Better Auth (sessions in our Postgres, invite-only, scrypt/argon2 hashing, rate limiting, TOTP 2FA), or Clerk if you prefer managed | Keeps users/roles/audit in one DB; no shared password |
| Uploads | Private object storage, signed server-side access, size/type caps | Never public, never executed |
| LLM extraction | Optional, Phase 2, Claude via API, JSON-schema output treated as untrusted candidates | Deterministic JSON/CSV import first |

### 5.4 Database schema (high level)

Identity and access
- `users`, `sessions`, `accounts`, `verification` (auth library tables)
- `invitations` (email, role, invited_by, expires_at, accepted_at)
- `user_roles` (user_id, role); roles → permissions defined in versioned code, **checked server-side on every action**

Leads (lossless migration, IDs preserved)
- `leads`: `lead_id uuid PK` (existing value), `target_number text UNIQUE`, typed columns for every field the core reads, `record jsonb` (full original `KachmoLead` for lossless round-trip), `version int` (optimistic lock), `created_at` / `updated_at` (original values)
- `lead_evidence`: id, lead_id, field, claim_value, source_url, source_type, observed_at (nullable, never invented), recorded_at, recorded_by, origin (`LEGACY_CSV | HUMAN_RECORD | EXTERNAL_RESEARCH | IDE_AGENT | CALL`), review_status (`UNREVIEWED | CHECKED | REJECTED`), contradiction_of (nullable), import_candidate_id
- `qualification_runs` / `score_runs` (append-only): lead_id, methodology_version, engine_git_sha, input_hash, gates, missing, completeness, state, reasons, signals, computed_at
- `call_attempts`, `whatsapp_events`, `pipeline_events` (append-only, mirroring the CLI state machines)
- `suppression_entries`: append-only; lifting = `revoked_at` + `revoked_by` + reason (never deleted)

Research
- `methodology_versions`: semver, status (`DRAFT | ACTIVE | RETIRED`), config jsonb, changelog, created_by, activated_at; **immutable once ACTIVE**
- `research_missions`: methodology_version_id, archetype, vertical, geography, quantity, config snapshot, rendered prompt snapshot, output schema version, channel (`EXTERNAL_TOOL | IDE`), created_by, status
- `research_imports`: mission_id, source (`UPLOAD | IDE_API | MANUAL`), file key, sha256, mime (sniffed), size, parser, status, created_by
- `import_candidates`: raw jsonb, normalized jsonb, dedupe_matches, contradictions, preview_gates (computed, not persisted to the lead), review_status (`PENDING | APPROVED | REJECTED | NEEDS_RESEARCH | MERGED`), reviewer, resulting_lead_id

Operations
- `inventory_targets`: archetype, vertical, geography, target_count, low_threshold, updated_by (all configurable, no hardcoded thresholds)
- `api_clients`: hashed token, scopes, created_by, last_used_at, revoked_at (IDE sync)
- `email_ledger_snapshots`: parsed tracker rows + scheduled queue fetched from `origin/main`, with commit sha (read-only mirror)
- `audit_events`: append-only (app DB role has INSERT/SELECT only), actor user_id, action, target, before/after (contact values redacted), request id, ip hash, at
- `analytics_events`: `events.jsonl` migrated as-is

### 5.5 Authorization model

Permissions as listed in the brief (`lead.view … methodology.manage`) plus `lead.view_contacts` (raw phone/email), `email.view_ledger`, `api_clients.manage`.

| Role | Default grants |
|---|---|
| OWNER (Dev, Aadi) | all |
| ADMIN | all except `users.manage` of owners, `methodology.manage` |
| RESEARCHER | lead.view, research.create/upload, evidence recording; no approve, no suppression lifting, no export |
| OUTREACH | lead.view(+contacts), outreach.call/whatsapp, pipeline logging, suppression.create |
| INTERN | lead.view (contacts masked), research.create/upload; nothing that approves, contacts, exports or suppresses |
| VIEWER | lead.view (masked), analytics.view |

Enforcement: middleware only redirects to login. Every server action and route handler calls `authorize(session, permission)` itself, and roles are loaded from the DB, never from the client.

### 5.6 Import pipeline (Phase 2), reusing the core

```
upload/IDE POST → store privately (sha256, sniffed type, size cap) → parse (JSON/CSV deterministic;
PDF/MD/TXT/DOCX text extraction; optional LLM → schema-validated candidates) → normalize (domain, phone key,
geo, archetype map) → dedupe (core.findDuplicates vs leads + other candidates) → contradiction detect →
map-to-lead with UNREVIEWED sources nulled (§3.4) → core.evaluateLeadGates + calculateLeadScores (preview only)
→ review queue → human APPROVE/REJECT/NEEDS_RESEARCH/MERGE/EDIT → LeadService.create/merge (invariants,
audit, qualification_run) → canonical DB
```

Nothing reaches `leads` without a human approval event with `lead.approve`.

### 5.7 Research prompt engine (Phase 2)

Built from `methodology_versions.config`, not a string template: per-archetype ideal profile, vertical registry, required gates and the exact evidence each needs (reusing `taskFor` evidence text), exclusions (competitor agencies, >50 staff, directories, SEO-nit signals as primary), acceptable vs unacceptable sources, the contradiction/unknown rules ("UNKNOWN is valid; NO_CLEAR_TRIGGER is valid; never pattern-guess emails"), a dedupe blacklist (existing domains/company names, generated at mission time and snapshotted), and the output JSON Schema. Every mission stores the rendered prompt so historical research stays attributable.

### 5.8 Titan boundary in the hosted system

- Phase 1: read-only. The Email tab shows tracker state and scheduled queue **from `origin/main`** with its commit sha and age. There are no send, schedule or queue-edit controls. `--force` has no UI equivalent.
- Suppression added in the app must reach the cron (D4). Until that path exists, the app must show a blocking banner whenever a suppressed recipient appears in the scheduled queue (same logic as `email-queue-check.ts`, via core).

---

## 6. Migration plan (JSON → Postgres), no destructive steps

1. Snapshot git sha plus sha256 of every data file and protected file (`npm run audit:baseline` already exists).
2. Export: copy `database/`, `analytics/`, `queues/`, tracker and CSV into a timestamped backup outside the repo.
3. Create a Neon **branch** (a copy); run SQL migrations there only.
4. Load: leads (`record` jsonb + typed columns; `lead_id`, `created_at`, `updated_at` preserved), events, suppression, call attempts (unnested from leads, keeping originals in `record`).
5. Verify on the branch, all must pass:
   - count(leads) = 120; set(lead_id) and set(target_number) identical
   - per-lead canonical-JSON hash of `record` equals source
   - Re-run `core.evaluateLeadGates` + `calculateLeadScores` on DB-loaded leads: zero diffs vs JSON-loaded results
   - `findInvariantViolations` = 0; suppression entries identical; events line count and ids identical
   - Tracker statuses parsed from `origin/main` match the war-room view
6. Rehearse twice (fresh branch each time), then load production.
7. **Single-writer cutover:** from the moment the app accepts writes, CLI writers (`leads:record`, `calls:log`, `whatsapp:log`, `pipeline:log`, `suppress:add`, `leads:refresh`) either switch to `PostgresRepository` or are disabled with a message. Two writable stores would diverge.
8. JSON files stay in the repo, read-only, as the archived pre-cutover state. Nothing is deleted.

---

## 7. Security model summary (build-in, not bolt-on)

Server-side authz on every mutation · DB sessions, `HttpOnly; Secure; SameSite=Lax` cookies · CSRF (Server Actions origin check plus token for route handlers) · zod validation on every input · Drizzle parameterised SQL · rate limits on auth, upload and the IDE API · CSP, HSTS, `X-Content-Type-Options`, `frame-ancestors 'none'` · uploads: size cap, magic-byte sniffing, random storage keys (never user filenames), private bucket, text extraction only, no macro/script execution, no previews served as HTML · no secrets in client bundles (`server-only` imports) · IDE API: scoped hashed bearer tokens, revocable, audited · exports gated by `lead.export` and audited · contact values masked by default and never written into audit/analytics payloads.

---

## 8. Phase plan (refined)

**Phase 1.0: Core extraction (no behaviour change)**
Move pure functions to `core/`. The CLIs import from `core/`. Add a golden test over real lead data (read-only, temp copy) proving identical gates, scores, tasks and queues. The 225 existing tests must still pass. Add `tsconfig` for `core/` and `os/`.

**Phase 1.1: App foundation**
Next.js app, auth (invite-only, 2FA for OWNER/ADMIN), RBAC, audit service, security headers, CI (typecheck, lint, tests, build).

**Phase 1.2: Database + migration rehearsal** (§6), with no production writes.

**Phase 1.3: Read surfaces**
Dashboard ("what needs attention": follow-ups due, research next, queue health, stale-ledger alerts), lead table (search/filter/saved views/pagination), lead detail (overview · qualification with real gate reasons · evidence · contacts with provenance · research tasks · outreach · calls · WhatsApp · pipeline · activity · audit), "Why this lead?" built strictly from gates, missing list, signals and evidence rows, and a read-only Email ledger.

**Phase 1.4: Write surfaces via services**
Record research (the `leads:record` rules), call logging (`callEligibility` visible before dialling), WhatsApp approve/sent/replied/opt-out, pipeline stages, suppression add (propagation per D4). Each writes an audit event, re-runs qualification and stores a `qualification_run`.

**Phase 1.5: Cutover** (single writer).

Phases 2–5 as in your brief, with §3.4 and §5.6–5.7 as the design constraints.

---

## 9. Decisions required before Phase 1

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D1** | Canonical methodology v1.0 | E (running code) · D (SKILL 8-gate prose) · merge | **E frozen as v1.0**; D/B/India differences listed as a v1.1 proposal for rule-by-rule approval |
| **D2** | Stack & cost | Neon + Drizzle + Better Auth on Vercel Pro · Supabase (DB+Auth) · Clerk + Neon | **Neon + Drizzle + Better Auth**, Vercel Pro (Hobby is non-commercial). Supersede ADR-001/002/005. |
| **D3** | Unguarded `send:titan` path | (a) add the same fail-closed suppression + already-sent guard as the cron (protected-file change, ~25 lines) · (b) disable the npm script · (c) leave as-is | **(a)**, plus fix the `dayOfWeek` crash and remove `rejectUnauthorized:false` from both transports. Separate approval, separate commit. |
| **D4** | How app-side suppression reaches the cron | (a) app commits `database/suppression.json` to `origin/main` via GitHub API on every change (fail-closed, audited) · (b) patch the cron to fetch suppression from the app API (fails closed = no sends if app down) · (c) both | **(a) in Phase 1** (no Titan code change); revisit (b) when Titan state moves to Postgres |
| **D5** | Email ledger source for the app | read `origin/main` via GitHub API (read-only token) · local copy upload · none in Phase 1 | **GitHub API read-only** |
| **D6** | Where the app lives | `os/` inside `kachmo-outreach` (root CI untouched) · a new repo importing `core` as a package | **`os/` in the same repo** so `core/` is shared without publishing |
| **D7** | Archetypes | SKILL 6 (+vertical split, Arch-5 paused) · Overhaul 4 · Alignment 3 | **SKILL 6 IDs as keys**, verticals separate, **Arch-5 paused** |
| **D8** | CONTRADICTED semantics | display/import-blocking only in v1.0 · affects gates (v1.1) | **Additive only in v1.0** |
| **D9** | LLM extraction in Phase 2 | deterministic JSON/CSV only · plus optional Claude extraction for PDF/prose | **Both, LLM behind a flag**; outputs are untrusted candidates |
| **D10** | Repo visibility / PII | confirm `cynox-66/kachmo-outreach` is private | Must be private before any further data is committed |
| **D11** | `founder-review` "send directly, no human review" | retire that clause · keep | **Retire.** It contradicts ADR-008 and the human-approval rule. |

---

## 10. Known risks

- The heuristic score rewards dense research copy, not proven quality (already labelled). Showing a 0–100 number invites false precision, so the tier plus matched signals should be shown instead.
- With 0 sourced evidence on file, the first hosted views will look "empty". That is correct; faking it is not an option.
- Inventory intelligence and research-yield recommendations have **no historical data** (no missions were ever recorded). Until missions accumulate, Phase 3 can show counts and deficits only, not yield-based recommendations.
- The cron push race (duplicate send) remains until the workflow gets `pull --rebase` (protected).
- Dual-store divergence risk between Phase 1.3 and the 1.5 cutover; mitigated by keeping the app read-only until cutover.
- Legal: DPDP Act 2023 / UK GDPR for prospect personal data, WhatsApp Business terms. Needs proper advice before adding staff/interns with data access.

## 11. Files changed in Phase 0

- Added: `audit/OUTBOUND_OS_PHASE0_ASSESSMENT_2026-09-15.md` (this file). Nothing else was created, modified, committed or pushed.
- Commands run: `npm test` (225/225 pass, temp workspaces), strict `tsc --noEmit` (1 pre-existing error in protected `send-titan-smtp.ts:305`), read-only `node` count queries over the data.
