# Outbound OS — Phase 1.5 Audit

> **Date:** 2026-09-16
> **Baseline commit (golden behaviour):** `48cfbc0a8d3364fc95654c68b9764cc8af7013ab`
> **Phase 1 head (start of this phase):** `815c3d156bd6a69c706dcf76b611b9306f5b46fc`
> **Phase 1.5 code head:** `ccbade3cba56161765265f3d188dbc78ae77ae4b` (this document is committed on top of it)
> **Pushed:** NO · **Deployed:** NO · **Production migration:** NO · **Outreach sent:** NO

Phase 1.5 turns the Phase 1 foundation into a cutover-ready architecture. It changes **no** Methodology v1.0 behaviour, creates **no** hosted database, migrates **no** production data, and performs **no** research.

---

## 1. Commits

| SHA | What |
| :-- | :-- |
| `f35df375e1fc98e6f8d6bb024a73742c0a6d7a46` | 1.5A + 1.5B — write-path domain extraction, pinned by a write-path golden |
| `f567cde3030766c363e132bc4da02a6d09add0d2` | 1.5C — exact-commit migration manifest and failure-case rehearsal |
| `de2fa817441ed54010b48456a92913cdc892d11b` | 1.5D — single-writer ownership, drift detection, Titan boundary |
| `ccbade3cba56161765265f3d188dbc78ae77ae4b` | 1.5E — research foundation (evidence, reports, candidates, extraction, briefs, inventory) |

Plus one documentation commit carrying this audit and ADRs 009–014.

All local. Nothing pushed. History was not rewritten; the six Phase 1 commits are intact.

---

## 2. Methodology changes

**None.**

The golden baseline `scripts/__tests__/golden/methodology-v1.0.baseline.json` was not regenerated, not reshaped and not edited. All 42 golden checks pass unchanged.

The 120-lead distribution is exactly as recorded at Phase 1: **A+ 2 · A 18 · B 80 · C 20, all provisional; 13 qualified, 107 research-required; no sourced callable phone.** The new inventory module independently reproduces that split (13 usable, 107 recoverable by research) from a different code path.

---

## 3. 1.5A — Write-path extraction

Ten domain areas moved into `core/`, each now with exactly one implementation:

| Module | Rule |
| :-- | :-- |
| `core/state/decision.ts` | the `LeadDecision` contract, the opt-out patch, note appending |
| `core/state/call.ts` | call outcome state machine |
| `core/state/whatsapp.ts` | draft → approve → send → reply |
| `core/state/pipeline.ts` | sales stage ordering, single-bump email protocol |
| `core/state/research-record.ts` | research provenance rules |
| `core/state/suppression-propagation.ts` | suppression planning, Titan queue conflict check |
| `core/reports/war-room.ts` | daily work-list derivation |
| `core/reports/weekly.ts` | funnel and conversion derivation |
| `core/leads/csv.ts` | CSV contract, row mapping, human-data preservation |
| `core/config/taxonomy.ts` | versioned archetype/vertical boundary |

A decision is a **pure description of an intended change**: `{ refusal, warnings, patch, suppression, events, summary }`. It performs no I/O. `scripts/lib/apply.ts` is the only place a decision becomes a write, and its order is fail-closed: refusals stop before anything is touched; the lead and suppression list persist before any event is appended.

CLI wrappers are now 27–59 lines each (asserted by test at a ceiling of 80).

### Deliberately left outside `core/`

| Thing | Why |
| :-- | :-- |
| Markdown rendering of the queues (`queue-calls.ts`, `queue-whatsapp.ts`, `leads-research-queue.ts`) | Presentation, not domain. The selection logic these files render was already in `core/` at Phase 1. Moving the prose would be churn with no single-implementation benefit. |
| `todayIst()` | Reads the clock and `process.env`. `core/` takes `today` and `now` as arguments so every rule is deterministic and testable. |
| IANA timezone validation | Needs `Intl`. `core/` takes an `isKnownTimezone` callback rather than assuming a platform. |
| `commitsBehindUpstream()` | Shells out to git. |
| Titan send scripts | A separate production subsystem (§7). |

