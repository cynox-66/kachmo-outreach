# ADR-018: The Legacy JSON Store Is Frozen After Cutover

> **Status:** Approved & Canonical (Phase 2)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-17
> **Version:** 1.0.0

---

## Purpose

Records what happens to the legacy JSON canonical store once the production data migration has completed and Postgres has become canonical.

---

## Context

[ADR-009](ADR-009-single-writer-canonical-state.md) defines three phases and names exactly one writer of canonical state in each. Before cutover that writer is the V2 CLI, writing three files:

- `database/kachmo_leads.json`
- `database/suppression.json`
- `analytics/events.jsonl`

The production migration ran on 2026-09-17 from commit `71b9eed5`, and `KACHMO_CUTOVER_PHASE=POST_CUTOVER` made Postgres canonical for the hosted application.

That flag lives in `os/.env.local`, which the hosted app reads. **A CLI invoked from the repository root never sees it.** So on the morning after cutover, every legacy command — `leads:qualify`, `calls:log`, `suppress:add` — still worked exactly as before, and still wrote the three JSON files. Nothing reconciles those files back into Postgres. A single such command would fork the truth silently, and the divergence would only surface later as a lead whose state differs depending on which surface you asked.

The operator had no way to notice: the commands succeed, print their usual output, and exit 0.

---

## Decision

**After cutover the three legacy canonical files are frozen evidence of what was migrated. Writing them is refused; reading them is not.**

Three consequences follow deliberately:

1. **The decision is recorded in a file, not an environment variable.** `database/CUTOVER_STATE.json` sits beside the store it governs and is committed, so the marker travels with the store and the decision is auditable in git history rather than in somebody's shell. `KACHMO_CUTOVER_PHASE` is still honoured; where the two disagree, **the more advanced phase wins** — a guard whose answer depends on which signal you happened to read is not a guard.

2. **The refusal happens at the one chokepoint, not at eleven call sites.** `scripts/lib/store.ts` is the only module that writes those three files, and its three write functions (`saveLeads`, `addSuppression`, `logEvent`) each call `assertLegacyStoreWritable()` before touching anything. A test asserts that no other script writes those paths directly, so a future writer that bypasses the chokepoint fails the suite rather than the cutover.

3. **The refusal explains itself and does nothing else.** A blocked command is *not* silently redirected to Postgres. There is no second Postgres write implementation. The error names the operation, the recorded phase, the migration commit, and the file that records the decision, and it says plainly that the command was not redirected — because an operator who sees a write "succeed" against a store that is no longer canonical is worse off than one who sees it refused.

Reads are permitted, and warn once per process that the data is frozen. Derived output (queues, war room, CSV export, weekly analytics) is therefore still produced, but the operator is told the input is no longer canonical.

---

## Scope

**Refused after cutover** — every command whose effect is a canonical JSON write:
`leads:record`, `leads:qualify`, `leads:score`, `leads:refresh`, `leads:opportunity`, `leads:migrate`, `calls:log`, `whatsapp:log`, `pipeline:log`, `suppress:add`.

**Unaffected** — these do not write canonical state:

- Read-only and derived-artifact commands (`leads:dedupe`, `leads:export:csv`, `queue:calls`, `queue:whatsapp`, `war-room`, `analytics:weekly`, `research:queue`, `audit:baseline`). They write queues, markdown and CSV, never the three canonical files.
- **The Titan email subsystem.** `OUTREACH_TRACKER.md` is the authoritative email ledger and is a separate production subsystem with its own guarantees. It was not migrated, it is not frozen, and `send:titan` / `cron:dispatch` behave exactly as before. `cron-dispatch.ts` *reads* `database/suppression.json` and refuses to send if it is missing or malformed — that check is untouched.
- **The Postgres migration importer** (`os/server/db/migration/import.ts`). It reads the JSON store as a source and writes only Postgres; it never imports the legacy writer. It is invoked through `db:migrate:data`, not through a normal operator command.
- Any workspace with no `CUTOVER_STATE.json` — a test fixture, a snapshot of an old commit. It is pre-cutover and writable, which is correct: it is not the canonical store.

