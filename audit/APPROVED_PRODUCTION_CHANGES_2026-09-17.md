# Approved production changes (2026-09-17)

## 1. What changed and why

Automated Titan outreach dispatch is **paused**. This is an intentional safety pause, not an operational failure.

`KACHMO_CUTOVER_PHASE=POST_CUTOVER` is active and Postgres is canonical. The hosted application records suppression in Postgres. `scripts/cron-dispatch.ts` reads the **committed** `database/suppression.json`. The ADR-010 publisher that would copy one into the other is designed and tested (`core/reconciliation/publish.ts`) but **has no executor**. Suppression synchronisation does not exist.

An opt-out recorded in the app therefore reaches Postgres and never reaches the artifact the dispatcher checks. `suppressionFreshness()` blocks outreach initiated through the hosted app, but the GitHub Actions dispatcher is a separate V2 script that does not consult it. Until a publisher exists, an automated run could email someone who asked not to be contacted.

`scheduled-queue.json` holds 5 entries (targets 101–105). The schedule was Mon–Thu, 3×/day.

## 2. Protected hash change

| File | Baseline 09-15T0709 | Baseline 09-17T1103 | Why |
|---|---|---|---|
| `.github/workflows/outreach-dispatch.yml` | `e281fcab…` | `9b0e3440…` | Schedule triggers commented out; fail-closed pause gate added |
| the other 10 | unchanged | unchanged | — |

Pre-change backup: `audit/pre-pause-backup-20260917T1100/` (workflow, queue, checksums of all five Titan files).

`scripts/cron-dispatch.ts`, `scripts/send-titan-smtp.ts`, `OUTREACH_TRACKER.md`, `scheduled-queue.json`, `.last-send-results.json` are **byte-identical**. Titan's send logic and send state were not touched.

## 3. How the pause is implemented

Repository-level, in the workflow only:

- The three `schedule:` cron triggers are **commented out**, with a banner stating the reason. GitHub cannot fire the workflow on a schedule. Resuming is uncommenting three lines.
- A **pause gate** step runs immediately after checkout — before `npm install`, before the dispatcher. It reads `OUTREACH_PAUSE.json` and exits non-zero when `paused` is true. Because a scheduled run supplies no `inputs`, the gate refuses such a run even if the schedule is restored while the marker still says paused.
- `workflow_dispatch` remains, so read-only investigation is still possible. `dry_run: true` passes the gate (it cannot send). A real send requires the new explicit input `acknowledge_stale_suppression: true`.
- `OUTREACH_PAUSE.json` records the decision beside the artifacts it governs, the same idiom as `database/CUTOVER_STATE.json`.

Nothing was deleted. No send state was modified. No email was sent and no SMTP connection was opened.

## 4. THIS IS NOT LIVE UNTIL PUSHED

The cron runs the **committed** workflow from GitHub. `origin/main` currently holds the *unpaused* workflow, and this branch is ahead of it by unpushed commits.

**Until this is pushed, GitHub will keep running the old schedule.** The pause is prepared and verified locally; it takes effect on the next push. Push outside a dispatch window and check the Actions tab first.

## 5. Verification

`npm run test:titan` — 80 assertions, including: the marker records the pause; no active cron line while paused; the gate precedes the dispatcher and fails fast; the gate refuses a no-input run and permits dry-run and acknowledged runs; the queue still holds its 5 entries; the ledger is present; neither `cron-dispatch.ts` nor `send-titan-smtp.ts` was modified. A vacuity check confirmed that re-enabling one cron line fails the suite.

---

# Second change (same day): ADR-010 publisher implemented

## 6. What changed

The suppression publisher now exists, so the workflow performs the full safety sequence before dispatch:

```
checkout → pause gate → install → publish suppression → verify artifact → dispatch → commit
```

Every step before dispatch fails the job rather than continuing. The dispatcher itself is unchanged.

## 7. Second protected hash change

| File | Baseline 09-17T1103 | Baseline 09-17T1118 | Why |
|---|---|---|---|
| `.github/workflows/outreach-dispatch.yml` | `9b0e3440…` | `9aabced6…` | publish + verify steps added before dispatch; the artifact is now committed alongside the queue and tracker |
| the other 10 | unchanged | unchanged | — |

`scripts/cron-dispatch.ts`, `scripts/send-titan-smtp.ts`, `OUTREACH_TRACKER.md`, `scheduled-queue.json` and `.last-send-results.json` remain byte-identical across both changes. Titan's send logic and send state have not been touched at any point.

Pre-change copy of the intermediate workflow: `audit/pre-pause-backup-20260917T1100/outreach-dispatch-after-publisher.yml`.

## 8. Still paused, for a different reason

The original cause (no publisher) is fixed. Dispatch stays paused because the publisher **has never run against production Postgres** and the production artifact has never been published or committed. `OUTREACH_PAUSE.json` now records `mechanismReady: true` and `productionArtifactPublished: false`.

Resuming is a human act, listed in that file's `unblockedBy`.

## 9. Two concrete defects fixed

- **The dashboard's suppression-freshness indicator was vacuous.** `os/server/services/operations.ts` compared the canonical list against itself, so it reported "outreach allowed" regardless of what the artifact contained. Post-cutover this was actively misleading. It now reads the artifact and classifies it with the real verifier.
- **Approving a research candidate threw.** `importApprovedCandidate` ended in an unconditional `throw` written for PRE_CUTOVER, but post-cutover `reviewCandidate` calls it — after already marking the candidate ACCEPTED and writing an audit event. The approval path was broken and left inconsistent state. It now builds the lead through the same factory the CSV migration uses and inserts it with the candidate resolution in one transaction.

Both have regression tests.