### One technical change with no product effect

`pipeline-log` previously called `new Date()` twice within a single transition (once for `last_contacted_at`, once for `updated_at`), which could differ by a millisecond. Both now take the single `ctx.now`. This makes the transition deterministic; it changes no semantics.

---

## 4. 1.5B — Golden regression

Two separate golden artifacts, so a change to derived behaviour and a change to write behaviour fail independently:

| Artifact | Pins |
| :-- | :-- |
| `methodology-v1.0.baseline.json` (unchanged) | what the engine **derives**: 8 gates, missing intelligence, completeness, scores, tiers, confidence, provenance, suppression, outreach blocks, dedupe, queue eligibility, research tasks, call cards, WhatsApp drafts, pipeline output, events, war room, weekly report, markdown |
| `methodology-v1.0.writepaths.baseline.json` (**new**) | what the engine **writes**: 36 scripted operator actions over the same pinned dataset — 18 applied, 18 refused — plus final lead state, suppression list, event log and the exported CSV projection |

### The verification that matters

The write-path baseline was captured **twice**: once from the pre-extraction implementation at `815c3d1` (in a throwaway git worktree) and once from the extracted implementation. The two are **byte-identical**.

That is the proof that 1.5A preserved write behaviour, and that the baseline pins the *original* implementation rather than merely the new one.

Refusals are asserted separately from successes, because a refusal silently becoming an acceptance is the failure that matters.

---

## 5. 1.5C — Exact-commit migration rehearsal

**Environment:** in-memory PostgreSQL (PGlite) with the real migrations applied. **No hosted database was created. No Neon branch exists. No production data was migrated.**

`server/db/migration/manifest.ts` records what a rehearsal is evidence *of*:

- exact source commit, code commit, and whether the working tree was dirty
- SHA-256 of every source file; one hash over all lead records in target-number order
- the schema the database actually has: journal tags, **migration hashes the database reports as applied**, tables, columns, constraints, indexes, triggers
- row counts and lead IDs on both sides
- contact-provenance tallies — counts only, no contact values anywhere

Latest rehearsal from `f35df37`: **120 leads · 0 suppression entries · 240 events · 13 tables · 139 constraints · 36 indexes · 7 triggers**, all 14 reconciliation checks passing, second import refused, source and target record hashes identical.

### Failure cases proven (59 checks)

| Case | Result |
| :-- | :-- |
| malformed source, duplicate lead id, duplicate event id, invalid enum, out-of-range score, suppression without identifier | import fails and writes **nothing** — verified across `lead`, `suppression_entry`, `analytics_event`, `audit_event`, `methodology_version` |
| unique / check / foreign-key / append-only constraints | enforced by the database, not the application |
| rerun into a populated or **partially** populated database | refused, never merged; no second audit event |
| stale schema | detectable (fewer applied migrations) and demonstrably **lacks the append-only guards** — which is why the manifest must pin the schema version |
| closed connection | fails rather than appearing to succeed |
| reconciliation against a missing lead, one edited field, an extra suppression entry, reordered events | fails — it detects tampering, not just success |

### Deterministic

Two rehearsals from the same commit produce an identical manifest apart from the timestamp.

---

## 6. 1.5D — Canonical state and reconciliation

Full rationale: [ADR-009](../docs/adr/ADR-009-single-writer-canonical-state.md).

| | Canonical for leads | Canonical for suppression | Accepts lead writes |
| :-- | :-- | :-- | :-- |
| **Before cutover** | `GIT_JSON` | `GIT_JSON` | `GIT_JSON` |
| **During cutover** | `GIT_JSON` | `GIT_JSON` | **nothing** |
| **After cutover** | `POSTGRES` | `POSTGRES` | `POSTGRES` |

All **133** fields on the real records are classified into 14 ownership groups. Unclassified fields are **deny-by-default**. Identity and the never-estimated fields are immutable in every phase.

