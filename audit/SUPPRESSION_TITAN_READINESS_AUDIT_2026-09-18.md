# Suppression → Titan boundary: final production-readiness audit (2026-09-18)

Base: `5a42d14` (= origin/main). Titan dispatch remains **PAUSED**. No email was sent, nothing was deployed,
no production row was written, the migration was not re-run, Methodology v1.0 is unchanged.

## Production path traced

```
Postgres suppression_entry (canonical)
  → readCanonicalSuppression()            os/server/sync/publish-suppression.ts   (active = revoked_at IS NULL)
  → planSuppressionPublish()              core/reconciliation/publish.ts          (additive, SHA-conditional)
  → writeSuppressionArtifact()            os/server/sync/suppression-artifact-store.ts (O_EXCL lock, CAS, temp+rename)
  → re-read + verifySuppressionArtifact() core/reconciliation/suppression-artifact.ts
  → [workflow] suppression:verify         artifact vs Postgres  +  NEW dispatch preflight (queue vs Postgres)
  → [workflow] NEW freshness guard        HEAD == origin/main, workspace holds only the publisher's change
  → scripts/cron-dispatch.ts              matches target_number / email / domain from the artifact + ledger
  → nodemailer → Titan SMTP (STARTTLS, rejectUnauthorized: true)
```

## Defects found and fixed in this pass

| # | Defect | Severity | Fix |
|---|---|---|---|
| 1 | The pushed workflow could never run the publisher: CI ran only the root `npm install`, so `os/` deps and `core/dist` were absent (`ERR_MODULE_NOT_FOUND`, reproduced in a fresh clone). Fail-closed, but dispatch was unreachable. | Blocker (readiness) | `npm ci`, `npm ci --prefix os`, `npm --prefix os run build:core` |
| 2 | `workflow_dispatch` input `acknowledge_stale_suppression` bypassed the pause gate. | Blocker (human boundary) | Input removed; no override exists |
| 3 | A missing `OUTREACH_PAUSE.json` was treated as *unpaused*. | Fail-open | Missing/unreadable/non-boolean ⇒ paused |
| 4 | The verifier's equivalence accepts a match on **any** key, but the dispatcher enforces only target_number/email/domain and never reads lead state. A lead_id-only or phone-only suppression, or a lead marked DO_NOT_CONTACT/OPT_OUT in Postgres, verified IN_SYNC and would still be emailed (demonstrated in `os/tests/suppression-publish.ts`). | Blocker (suppression) | `os/server/sync/dispatch-preflight.ts`: every queued email checked with `outreachBlock()` against the Postgres lead, active Postgres suppression and the ledger; runs inside `suppression:verify` |
| 5 | Duplicate queue entries were both sent (the dispatcher reads the ledger once). | Duplicate send | Preflight refuses `DUPLICATE_ENTRY` |
| 6 | A queued target with no ledger row, or a row not in `**SCHEDULED**`/`**DRAFTED**` form, is sent but never durably marked `**SENT**`. | Duplicate send | Preflight refuses `NOT_IN_LEDGER` / `LEDGER_NOT_SENDABLE` |
| 7 | No `concurrency:` group: two runs could dispatch the same queue. | Duplicate send | `concurrency: outreach-dispatch`, no cancel |
| 8 | The ledger commit ran only if dispatch fully succeeded; a failure after N sends lost those ledger updates. A rejected push was also silent in effect. | Duplicate send | Commit runs when dispatch ran (success or failure); `pull --rebase` + push, loud `::error::` on failure |
| 9 | Stale checkout: verification is only valid for the checkout it ran on. | Stale ledger | Guard: HEAD == origin/main and only `database/suppression.json` modified, immediately before dispatch; main-only ref check |
| 10 | Manual `send:titan` trusted a well-formed local `suppression.json` after cutover. | Unverified artifact | POST_CUTOVER ⇒ `suppression:verify` must exit 0 first (no flag) |
| 11 | Defect B was only partly fixed: `reviewCandidate` still committed ACCEPTED + audit **before** promotion, so a promotion failure (e.g. a target-number collision) left an ACCEPTED, audited candidate with no lead and no retry path. | Partial state | Lead built before any write; decision, lead, resolution and both audits in one conditional transaction |
| 12 | Brief creation, report upload and owner bootstrap wrote state and audit separately. | Partial state (low) | Each is one transaction |
| 13 | Untrusted research URLs rendered as `href` without scheme check. | Hardening | Links only for http(s) |
| 14 | `${{ inputs.* }}` interpolated into shell. | Hardening | Passed through `env:` |

Defect A (dashboard freshness) is genuinely fixed: it compares Postgres to the artifact bytes. It reads the
artifact from the deployed bundle, so it is advisory; the CI verify step is the gate.

## Residual limits (not closed, stated plainly)

- **Postgres → send window.** A suppression committed to Postgres after the verify/preflight step (seconds) and
  before or during the dispatch loop (≈4 s per email) is not seen by that run. Bounded by job duration; next run refuses.
- **Branch workflows.** Anyone with write access can dispatch a modified workflow from another branch; the main-only
  check lives in the workflow itself. Mitigation is GitHub-side (environment protection on `DATABASE_URL`/`TITAN_PASSWORD`).
- **Token exposure to install scripts.** `actions/checkout` persists `GITHUB_TOKEN` in `.git/config` during `npm ci`.
  Lockfile-pinned; secrets are scoped to their own steps.
- **No post-cutover suppression writer.** `suppress:add` is frozen and the app has no suppression action, so an opt-out
  today means a hand-written SQL insert. The preflight enforces whatever key that row carries.
- **Manual `send:titan` lead state** comes from the frozen JSON store (identical to Postgres for the 120 migrated
  leads; nothing post-cutover writes lead status).
- The 5 held queue entries were drafted for "Tue" 2026-09-15 and carry Sent Date 2026-09-15 in the ledger; they will
  go out in the next local-morning window after unpause. Review the copy/timing before resuming.