---

## Consequences

- Post-cutover lead edits have **no CLI path**. They go through the hosted application. This is the intended end state, but it means a legacy command an operator relied on now stops, and the error must tell them where to go instead — it does.
- Historical JSON files are untouched and remain in git as the record of what was migrated.
- Undoing the cutover is possible but deliberate: change the phase in `database/CUTOVER_STATE.json` and reconcile the two stores by hand first. It cannot be done by accident, and it cannot be done by exporting an environment variable.
- An unreadable or unrecognised marker resolves to `POST_CUTOVER` — the one answer that cannot cause a wrong write.

### Open consequence: suppression can no longer reach the email cron by hand

[ADR-010](ADR-010-one-way-suppression-publish.md) notes that the GitHub Actions email cron reads the **committed** `database/suppression.json`, not Postgres. Its planner (`core/reconciliation/publish.ts`) is implemented and tested, but **no executor is wired up yet** — nothing currently performs the publish.

Before this freeze, `npm run suppress:add` was the manual route into that file. It now refuses. So after cutover a new opt-out recorded in the hosted app reaches Postgres and **does not reach the file the cron reads**.

**This is a live risk, not a theoretical one.** `suppressionFreshness()` blocks outreach *initiated through the hosted application*, but the GitHub Actions dispatcher is a separate V2 script: `cron-dispatch.ts` reads the committed suppression file directly and has no knowledge of Postgres. It runs on a schedule (`.github/workflows/outreach-dispatch.yml`, Mon–Thu, three times daily) and `scheduled-queue.json` is not empty. A suppression recorded only in Postgres would therefore **not** stop it.

The freeze did not create this gap — ADR-010 exists because of it — but it removed the manual mitigation, so the gap is now reachable in normal operation.

Unfreezing `suppress:add` is *not* the fix — it would write the suppression into the file and leave Postgres and the file disagreeing about every other field of that lead, which is exactly the divergence this decision exists to prevent.

**Resolution (2026-09-17): automated dispatch is paused.** The three `schedule:` triggers in `.github/workflows/outreach-dispatch.yml` are commented out and a fail-closed gate step, reading `OUTREACH_PAUSE.json`, runs before the dispatcher. `workflow_dispatch` still allows a dry run; a real send requires an explicit `acknowledge_stale_suppression` input. Titan's send logic, ledger, queue and send state are untouched — the pause is entirely at the workflow level. See `audit/APPROVED_PRODUCTION_CHANGES_2026-09-17.md`.

**Resolved (2026-09-17): the publisher exists.** [ADR-010](ADR-010-one-way-suppression-publish.md)'s executor is implemented, audited and idempotent, and the workflow now runs publish-then-verify before the dispatcher. A stale, malformed, absent or unexplained artifact — or an unreachable Postgres — fails the job, so nothing is sent.

That changes what "frozen" means for this one file, and the exception is stated precisely:

| File | After cutover |
|---|---|
| `database/kachmo_leads.json` | frozen; no writer |
| `analytics/events.jsonl` | frozen; no writer |
| `database/suppression.json` | frozen to operators; **derived state maintained solely by the ADR-010 publisher** |

`scripts/lib/store.ts`'s `addSuppression()` stays refused: the publisher is an addition, not a loophole. A test asserts exactly one module in `os/server` writes the artifact, and that it is the dedicated store.

Automated production dispatch remains **paused**, now for a different reason: the mechanism is ready but has never run against production Postgres, and resuming outreach is a human decision, not an engineering one. The cron also executes the *committed* workflow, so none of this takes effect until pushed.

---

## Verification

`npm run test:freeze` (58 assertions) covers: every writer refuses under `POST_CUTOVER` with a message naming the recorded decision; `PRE_CUTOVER` and `CUTOVER_WINDOW` behaviour is unchanged; reads still work; the environment cannot un-freeze a recorded cutover; the migration importer neither imports nor calls the legacy writer; no script bypasses the chokepoint; and the three real canonical files are byte-identical before and after the suite.
