# Approved production changes (2026-09-15)

## 1. Git reconciliation (non-destructive)
- **Backups first:** `audit/pre-pull-backup-20260915T0552/` holds the tracker, CSV, package.json, queue, the unpatched dispatcher and `uncommitted.diff`.
- **Sequence:** `git stash push -- OUTREACH_TRACKER.md kachmo_targets.csv package.json` → `git pull --ff-only origin main` (ee1b966 → e922b03) → `git stash pop`. The pop had no conflicts and the stash was dropped automatically.
- **Result:** local main equals origin/main; the Batch 6 edits are still uncommitted. Nothing committed or pushed.
- `leads:migrate --force` was **not** run. Every email-status decision reads OUTREACH_TRACKER.md live, and only display fields in the database are stale for 106–110.

## 2. Protected hash changes

| File | Original (09-14) | Post-pull | Post-patch | Why |
|---|---|---|---|---|
| scheduled-queue.json | 503aa7dc… | 80c34717… | 80c34717… (unchanged by patch) | git pull: cron commit e922b03 removed sent 106–110 |
| OUTREACH_TRACKER.md | 7bf15c0b… | 21275e42… | 21275e42… | git pull (106–110 → SENT) + restored uncommitted Batch 6 insertion |
| scripts/cron-dispatch.ts | 5890db39… | 5890db39… | 0a9f2ec0… | Approved suppression patch (+25 lines, 0 removed) |
| the other 8 | unchanged | unchanged | unchanged | — |

Baselines: `baseline-2026-09-14`, `baseline-2026-09-15T0553` (post-pull), then a post-patch baseline.

## 3. Dispatcher patch (applied, uncommitted)
The patch adds 25 lines to `main()`, immediately before and at the top of the queue loop:
- **Missing or malformed `database/suppression.json` → the run throws before anything is sent** (fail closed).
- Recipient email (any case), recipient domain or target number suppressed → skipped, not sent.
- OUTREACH_TRACKER.md row already `**SENT**`, `**FOLLOWED_UP**` or `**REPLIED_*`** → skipped, not sent.
- These checks run before `evaluateWindow`, so `--force` cannot bypass them.

Unchanged: EmailPayload, SMTP transport, the sendMail call, the time windows, the tracker update, the queue rewrite, and the workflow file.

## 4. Before this protects anything on GitHub
The cron runs the **committed** code with the **committed** `database/suppression.json`. Until both are committed and pushed:
- **The cron keeps running the old, unpatched code.**
- **If only the dispatcher is pushed without the suppression file, the cron fails closed and sends nothing.**

Push outside a cron run: check the Actions tab first.
