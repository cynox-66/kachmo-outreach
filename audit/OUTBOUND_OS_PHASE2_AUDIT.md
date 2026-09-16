# Outbound OS — Phase 2 Audit

> **Date:** 2026-09-16
> **Phase 1.5 head (start of this phase):** `61b20a253f19b029433e533826321793099d0fc7`
> **Golden baseline:** `48cfbc0a8d3364fc95654c68b9764cc8af7013ab` — unchanged
> **Pushed:** NO · **Deployed:** NO · **Production migration:** NO · **Outreach sent:** NO

Phase 2 turned the Phase 1.5 foundation into a working internal application. The app now reads the real 120 leads, runs every operational queue, and ingests research reports through a human approval boundary. No production database exists, no lead data has been migrated, and nothing has been sent.

---

## 1. Commits

| SHA | What |
| :-- | :-- |
| `ba42452…` | the functional application, data layer, research pipeline and migration tooling |
| `ddad4dc…` | the Phase 2 research and application test suites |
| _(this commit)_ | this audit and ADRs 015–017 |

All local. Nothing pushed. The seven Phase 1.5 commits are intact.

---

## 2. Architecture after Phase 2

```
core/  (@kachmo/core)          pure domain engine, Methodology v1.0
  ↑ used by both, never duplicated
scripts/                       thin CLI adapters — the ONLY writer of the JSON store today
os/
  server/repo/                 canonical read layer: one interface, two backends (ADR-015)
  server/services/             read surfaces; contacts.ts is the single reveal point
  server/research/             brief → upload → parse → validate → assess → review
  server/db/migration/         rehearsal (PGlite + gated hosted) and production tooling
  app/                         12 permission-gated routes
```

`core/` is now a real package with an emitted `dist`, because Turbopack will not map its NodeNext `.js` specifiers onto `.ts` sources. **Core's sources are unchanged** — this closes the "core/ needs a package entry point" risk from the Phase 1.5 audit.

---

## 3. What was built

### Data layer

`server/repo/canonical.ts` reads leads, suppression and events from the committed JSON store in `PRE_CUTOVER` and from Postgres in `POST_CUTOVER`; the Titan ledger is read from its files in every phase. Nothing in the layer writes. A malformed store throws rather than rendering a partial list. Every snapshot records which store answered, and the layout renders a banner naming it. An undeclared phase resolves to `PRE_CUTOVER` — read-only.

### Pages (12, all gated server-side)

Dashboard (what is happening / what needs attention / what to do next), Leads (server-side search, seven filters, facets, six sorts, clamped pagination), Lead detail ("why this lead?"), Inventory, Calls, WhatsApp, Email, Pipeline, Analytics, Users, Audit log, Settings.

**"Why this lead?"** recomputes all eight gates, the score breakdown and the reasons from the stored record at render time, and shows recorded provenance with its evidence level. There is no narrated reasoning anywhere: only stored facts and deterministic rule outcomes.

### Research pipeline

```
Inventory shortage → Brief → external research → Upload → Parse → Validate →
Dedupe → Assess → HUMAN REVIEW → (export queue | canonical lead after cutover)
```

Three tables (`research_brief`, `research_report`, `research_candidate`) live **beside** the lead table, never inside it. Parsing is deterministic ([ADR-016](../docs/adr/ADR-016-deterministic-report-parser.md)); the LLM interface exists, is disabled, and feeds the same validator.

### Migration tooling — built, never run

| Command | Behaviour |
| :-- | :-- |
| `db:rehearse` | PGlite only. Needs no authorisation and cannot reach a hosted database. |
| `db:rehearse:hosted` | Requires naming the exact host **and** acknowledging the target is disposable. `DATABASE_URL` alone is not authorisation. A production-looking name is refused outright. |
| `db:migrate:data` | Dry run by default. Preflight refuses on a missing/mismatched confirmation, a dirty tree, a non-empty target or an invalid source. Post-migration reconciliation is part of the migration, not a follow-up. |

---

## 4. Methodology

**Methodology v1.0 changed: NO.**

The golden baseline was not regenerated. Golden 42/42 and write-path 11/11 pass unchanged. The application independently reproduces the known distribution from a different code path: **120 leads · 13 usable · 107 research-required · 20 A/A+ all provisional · 0 callable phones.**

`URL_SHAPED` still maps to `PASS`. The taxonomy inconsistency is still declared, not corrected.

---

## 5. Security

