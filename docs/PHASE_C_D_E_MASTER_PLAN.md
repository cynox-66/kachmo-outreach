# Kachmo Outbound OS — Phase C → D → E Master Plan

> **Status:** EXECUTED — C, D and E are implemented, tested and committed (2026-09-20)
> **Date:** 2026-09-19 · **Base:** Phase B (`a09f3a9`, frozen)
>
> | Phase | Branch | Commit | Suites |
> | :-- | :-- | :-- | :-- |
> | C — operating loop | `phase-c-operating-loop` | `5510c39` | operating-loop 47/0 |
> | D — evidence intelligence | `phase-d-evidence` | `6af7392` | evidence-intelligence 35/0 |
> | E — bounded jobs | `phase-e-jobs` | `e5417c5` | jobs 30/0 |
>
> Root 776/0 · os 1085/0 · typecheck, lint, build clean · migration rehearsal passes · production untouched.
> One deviation from the plan, recorded in ADR-028's commit: Phase C also fixed a contact-masking defect found during
> implementation (core's research-task text quoted the lead's own phone/email to anyone with `lead.view`).
> **Owner:** Dev Jaiswal (Kachmo Studios) · **Architect:** Claude Opus

## Executive Summary

Phase B made canonical state writable, safely. What is missing is the **operating loop**: today an operator still
has to visit six pages, read CLI strings that no longer work, and hold "what happened with this lead" in their head.

| Phase | One sentence | New tables | Automation |
| :-- | :-- | :-- | :-- |
| **C — Operating loop** | One deterministic "Today" list, a per-lead history, and an in-app research loop, all derived from state that already exists | none | none |
| **D — Evidence intelligence** | Make evidence measurable per gate, detect stale or changed sources, and *measure* (never activate) what an evidence-strict methodology would change | none | none (human-invoked refresh) |
| **E — Bounded systemization** | An idempotent job ledger and three bounded, explicitly scheduled jobs (source refresh, stale-data report, weekly report), with observability | `job_run` | yes, bounded, committed schedules disabled by default |

Every phase keeps the Phase B contract: Postgres is canonical, core decides, and Titan owns email. Humans perform every
consequential outreach act.

## Current State (inspected, 2026-09-19)

- **Canonical write path** (Phase B): applier, re-evaluation, revisions, suppression, evidence, fetch, review, revert,
  actor binding; 22 tables of which 19 are app tables; migration 0004.
- **Queues:** call and WhatsApp selectors (core), research tasks (`buildResearchQueue`, core), war room
  (`buildWarRoomSummary`, core — **string output**), inventory (core). Pages: dashboard (counts + next actions),
  calls, WhatsApp, email (Titan ledger, read-only), pipeline, research (candidates), inventory, analytics.
- **Gaps:**
  1. there is no single ordered work list;
  2. there is no per-lead history (events and audits exist in the database but are never shown per lead);
  3. research tasks on the lead page still print `npm run leads:record …`, which refuses after cutover (the strings come
     from golden-pinned core, so core cannot change);
  4. there is no cross-lead research work view;
  5. operator CLIs have no host confirmation;
  6. `leads:revert` writes no-op versions.
- **Evidence:** claim-level evidence with derived levels, fetch, and verbatim review. Zero legacy URL sources, so
  evidence grows only from new research.
- **Titan:** read-only ledger (a file baked into builds); the publisher and preflight are in CI.

---

## Phase C — The Operating Loop

**Objective.** Dev and Aadi run the day from the OS: open **Today**, work the list top to bottom, record outcomes
through existing actions, and see each lead's history, all without falling back to files, scripts or memory.

**Capabilities**

| # | Capability | Built from |
| :-- | :-- | :-- |
| C1 | **Today work list** (`/today`): one deterministic, ordered list of work items, each with kind, lead, why (the source facts), owner (DEV/AADI), due date, blocked-check and the page that acts on it. Filter "mine" by engine binding. | New pure core module `core/queues/today.ts` (additive, same predicates as the war room, pinned by a parity test) + os service adding evidence/candidate items from Postgres |
| C2 | **Lead history** on the lead page: one timeline of domain events, audit events and call attempts | `analytics_event` + `audit_event` (already redacted) + record; read-only service |
| C3 | **In-app research loop**: every research task on the lead page offers a prefilled research-record form instead of a dead CLI string; `/research/queue` lists open research across leads in core's order | `buildResearchQueue` + `ResearchRecordForm` |
| C4 | **Safety housekeeping**: operator CLIs require `KACHMO_OPERATOR_CONFIRM_HOST` for any writing mode; `leads:revert` refuses a no-op | `operator-db.ts`, `revert.ts` |

**Work-item kinds (state machine: none — items are derived, never stored).** Listed in priority order:

1. REPLY_WAITING
2. POSITIVE_NO_MEETING
3. FOLLOW_UP_DUE (callback/meeting date ≤ today)
4. EMAIL_FOLLOW_UP_DUE (Titan — act in Titan)
5. WHATSAPP_TO_SEND
6. CALL_READY
7. WHATSAPP_TO_APPROVE
8. CANDIDATE_REVIEW
9. EVIDENCE_REVIEW
10. RESEARCH (top of the research queue)