Drift detection is a pure comparison that never merges and never picks a winner. It grades by consequence: identity, contact-provenance and suppression differences are `BLOCKING`; a shrinking call history is flagged as data loss; a difference in a field the other store legitimately owns in that phase is `INFO`. **The report carries field names only, never values**, because values may be contact data.

### Rollback

- **From the cutover window:** free. Nothing accepted lead writes, so the JSON store is unchanged and still canonical.
- **After cutover:** the JSON store is frozen evidence at a known commit. Reverting means declaring `PRE_CUTOVER` again and reconciling Postgres against it; the drift report enumerates exactly what was written since. Migration is refused into a populated database, so a re-import cannot silently merge.
- **A failed migration:** rolls back in one transaction, writing nothing.

---

## 7. The Titan boundary

Full rationale: [ADR-010](../docs/adr/ADR-010-one-way-suppression-publish.md).

Titan owns email send state in **every** phase. The Outbound OS mirrors `lead_state`, `email_outreach_status`, `email_follow_up_sent_at` and `batch_history` as a read-only projection and never writes them. No mail library is imported into the app, and no legacy send script is reachable from it — both asserted by test.

Suppression reaches the email cron by a one-way, additive, optimistic, audited publish, with a hard freshness guard: **if any canonical suppression entry is unpublished, Titan outreach is blocked outright.** No grace period, no cache. Exactly one of the five publish states permits sending, and it is `PUBLISHED_VERIFIED`; an in-flight publish is never shown as "synced".

**The bridge is inert.** `os/server/sync/titan-bridge.ts` contains no network call, names no endpoint, holds no credentials, and its default transport refuses — so an unconfigured deployment fails closed rather than silently no-opping.

---

## 8. 1.5E — Phase 2 research foundation

Contracts and validators only. No model was called, no URL fetched, no candidate created.

| Contract | Module | Key guarantee |
| :-- | :-- | :-- |
| Research report | `core/research/report.ts` | versioned; uploads treated as hostile (traversal, NUL, path separators, 5 MB cap, format allowlist, required hash); stages cannot skip or reverse |
| Evidence | `core/research/evidence.ts` | URL syntax ≠ reachability ≠ support ([ADR-011](../docs/adr/ADR-011-evidence-levels.md)) |
| Provenance | `core/research/evidence.ts` + `core/state/research-record.ts` | every claim carries where it came from and who recorded it |
| Candidate | `core/research/candidate.ts` | a candidate is not a lead ([ADR-012](../docs/adr/ADR-012-candidates-are-not-leads.md)) |
| Validation | `core/research/extraction.ts` | model output is hostile input ([ADR-014](../docs/adr/ADR-014-llm-output-is-untrusted.md)) |
| Human approval | `approvalRefusal()` | refuses `SYSTEM`, `LLM`, anything agent-shaped, and anything suppressed — **by anyone** |
| Research brief | `core/research/prompt.ts` | demands evidence, not "good leads" |
| Inventory | `core/research/inventory.ts` | counted from state against explicit thresholds; launches nothing |

### The evidence distinction

`URL_SHAPED` means a well-formed URL that **nobody fetched — it may not exist**. `RETRIEVED` means it exists. `SUPPORTED` means a human confirmed the page states the claim. An LLM caps at `RETRIEVED` and can never certify its own claim.

Methodology v1.0 is untouched: `URL_SHAPED` still maps to `PASS`, exactly as today. `CONTRADICTED` maps to the existing `FAIL`. No sixth gate outcome was introduced. `strictGateOutcomeFor()` shows what raising the bar would look like; **no gate calls it**, and adopting it would require approval and a new baseline.

### Inventory against the live database

33 segments, **7 needing research**, all `CRITICAL`, all blocked primarily on `gate_2_contactability` — which is the counted, mechanical restatement of the known fact that no phone in the database has a recorded source.

---

## 9. Security

Unchanged and re-asserted: server-side authorisation, deny-by-default RBAC, invite-only auth, secure sessions, audit logging, secret redaction, no secrets in `NEXT_PUBLIC`, server-only modules, CSP/HSTS/noindex/frame protection, rate limits.

