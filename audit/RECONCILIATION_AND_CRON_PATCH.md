# Git reconciliation plan + proposed cron suppression patch (NOT applied)

## A. Git state (inspected 2026-09-14, nothing executed)

| | |
|---|---|
| Local HEAD | `ee1b966` feat(outreach): replenish queue with targets 101-110 and stage Batch 5 |
| Missing locally | `e922b03` "Auto-dispatch: updated outreach queue & tracker [skip ci]" by Kachmo Outreach Bot, 2026-09-14 14:41 UTC |
| What it changed | `scheduled-queue.json`: removed 106–110 (5 left: 101–105). `OUTREACH_TRACKER.md` lines 144–148: 106–110 `SCHEDULED` → `SENT`, sent date 2026-09-14, follow-up due 2026-09-17 |
| Local uncommitted (pre-V2, not mine) | `OUTREACH_TRACKER.md`: +17 lines inserted after line 151 (new "Batch 6" table, targets 111–120 with phones). `kachmo_targets.csv`: rows 111–120 appended and a stray blank line removed. `package.json`: V2 npm scripts |
| Conflict? | **No.** The remote edits lines 144–148 and the local edit inserts after 151. A 3-way `git merge-file` simulation on temp copies gave 0 conflicts. The CSV and package.json are untouched remotely. `scheduled-queue.json` has no local changes. |
| Why a plain `git pull` fails | Git refuses to fast-forward while `OUTREACH_TRACKER.md` has uncommitted changes, so it must be stashed first. Untracked V2 files are not affected by the pull. |

### Safest sequence (run by a human; do NOT run `send:titan`, `draft:titan` or `dispatch:*`)
```bash
cd Clients/mails
mkdir -p ~/kachmo-pre-pull && cp OUTREACH_TRACKER.md kachmo_targets.csv package.json ~/kachmo-pre-pull/   # plain copies, belt and braces
git stash push -m "batch6 tracker+csv, v2 package.json" -- OUTREACH_TRACKER.md kachmo_targets.csv package.json
git pull --ff-only origin main          # fast-forward to e922b03; aborts rather than merging if anything is unexpected
git stash pop                           # expected: clean. If it reports a conflict the stash is KEPT: resolve by hand, then `git stash drop`
git diff --stat                         # expect the same 3 files as before
python3 -c "import json;print([x['targetNumber'] for x in json.load(open('scheduled-queue.json'))])"   # expect ['101'..'105']
npm run email:check-queue               # expect no blocking issues
npm run audit:baseline                  # record the NEW protected hashes (scheduled-queue.json + tracker legitimately changed via git)
npm run leads:migrate -- --force && npm run leads:refresh && npm run war-room && npm test
```
Then commit deliberately. Batch 6 + V2 code are one commit; whether `database/` is committed is a separate decision (it contains prospect contact data).

**Push timing.** The workflow commits and pushes at the end of each run without `git pull --rebase`. If you push while a run is in flight, the bot's push is rejected after the emails have already gone out. The queue then isn't trimmed, and the next window re-sends. Don't push Mon–Thu while a run may be active. The cron slots are 08:00, 13:30 and 16:30 UTC, but GitHub delayed today's 13:30 run to 14:41, so check the Actions tab first.

## B. Suppression → email gap

How the dispatcher works (`scripts/cron-dispatch.ts`, read-only inspection):
1. Reads `scheduled-queue.json` only. It never reads the tracker or anything in `database/` before sending.
2. For each entry it checks the local morning window (`--force` skips this), sends via SMTP, then rewrites that tracker row to SENT.
3. Writes the unsent remainder back to `scheduled-queue.json`. The workflow commits both files and pushes.

It runs on GitHub from the **committed** tree. `database/suppression.json` is untracked, so the cron can't see it even in principle.

**Upstream-only enforcement (no Titan change):** now implemented.
- `npm run email:check-queue` is read-only and exits 1 on a suppressed recipient, an entry already marked SENT, or a duplicate entry.
- The war room shows the same issues as alerts.
- `suppress:add` warns when the recipient is still queued.

The limit: all of these depend on a human running them **before pushing** a staged batch. An opt-out that arrives *after* a batch is pushed is only caught if someone edits the queue and pushes again before the next cron slot. Upstream checks reduce the risk; only a check inside the dispatcher removes it.

### Minimal patch (requires approval; prerequisites first)
Prerequisite: commit `database/suppression.json`. Without it the patched cron fails closed and sends nothing. The file contains opted-out people's emails and phones, which is acceptable in a private repo.

```diff
@@ scripts/cron-dispatch.ts (after function sleep)
+/** Fails closed: a missing or unreadable suppression list aborts the whole run. */
+function loadSuppressed(): { emails: Set<string>; domains: Set<string>; targets: Set<string> } {
+  const p = path.resolve(process.cwd(), 'database/suppression.json');
+  if (!fs.existsSync(p)) throw new Error('database/suppression.json missing — refusing to send');
+  const list: Array<{ email?: string; domain?: string; target_number?: string }> = JSON.parse(fs.readFileSync(p, 'utf-8'));
+  const host = (s?: string) => (s ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
+  return {
+    emails: new Set(list.map(e => (e.email ?? '').trim().toLowerCase()).filter(Boolean)),
+    domains: new Set(list.map(e => host(e.domain)).filter(Boolean)),
+    targets: new Set(list.map(e => e.target_number ?? '').filter(Boolean)),
+  };
+}
@@ main(), immediately before `for (const email of queue) {`
+  const suppressed = loadSuppressed();
+  const trackerPath = path.resolve(process.cwd(), 'OUTREACH_TRACKER.md');
+  const trackerLines = fs.existsSync(trackerPath) ? fs.readFileSync(trackerPath, 'utf-8').split('\n') : [];
@@ first lines inside `for (const email of queue) {` (before evaluateWindow, so --force cannot bypass it)
+    const to = email.to.trim().toLowerCase();
+    if (suppressed.targets.has(email.targetNumber) || suppressed.emails.has(to) || suppressed.domains.has(to.split('@')[1])) {
+      console.log(`Target #${email.targetNumber} ⛔ suppressed — dropped, not sent`);
+      continue;
+    }
+    const row = trackerLines.find(l => l.includes(`| **${email.targetNumber}** |`) && /\*\*(SENT|FOLLOWED_UP|REPLIED_\w+)\*\*/.test(l));
+    if (row) {
+      console.log(`Target #${email.targetNumber} ⛔ already sent per OUTREACH_TRACKER.md — dropped, not sent`);
+      continue;
+    }
```
- About 20 lines, no new dependencies, and the `EmailPayload` interface, SMTP code and window logic are untouched.
- Dropped entries are removed from the queue on the next run that sends anything.
- A test: `dispatch:dry` with a suppressed entry should print the ⛔ line.

**Why it's necessary:** the dispatcher is the only code that runs between staging and sending, unattended, on GitHub. Nothing on a laptop can intervene.

**Optional second protected change (workflow):** add `git pull --rebase` before `git push` in `outreach-dispatch.yml`. This closes the push-race duplicate described above.