Within a kind: overdue first, then due date, then priority, then target number. A lead blocked from outreach
(`outreachBlock`) never appears in an outreach item.

**Non-goals:** no stored tasks, snoozing, assignment table or reminders; no new lead semantics; no sending; no AI.
**Data model:** none. **Service boundaries:**
- `core/queues/today.ts` (pure rules)
- `os/server/services/{today,timeline,research-queue}.ts` (read-only)
- existing actions for every write

**UI:**
- `/today` (new, first in the navigation)
- lead page: history section; research tasks → prefilled form
- `/research/queue`

**CLI:** host confirmation; revert no-op. **Audit:** reads are not audited (existing pattern). The CLI refusal paths
print; applies already audit.

**Security:** `/today` needs `lead.view`; evidence items need `evidence.review`; candidate items need `research.approve`.
No contact value is ever put in a work item or the timeline (audit metadata is already redacted).

**Tests:**
- parity: Today's reply, follow-up, call and WhatsApp sets equal the war room's lists over the golden data
- ordering is deterministic
- blocked leads are excluded
- RBAC filtering
- the timeline carries no contact values and is ordered
- the research-task → form mapping covers every core task field
- the CLI host confirmation refuses and allows correctly
- revert refuses a no-op

---

## Phase D — Evidence Intelligence

**Objective.** Make evidence *answer questions*: for each lead, how well sourced is each gate's fact; which sources have
gone stale or changed since a human checked them; which contradictions need action. Then **measure** what an
evidence-strict methodology would do, without changing any decision.

**Capabilities**

| # | Capability |
| :-- | :-- |
| D1 | **Gate evidence coverage** (`core/research/coverage.ts`, pure, additive): per gate, the best derived evidence level of the facts it reads — NONE / CLAIMED / URL_SHAPED / RETRIEVED / SUPPORTED / CONTRADICTED. Shown on the lead page and summarised on `/research/queue`. Display only. |
| D2 | **Source freshness and change detection**: `evidence:fetch --refresh[=days]` re-fetches sources whose latest successful retrieval is older than N days (default 30). A new retrieval whose content hash differs from the one a human reviewed marks that review **SOURCE_CHANGED** (derived from rows, never stored); the claim is surfaced for re-review. Same SSRF, rate-limit and cooldown rules. |
| D3 | **Contradiction and re-review in Today**: CONTRADICTED claims and SOURCE_CHANGED reviews become Today items ("correct the lead record" / "re-check the source"). |
| D4 | **Methodology shadow measurement** (`methodology:shadow`): for every lead, recompute the gates with ADR-011's pre-defined `strictGateOutcomeFor` over its evidence levels, and report the per-gate and per-state differences from v1.0. **Report only — nothing is persisted to a lead, no version is activated.** |

**Methodology / versioning:**
- v1.0 remains the only ACTIVE methodology, and its golden stays byte-identical.
- "v1.1" is *not* defined in D. D provides the instrument (D4) that an owner decision would need before defining it.
- Any future activation requires, in order: an owner decision, a new `methodology_version` row, a new golden, an
  explicit re-evaluation run and an ADR (the Phase B `leads:reevaluate` path already exists).

**Evidence architecture:**

    source URL → retrieval (FETCHER, hashed) → human review (verbatim excerpt) → derived level
              → refresh → changed hash? → SOURCE_CHANGED → re-review

Everything is derived from `lead_evidence` + `evidence_retrieval` rows. **Data model:** none.

**Non-goals:** evidence changing gates, scores or states; LLM extraction (ADR-016's preconditions are still unmet —
there is no corpus); automatic claim adoption.

**Tests:**
- coverage mapping covers every gate's source fields
- a CONTRADICTED claim dominates the gate's coverage
- refresh selects only stale sources and respects cooldown
- a changed hash yields SOURCE_CHANGED and an unchanged hash does not
- the shadow report persists nothing (lead hashes unchanged) and v1.0 goldens are untouched

---

## Phase E — Bounded Systemization

**Objective.** Recurring maintenance runs by itself, observably and idempotently, without anyone remembering to run
it — and still never contacts a prospect.

**Job model (migration 0005: `job_run`)**

```
job_run(id, job, idempotency_key UNIQUE, status RUNNING|SUCCEEDED|FAILED|ABANDONED,
        attempt, started_at, finished_at, lease_until, actor_label, summary jsonb, error)
```

- **Idempotency:** a key that already SUCCEEDED is skipped; the key is `<job>:<period>` (e.g. `evidence-refresh:2026-09-21`).
- **Crash recovery:** a RUNNING row past its lease is marked ABANDONED and the key may run again.
- **Retries:** a FAILED key is retried on the next invocation, at most 3 attempts, then it stays FAILED for a human.
- **Audit:** one audit event per run.

**Jobs:**

| Job | What it does | Writes |
| :-- | :-- | :-- |
| `evidence-refresh` | D2 refresh with bounded limits | `evidence_retrieval` rows + links only |
| `stale-data` | Counts overdue follow-ups, drift, sources needing re-review | summary only |
| `weekly-report` | Core `buildWeeklyReport` over Postgres | summary only |

