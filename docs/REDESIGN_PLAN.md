# Outbound OS — Redesign and Hardening Plan

> **Status:** Executed 2026-09-22 (see §7 for the verification record)
> **Inputs:** [`audit/PRODUCTION_AUDIT_2026-09-22.md`](../audit/PRODUCTION_AUDIT_2026-09-22.md),
> [`OPERATOR_EXPERIENCE.md`](OPERATOR_EXPERIENCE.md), [`DESIGN_LANGUAGE.md`](DESIGN_LANGUAGE.md)
> **Decisions:** ADR-035 (operator surfaces), ADR-036 (sender health is derived, read-only)

## 1. Boundaries this plan does not cross

- No change to `core/` (Methodology v1.0 is golden-pinned; both goldens stay byte-identical).
- No change to Titan-protected files (`cron-dispatch.ts`, `send-titan-smtp.ts`, `create-titan-drafts.ts`,
  `outreach-dispatch.yml`, `scheduled-queue.json`, `OUTREACH_TRACKER.md`, `kachmo_targets.csv`, `.env`, batches).
- No database migration, and no production read or write. Verification runs in an isolated worktree with no
  `.env.local` against a loopback Postgres.
- No new send path, no new permission, no new runtime dependency.
- Routes keep their paths.

## 2. Architecture of the change

```
app/(app)/*            pages: one request-scoped snapshot, passed to every service; no engine logic
app/(app)/components   Plate, Status, Claim, NavLink (client), RecordPanel (client), EmailPreview, …
server/services/
  operator.ts   NEW  pure translation: engine/ledger state → operator status, sentences, labels, claim marks
  sender.ts     NEW  email-sender health from data the app already has (queue, ledger, preflight, artifact)
  snapshot.ts   NEW  request-scoped canonical snapshot and actor (React cache)
  presentation.ts    one gate-label table (from leads.ts); plain labels
server/repo/titan-ledger.ts   + read-only queue preview (subject, plain text), raw bytes for the pure preflight
server/leads/actions.ts, research/actions.ts, evidence/actions.ts
                       guarded(): session/permission/infrastructure failures become form messages
server/db/client.ts    bounded connect and query timeouts
```

`operator.ts` is presentation only: it labels values core already computed and never decides eligibility. It is unit
tested against core's own value sets so a new engine value cannot silently render as a raw enum.

## 3. Sequence

| Step | What | Findings | Reversible by |
| :-: | :-- | :-- | :-- |
| 1 | Documentation: audit, operator experience, design language, this plan, ADR-035/036 | — | — |
| 2 | Correctness and resilience: gate labels, UUID guards, action error handling, error/not-found/loading boundaries, pool timeouts, revalidation paths, request-scoped snapshot, layout without DB | D1, C5, C6, E1–E3 | code revert |
| 3 | Truthfulness: claim verification marks; planned vs sent; queue preview; sender status; as-of time; plain history with ledger events | B1–B2, A1–A5, D4 | code revert |
| 4 | Human-error safety: empty defaults, one form at a time, consequence text, confirmation for do-not-contact and approval, post-success confirmation, stop warnings, refusal translation | C1–C4 | code revert |
| 5 | Visual system: Kachmo tokens, self-hosted Cinzel, components; all pages restyled through the shared vocabulary | — | code revert |
| 6 | Page redesigns: Today, Companies, company page, Emails, then copy passes on Calls, WhatsApp, Research, Pipeline and the System pages | D2, D3, D5, D6 | code revert |
| 7 | Hardening: maintenance workflow inputs through `env:` | A7 | code revert |
| 8 | Verification (§6) | — | — |

Each step keeps root and os suites, typecheck, lint and build green before the next begins.

## 4. What an owner must decide (not done here)

1. **A1 — the dispatcher schedule.** Change `outreach-dispatch.yml`'s cron to off-peak minutes spanning the windows,
   and make a run fail when a queued entry is past its plan (audit §1 gives concrete lines). Then re-review the
   five held emails.
2. **A5 — email state freshness.** Choose between reading the ledger from GitHub at request time and publishing
   ledger rows to Postgres.
3. **A6/A8** in the next reviewed commit to the dispatch workflow and pause marker.
4. **F1** — point `os/.env.local` at a Neon development branch, or extend `writeRefusal`'s host rule to research writes.
5. **B3** — how to import candidates approved before cutover (none exist in production today).
6. The pre-existing production steps from the Phase B runbook remain: bind people (`actor:bind`), run
   `leads:reevaluate`, and switch writes on (`KACHMO_APP_WRITES`, `KACHMO_APP_WRITES_HOST`).

## 5. Tests added