Added in Phase 1.5:

- Research uploads are validated as hostile before anything is parsed: path traversal, NUL bytes, path separators, size cap, format allowlist, mandatory content hash. **Nothing uploaded is ever executed, and a filename is never used as a path.**
- Model output is validated against a strict schema with length caps and control-character stripping.
- The drift report and the migration manifest carry counts, field names and hashes — never contact values (asserted by test).
- The Titan bridge holds no credentials and makes no network call.

---

## 10. Tests

| Suite | Before | After |
| :-- | --: | --: |
| legacy | 225 | 225 |
| golden (derived) | 42 | 42 |
| golden (write paths) | — | **11** |
| Titan direct-send | 56 | 56 |
| core extraction | — | **137** |
| reconciliation | — | **59** |
| research foundation | — | **132** |
| OS database | 61 | 61 |
| OS migration | — | **59** |
| OS auth/authz/audit | 61 | 61 |
| OS shell | 35 | 35 |
| OS sync boundary | — | **29** |
| **Total** | **480** | **907** |

Typecheck clean (core, scripts, os). Lint clean. `next build` succeeds.

A note on test integrity: the single-implementation detectors in `core-extraction.ts` each carry a **vacuity guard** asserting the pattern actually matches inside `core/`. That guard caught one dead regex during development, which is why it is there.

---

## 11. Remaining risks

1. **Methodology documentation is still inconsistent.** Multiple historical documents disagree with the running code. The tested implementation remains the v1.0 source of truth. Not silently reconciled.
2. **The taxonomy inconsistency is declared, not fixed.** Archetype 6 carries ten verticals as labels; archetype 2 carries two names. An open product decision — [ADR-013](../docs/adr/ADR-013-taxonomy-boundary-deferred.md).
3. **`location_country` holds `Scotland` and `Northern Ireland` alongside `United Kingdom`**, so those are separate inventory segments. Left as stored.
4. **No hosted database has ever existed.** The first real Neon branch remains an unperformed proof step.
5. **The Titan bridge is not implemented.** Until it is, publishing suppression is a manual, verified step.
6. **`URL_SHAPED` still passes gates.** A fabricated URL from a *human-entered* record would still qualify a lead. The evidence layer makes this measurable; changing it is a methodology decision.
7. **No fetcher exists**, so no evidence can currently reach `RETRIEVED` or `SUPPORTED` in practice.
8. **CSP still permits `unsafe-inline`.** Carried forward from Phase 1.
9. **Rate limiting still relies on forwarded-IP headers** and needs deployment-aware hardening.
10. **`core/` has no package entry point** for runtime imports; consumers use deep relative paths.
11. **The 8 modified operator artifacts in the working tree** (war room, queues, research queue) are date-dependent regenerations from a 2026-09-15 run, not source changes. They are intentionally left uncommitted; the rehearsal's dirty-tree check excludes exactly these generated paths.

---

## 12. Phase 2 starting point

Phase 2 begins from `ccbade3` with these in place and tested:

- research report contract and hostile-upload validation
- evidence model with derived levels and an LLM ceiling
- candidate model with a refusing human approval boundary
- extraction validator (no model call)
- versioned brief contract and renderer
- inventory detection feeding a research queue

What Phase 2 must build, in order:

1. Persist reports, candidates and evidence (tables `lead_evidence` exists; `research_report` and `research_candidate` do not yet).
2. A reviewer UI that answers "why is this lead here?" and "what should I do next?" from stored claims and evidence, with no hidden reasoning.
3. A URL fetcher, so evidence can reach `RETRIEVED`.
4. A controlled import API for approved candidates — the only path from candidate to lead.
5. Only then, the first real research drop.

---

## 13. What did not happen

- No email, WhatsApp message or call was sent.
- No GitHub Action was triggered.
- No hosted database was created; no production data was migrated.
- Nothing was pushed; nothing was deployed.
- No Methodology v1.0 semantics were altered.
- No golden baseline was regenerated.
- No research was performed; no evidence, contact or business fact was invented.
- No existing production file was deleted.