| Boundary | How it holds |
| :-- | :-- |
| Contact values | `server/services/contacts.ts` is the single reveal point. An INTERN or VIEWER receives `null` plus a shape-preserving mask, computed server-side — the value is absent from the response, not hidden in the browser. Enforced on leads, detail, calls, WhatsApp and the email ledger. |
| Route authorisation | Every page calls `requirePermission` before reading anything. Navigation filtering is convenience only. |
| Server actions | auth → authorize → validate at the boundary → core operation → persist → audit. Sign-in/sign-out are the only exempt actions, and deliberately so. |
| Uploads | Validated before a byte is parsed: traversal, NUL bytes, path separators, 5 MB cap, format allowlist, mandatory hash. Stored verbatim, never executed. The filename is metadata and never a path. |
| Parser | Bounded on size, nesting depth, candidate count, field count, value length and row count. Control characters stripped. |
| Approval | Refuses `SYSTEM`, `LLM` and anything agent-shaped. A suppressed candidate is refused for everyone. Suppression is re-checked at approval, not only at extraction. |
| Titan | No mail library, no legacy send script, no SMTP credential anywhere in the app. Asserted by test. |
| Secrets | No `NEXT_PUBLIC_` anywhere; no client component reads the environment; audit metadata is redacted. |

---

## 6. Tests

| Suite | Phase 1.5 | Phase 2 |
| :-- | --: | --: |
| legacy · golden · write-path · Titan · core extraction · reconciliation · research foundation | 662 | 662 |
| OS database | 61 | 61 |
| OS migration | 68 | 68 |
| OS auth | 61 | 61 |
| OS shell | 35 | 37 |
| OS sync boundary | 29 | 29 |
| **OS research pipeline** | — | **81** |
| **OS application & security** | — | **98** |
| **Total** | **916** | **1097** |

Typecheck clean (core, scripts, os). Lint clean. `next build` compiles all 19 routes.

### Three defects the new suites found

1. `approvalRefusal` reported "already SUPPRESSED" instead of the real reason, because terminal status was checked before suppression. Suppression now wins — it is the reason that can never be worked around.
2. Re-review was keyed on terminal status, so a system-assigned `SUPPRESSED` masked its own refusal. It now keys on *a human having decided*.
3. A `(source: …)` that is not a URL was left sitting inside the claimed value. It is now stripped and reported: "they gave a source" and "the source is usable" are different facts.

A fourth was found in the tooling: every script that resolves `@kachmo/core` now rebuilds it first, because a stale `dist` silently tested old domain logic — which is how defect (1) hid itself for a run.

---

## 7. State ownership (unchanged from ADR-009)

| | Canonical for leads | Accepts lead writes |
| :-- | :-- | :-- |
| Before cutover | `GIT_JSON` | `GIT_JSON` (CLI only) |
| During cutover | `GIT_JSON` | nothing |
| After cutover | `POSTGRES` | `POSTGRES` |

Titan owns email send state in every phase. An approval before cutover is recorded but does not write a lead ([ADR-017](../docs/adr/ADR-017-approval-does-not-write-in-pre-cutover.md)).

---

## 8. Known limitations

1. **No hosted database has ever existed.** The gated hosted rehearsal is implemented and fails closed on every precondition, but has never run against real Postgres.
2. **No URL fetcher.** No evidence can reach `RETRIEVED` or `SUPPORTED` in practice; everything sits at `URL_SHAPED`, which the UI states plainly.
3. **Approved candidates export manually** before cutover.
4. **User invitation and role changes are CLI-only.** Deliberate: it is the one surface where a bug hands out someone else's permissions, and the audit and rate-limiting paths are not yet wired through a mutation.
5. **Merge records the decision but does not merge fields.** Field-level merge needs the ownership model applied per field.
6. **The whole store is read per request.** Correct at 120 leads; the repository boundary is what makes indexed queries a local change later.
7. **`core/dist` is a build artifact.** Every script that resolves the package rebuilds it first, but a hand-run `tsx` command against a stale dist would not.
8. **CSP still permits `unsafe-inline`**; rate limiting still relies on forwarded-IP headers.

---

## 9. Phase 3 starting point

In place and tested: a working application over real data, the research pipeline through human approval, gated hosted-rehearsal and production-migration tooling.

The ordered next steps:

1. One disposable Neon branch; run `db:rehearse:hosted`; destroy it.
2. `db:migrate:data --apply` against a real branch, then declare `POST_CUTOVER`.
3. A URL fetcher, so evidence can reach `RETRIEVED`.
4. Canonical import on approval (the POST_CUTOVER path), with field-level merge.
5. The first real research drop.

---

## 10. What did not happen

- No email, WhatsApp message or call was sent.
- No hosted database was created; no production data was migrated.
- Nothing was pushed; nothing was deployed.
- No Methodology v1.0 semantics were altered; no golden baseline was regenerated.
- No research was performed; no evidence, contact or business fact was invented.
- No existing production file was deleted, and no Titan behaviour was changed.