**Scheduling:**
- A committed GitHub Actions workflow runs `jobs:run` with the job name.
- Its `schedule:` block is **committed commented out** (the Titan pause pattern): enabling it is a reviewed commit.
- `workflow_dispatch` is available for manual runs.
- There are no hidden workers and no in-app timers.

**Observability:** `/settings` → "Jobs" (last run per job, status, attempt, summary); `jobs:status` CLI.

**Security:**
- Jobs run with the operator-CLI gate plus `KACHMO_OPERATOR_CONFIRM_HOST`.
- They never touch leads, suppression or Titan.
- Evidence refresh keeps every SSRF and robots control.

**Tests:**
- idempotency (a second run is skipped)
- lease expiry → ABANDONED → rerun
- failure → retry → max attempts
- concurrent invocations of one key: exactly one runs (unique key)
- each job writes only what it declares
- the workflow schedule is commented out (static test, like the Titan guard)

**Non-goals:** autonomous outreach of any kind; discovery crawling; LLM jobs; queue tables for outreach.

---

## Dependency Graph

```
Phase B (frozen) ──► C1 Today ──► D3 (contradiction/re-review items)
                 ├─► C2 History
                 ├─► C3 Research loop ──► D1 Coverage ──► D4 Shadow
                 └─► C4 CLI host confirm ──► E jobs (use the same gate)
                                  D2 Refresh ──► E evidence-refresh job
```

## Data Model Evolution

C: none. D: none. E: `0005_job_ledger` (one additive table; append-only history except status transitions on its own
row, guarded like bindings).

## State Machines

- **Work items (C):** none, because they are derived on every read.
- **Evidence freshness (D):** a derived dimension, `FRESH | STALE(age > N) | SOURCE_CHANGED`.
- **job_run (E):**

```
RUNNING ──success──► SUCCEEDED (terminal)
   │ └──error─────► FAILED ──(next invocation, attempt < 3)──► RUNNING
   └──lease expired──► ABANDONED ──(next invocation)──► RUNNING
```

## Service Boundaries

- **Core (pure):** `queues/today.ts`, `research/coverage.ts`. Existing files are unchanged, so the goldens are untouched.
- **os services (read):** `today`, `timeline`, `research-queue`, `evidence-coverage`, `methodology-shadow`.
- **os writers (unchanged):** the Phase B applier; the evidence fetch-run gains refresh; the job runner is new in E.

## Security Model

As Phase B, plus:
- operator CLIs confirm the host;
- jobs are committed, dispatch-only until enabled, and use the same gate;
- no new permission in C or D; E adds none (jobs are operator-run).

## Evidence / Provenance Model

Every level is derived from rows. Every recommendation (Today item, coverage cell, shadow difference) names the source
fields it was computed from.

## AI Boundaries

C, D and E implement **no model calls**. LLM extraction stays off (ADR-016). Any future AI output enters only as
EXTERNAL_RESEARCH candidates or unreviewed evidence (ADR-014), and never as a level, a decision or a contact.

## Testing Strategy

Every phase keeps root, os, typecheck, lint and build green, and the concurrency suite green where it is touched.
New state gets unit, integration, auth, audit, idempotency and failure-path tests. The goldens are never regenerated.

## Migration Strategy

Only E adds a migration (0005, additive). It follows the same rehearsal as 0004: PGlite → loopback TLS replica →
disposable Neon → production, owner-run.

## Deployment Strategy

The phases ship as stacked branches (`phase-c-operating-loop` → `phase-d-evidence` → `phase-e-jobs`), each committed
and verified in a clean worktree. Production follows the Phase B runbook; E's schedule is enabled last, by commit.

## Rollback / Forward Repair

C and D are read-only additions plus two CLI safety changes: revert the code. E: disable the workflow schedule and
revert the code; `job_run` is inert history.

## ADR Index

| ADR | Decision |
| :-- | :-- |
| 028 | Today is a derived work list; rules in core; never stored |
| 029 | Lead history is a read model over existing logs |
| 030 | Operator CLIs confirm the host for writing modes |
| 031 | Evidence coverage and freshness are derived dimensions; SOURCE_CHANGED triggers re-review |
| 032 | Methodology shadow is measurement only; v1.1 is not defined or activated |
| 033 | Job ledger: idempotency keys, leases, bounded retries |
| 034 | Schedules are committed workflows, disabled by default |

## Explicit Freeze Points

- **C is frozen** when it is committed and verified; D does not change C's rules.
- **D is frozen** likewise.
- **E** is last.
- **B remains frozen.** C4 touches only operator CLI entry points and a revert no-op, which is a Phase B defect fix.

## Definition of Done (each phase)

1. ADRs written
2. All suites, typecheck, lint and build green
3. New behaviour tested as listed
4. Committed on its branch and verified in a clean worktree
5. No production contact

## Explicit Non-Goals (C–E)

- automatic email, WhatsApp or calls
- AI decisions of any kind
- methodology activation
- a second outreach state machine
- stored tasks
- discovery crawling
- revocation UX
- taxonomy changes
- UI polish beyond functional surfaces