| Suite | New assertions |
| :-- | :-- |
| `tests/operator.ts` (new, in `npm test`) | gate-label table equals core's gate keys exactly; every research state, provenance, gate outcome, evidence level, ledger status and pipeline stage has an operator label (no raw enum can reach the UI); operator status covers the blocked / replied / emailed / scheduled / ready / research cases; an `UNVERIFIED` claim is never marked checked; planned vs sent dates; Today sentences carry no file names or field names; refusal translation removes CLI flags; the sender-status service flags the stuck queue and the whole-run hold (reproduced from A1/A2 against the committed data); queue preview masks recipients for roles without contact access; UUID guard refuses malformed ids; guarded actions convert expired sessions and database failures into form messages without throwing |
| `tests/shell.ts` (extended) | every route group has error, not-found and loading boundaries; the layout makes no database call; no operator page shows an environment variable name or a CLI command; no form offers a consequential default; destructive choices are behind a confirmation |
| `tests/app.ts` (kept green) | existing boundaries unchanged |

## 6. Verification

**Automated:** root `npm test`, `os npm test`, `npm run typecheck` (root and os), `os npm run lint`,
`os npm run build`, `test:concurrency` if its loopback Postgres is available, protected-file hashes before and after,
and both goldens byte-identical.

**In the browser** (isolated worktree, loopback Postgres seeded with the committed 120 leads, local owner and
outreach users, writes on for the loopback target only):

| Workflow | Checks |
| :-- | :-- |
| Operator | open → understand Today → find a company → why it's relevant → the contact → the scheduled email → record a reply → see the result in History → open Details |
| Suppressed company | stop banner; call form labelled; queue hold shown after opt-out |
| Revoked suppression | a revoked entry no longer blocks (read layer and write path use active entries only) |
| Duplicate company | duplicates listed under Details, candidate approval refused for a high-confidence duplicate |
| Duplicate outreach | second submit after success needs "Record another"; stale version refused |
| Missing contact | "No usable contact route" in words; no call or WhatsApp action offered |
| Stale research | unverified marks; "source changed" state for evidence |
| Failed request / database | stop the database mid-session → error state, nothing lost, honest message |
| Malformed data | non-UUID ids → not found; hand-crafted form values → refused |
| Unauthorized mutation | outreach role posting a research-approval action → refused, audited |
| Stale browser state | two tabs, write in one, submit in the other → refused with reload guidance |
| Repeated clicks / refresh during an operation | pending state disables the button; refresh re-renders the recorded state |

## 7. Execution record

**Automated — all green, on the working tree as delivered.**

| Suite | Assertions | Suite | Assertions |
| :-- | --: | :-- | --: |
| core `test` | 225 | os `app` | 135 |
| core `golden` | 42 | os `suppression` | 127 |
| core `write-path` | 11 | os `historical-sends` | 63 |
| `titan` | 108 | os `lead-writes` | 100 |
| `core-extraction` | 137 | os `evidence` | 155 |
| `reconciliation` | 59 | os `operating-loop` | 48 |
| `research-foundation` | 132 | os `evidence-intelligence` | 35 |
| `freeze` | 62 | os `jobs` | 30 |
| os `os` | 62 | **os `operator` (new)** | **101** |
| os `migration` | 120 | | |
| os `auth` | 64 | | |
| os `shell` | 48 | | |
| os `sync` | 29 | | |
| os `research` | 81 | | |
| **Root total** | **776** | **os total** | **1,198** |

Also clean: `typecheck` (root and os), `os lint`, `os build`. Both goldens byte-identical; protected Titan files
unchanged (hashes compared before and after).

**In the browser** — a production build of the app on `localhost:3100`, against a throwaway loopback Postgres (TLS,
self-signed CA, because the app requires `rejectUnauthorized: true`) seeded with the committed 120 leads and three
local users (owner, outreach, intern). No hosted database was reachable from that process.

Every row of §6 was exercised. The ones that changed the code:

- **Failed database request.** Stopping Postgres mid-session produced the operator error screen — no stack trace, no
  Postgres text, a reference number that **matched the digest in the server log**. Two things were confirmed rather
  than assumed: Better Auth *throws* when the database is unreachable instead of returning "no session", so an outage
  never becomes `redirect('/login')` (zero login redirects in the log) — the operator is never told they are signed
  out when the truth is that the database is down.
- **…but the retry did not retry** (audit C5b). With the database restored, clicking "Try again" left the error on
  screen: `reset()` re-renders the boundary against the cached failed payload. Fixed and re-verified: the page
  boundary now refreshes the server render and resets in one transition (proven to recover *client-side* by a
  `window` marker that survived the recovery), and the root boundary reloads the document, because the layout that
  failed — session lookup included — has no healthy tree to reset into. Pinned by 10 new assertions.
- **Stale browser state.** A refused stale-version submit **keeps the operator's selection**, which is the whole point
  of C7; verified with two tabs.
- **Masked role.** As an intern: `b•••@o•••.design`, no email preview, no forms, and a recording panel that explains
  in plain words who to ask.
- **Gate labels** (D1) were read back from the live page for all eight gates, in operator language.

Two copy defects were found by reading the live pages and fixed: a redundant "· source: no source" repeated on every
gate, and a "Met" explanation that ignored core's structurally-checkable case (which is exactly why a timezone gate
passes without a source).
