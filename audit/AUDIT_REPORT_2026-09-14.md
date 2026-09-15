# Kachmo Outbound Engine V2: Audit Report (2026-09-14)

## 1. Verdict: READY WITH CAVEATS

Research, the research queue, email follow-ups, suppression and outcome logging are safe to use tomorrow. The calling and WhatsApp queues are **empty on purpose**: every phone on file lacks a source.

Before anyone acts on email, you must fix the git state. `origin/main` already holds a cron commit that sent targets 106–110. The local `scheduled-queue.json` still lists them.

The previous implementation was **not** production-ready. It could wipe the lead database. It sent phones with no source into the call and WhatsApp queues. Its message templates were hard-coded with other prospects' names.

## 2. Inspected
- Git state: HEAD `ee1b966`, 1 behind origin, uncommitted work present.
- Protected Titan subsystem: scripts, workflow, queue, tracker.
- The CSV.
- Every V2 script.
- All data, queue and analytics files.
- The test suite.
- npm scripts and every CLI's error paths.
- A secrets scan of the working tree and git history.

## 3. Bugs found

| # | Sev | Problem | Why it matters | Fix | Test |
|---|---|---|---|---|---|
| 1 | CRITICAL | `safeReadJson` returned the fallback on a parse error. A corrupt `kachmo_leads.json` made `leads:qualify` write `[]` over the database (reproduced). A corrupt `suppression.json` silently disabled suppression. | Silent total data loss; opt-outs ignored | Parse errors now throw. Leads and suppression files must exist. `saveLeads` refuses to shrink the database. | G9, G10 |
| 2 | CRITICAL | Batch 6 phones (111–120) had no source (only the tracker row), yet went straight into the call and WhatsApp queues. `whatsapp_eligible=YES` was inferred from "India + phone". The old test asserted this as a feature. | Calling or WhatsApping numbers nobody has verified | Provenance taxonomy (§7). Queues require PUBLICLY_LISTED with a URL or VERIFIED with a basis. WhatsApp also requires a basis. Enforced by invariants on save. | G2, G3, G7, G8 |
| 3 | CRITICAL | Local email state is stale. The cron sent 106–110 at 14:41 UTC (`e922b03` on origin). Local `scheduled-queue.json` still has them. V2 said "10 scheduled for Tuesday". | Running `send:titan` or `dispatch:cron` locally would send 5 duplicate emails | The protected files can't be changed. The war room now alerts on behind-origin state, queue entries already SENT, and suppressed recipients still in the production queue. | G14 |
| 4 | HIGH | Templates hard-coded prospects: any hotel got "Royal Heritage Haveli's courtyard", any D2C brand got "Hi Akshay… Bombay Shirt Company", any realty got "Mr. Advani". There was also fabricated social proof ("luxury brands we partner with"). | Wrong-name messages; false claims | Messages are built from lead fields only, with no claims about Kachmo's past work | G7 |
| 5 | HIGH | Re-running `leads:qualify` un-disqualified suppressed and DNC leads | Opt-outs silently reversed | A central `outreachBlock` check inside qualification, plus a `do_not_contact` invariant | G9 |
| 6 | HIGH | `leads:migrate` could be re-run freely. It regenerated every lead_id and wiped call and outcome history. | Destroys all operational data; orphans events | Refused without `--force`. `--force` keeps lead_ids and human-entered fields and writes a backup. | G1, G15 |
| 7 | HIGH | `leads:dedupe` deleted records. Its name normaliser stripped "studio", "design" and "agency". | Destructive false merges | Now report or flag only, never delete. Only legal suffixes are stripped. | G12 |
| 8 | HIGH | Call and WhatsApp queues checked suppression by target number or phone only. Email and domain opt-outs were ignored. The opportunity step overwrote human notes. | Opt-out loopholes | One matcher covering lead_id, target, email (any case), phone (last 10 digits), normalised domain, DNC flags and tracker `REPLIED_NO` | G9 |
| 9 | HIGH | No bridge from a V2 opt-out to the production email queue; the cron never reads V2 suppression | Someone who opted out can still be emailed | `suppress:add` plus a war room warning when the recipient is in `scheduled-queue.json`. A real block needs a protected-file change (see recommendation 4). | G14 |
| 10 | HIGH | WhatsApp had no approved/sent state, and the `wa.me` link appeared before any review | Duplicate sends; human review bypassable | `whatsapp:log` enforces APPROVED → SENT and refuses a second SENT. The link appears only after approval. | G8 |
| 11 | HIGH | `calls:log` accepted any outcome. `MEETING_BOOKED` never set `meeting_status`, so analytics counted 0. Interested or booked leads stayed in the cold-call queue. No attempt cap. `--notes=a=b` was truncated. | Wrong data; repeat calls to hot or annoyed prospects | Validated outcome list, call-attempt history, max 3 unanswered attempts, 20-hour spacing, meeting/pipeline exits | G7 |
| 12 | MED | Gates 3, 4 and 8 passed on string length. Gate 5 passed with a UTC timezone. Gate 2 passed `info@`, `hello@`, `reservation@` and Gmail addresses with no source. `support@` DISQUALIFIED the company. | Qualification gave no real signal | Outcomes are PASS (sourced), UNVERIFIED, PENDING, UNKNOWN or FAIL (evidence). Missing data never produces FAIL. | G3 |
| 13 | MED | Score: the trigger was inside `kachmo_score`, so NO_CLEAR_TRIGGER dropped a 95 to 85 and researching was penalised. Substring keywords ("yc" in "bicycle", "pret" in "interpretation"). Keywords overfit to specific rows. Contact presence inflated the commercial score. A points floor meant 0 C-grade leads. 27 A+ leads. | Inflated, misleading priority | Urgency scored separately. Word-boundary signal categories. Unknown dimensions excluded. PROVISIONAL label instead of capping. Labelled HEURISTIC. | G4 |
| 14 | MED | Completeness gave free points and counted unsourced CSV text as known: 60–70% with zero sources | "Well researched" was false | Only sourced facts earn full credit. Scores are now 21–38%. | G5 |
| 15 | MED | Fabricated provenance at migration: a website visit dated 09-12 for every lead (including rows added 09-14); website "live" (some are Companies House pages); decision-maker confidence HIGH; invented deal values at MEDIUM confidence; "Indian founders convert faster by phone" stated as fact; every US lead given New York time; 6 leads in UTC | Plausible-looking false facts | Removed or relabelled. Timezones are never guessed for multi-timezone countries. | G2 |
| 16 | MED | Event log seeded with fake timestamps and fully rewritten on every append. Phone numbers in payloads. "Completed lifecycles = emails sent + wins". Wrong archetype names. `calls_completed` hard-coded to 0. | Misleading analytics; not immutable | Append-only `events.jsonl` with no contact values. Email funnel read from the tracker. Samples under n=20 shown as raw k/n. | G11, G14 |
| 17 | MED | Lead database writes had no backup (only the CSV was backed up); temp files not fsynced | No recovery path | Backup on every save, newest 30 kept, fsync + rename | G10 |
| 18 | MED | `leads:export-csv --write-production` could overwrite the protected CSV | Protected-file breach | Path removed and refused | G13 |
| 19 | MED | Tests wrote to the real `suppression.json` and queues, asserted brittle exact counts, and had 2 type errors | Tests corrupted real data and proved little | Suite rewritten: temp workspaces, invariants, regression tests | all |

## 4. Changes
- **Rewritten:** `scripts/lib/schema.ts`, `lib/safe-io.ts`, `migrate-csv-to-leads.ts`, `leads-qualify.ts`, `leads-score.ts`, `leads-opportunity.ts`, `leads-research-queue.ts`, `leads-enrich.ts` (now explicitly a gap inspector that researches nothing), `queue-calls.ts`, `queue-whatsapp.ts`, `call-log.ts`, `war-room.ts`, `analytics-weekly.ts`, `leads-dedupe.ts`, `leads-export-csv.ts`, `__tests__/run-tests.ts`
- **New lib modules:** `lib/contact.ts` (provenance + central suppression), `lib/store.ts` (the only DB writer), `lib/invariants.ts` (blocks impossible states), `lib/email-state.ts` (read-only tracker/queue view), `lib/geo.ts`, `lib/cli.ts`, `lib/text.ts`
- **New CLIs:** `leads:refresh`, `leads:record` (how humans record sources), `whatsapp:log`, `pipeline:log` (meeting → proposal → won/lost), `suppress:add`
- **Data:**
  - `database/kachmo_leads.json` regenerated with all lead_ids preserved.
  - Queues and markdown files regenerated.
  - `analytics/event-log.json` replaced by `events.jsonl`.
  - `DEV_DAILY_OUTREACH.md`, `conversion-data.json` and `objections.json` removed (merged into the war room / weekly report). Every pre-fix file is copied in `audit/baseline-2026-09-14/v2-data-snapshot/`.
- **Not mine:** the uncommitted edits to `OUTREACH_TRACKER.md` and `kachmo_targets.csv` (Batch 6, timestamped 18:56–19:19) predate V2. I left them untouched. Nothing committed.

## 5. Protected files: all 11 IDENTICAL (SHA-256 vs baseline taken before any change)
scheduled-queue.json `503aa7dc…2522` · batch4.json `a86a0a02…b609` · batch5.json `503aa7dc…2522` · OUTREACH_TRACKER.md `7bf15c0b…f5ac` · .last-send-results.json `43c7d96d…6da` · .env `c7840bf6…e6b` · kachmo_targets.csv `61431b75…89fe` · outreach-dispatch.yml `e281fcab…532` · create-titan-drafts.ts `9b70195f…6e0` · cron-dispatch.ts `5890db39…c11` · send-titan-smtp.ts `76261f2b…532`

**scheduled-queue.json unchanged: YES** (full hashes in `audit/baseline-2026-09-14/protected-checksums.txt`)

## 6. Migration reconciliation
- **CSV:** 120 real target rows, 001–120, contiguous. **"121" was the line count** (header + 120).
- **Canonical leads:** 120. Excluded: 0. Duplicates: 0. Company mismatches: 0.
- **Mapping:** 1:1. Row by row in `audit/baseline-2026-09-14/reconciliation.csv`.
- **Note:** committed HEAD has only 110 rows. Targets 111–120 exist only in the uncommitted CSV edit.

## 7. Contact provenance
Taxonomy: `UNKNOWN · INFERRED · UNVERIFIED · PUBLICLY_LISTED · VERIFIED · INVALID`. I added UNVERIFIED because the legacy data doesn't say whether a value was found or guessed. Calling it INFERRED would itself be a false claim.

**Can inferred or unverified contacts reach calling or WhatsApp? NO.** The rule is enforced in three places: eligibility functions, `saveLeads` invariants, and tests.
- **Phones:** 18 on file, all UNVERIFIED. 0 callable, 0 WhatsApp.
- **Emails:** shared mailboxes never pass Gate 2. The unsourced personal Gmail addresses (112, 113, 118) are blocked.
- **Boundary:** the production email pipeline is outside this enforcement.
- **Batch 6 warning:** all of 111–120 was added in one unsourced edit (phones, private Gmail addresses, revenue figures). I did not web-verify any of it. Treat it all as unverified until checked.

## 8. Tests
- **Before:** 30/30 passing, but brittle, and they wrote to real data.
- **After:** **138 passed, 0 failed.** Regression tests cover every bug above. Strict `tsc` is clean.

## 9. Architecture review
- **KEEP:**
  - JSON storage (120 leads, 0.7 MB; there is no concurrency bottleneck).
  - Strict separation from the Titan pipeline.
  - Human-only WhatsApp.
  - Commercial score kept separate from research completeness.
  - Markdown operating files.
  - The tracker as the email ledger.
- **FIX:**
  - All V2 data is untracked. Its only backups are on one laptop, and two operators will diverge.
  - The cron's commits to the tracker will conflict with local uncommitted tracker edits.
- **ADD:**
  - A suppression check inside the dispatcher (needs your approval).
  - A research-freshness flag (`research_last_verified_at` now exists).
  - Email follow-up logging once replies arrive.
- **REMOVE:**
  - Arch-5 (UK micro trades found via Companies House). No public contacts, mismatched to Kachmo's price band, and it uses registry personal data for cold outreach.
  - The "40 emails/day" cadence, which contradicts premium positioning.
  - Showing scores as precise 0–100 numbers (show the tier plus the matched signals).
- **WATCH:**
  - The heuristic score rewards dense copywriting in the research notes, not proven quality.
  - Reply rate is 0/20, but those emails are only 0–3 days old.
  - The generic-mailbox share (a large part of the email base).

## 10. Top 5 recommendations
1. **Fix git before any email action.** Commit or stash the Batch 6 edits, pull `e922b03`, and never send from a stale local queue. Impact high · effort 10 min · urgency **today**.
2. **Source the Batch 6 phones and emails before Aadi calls** (research queue #1–5, `leads:record`). Impact high · effort ~2h · urgency before the first call.
3. **Version or back up V2 data and pick one source of truth for two operators** (a private repo commit is enough). Impact high · effort low · urgency this week.
4. **Approve a ~20-line suppression check in `cron-dispatch.ts`** that skips recipients in `database/suppression.json`. It's protected, so I didn't touch it. Impact high (closes the last opt-out gap) · effort low · urgency before staging the next batch.
5. **Park Arch-5 and spend research time on the 20 provisional A/A+ leads** in Arch 1, 2 and 6. Impact medium-high · effort low · urgency this week.

## 11. Operational assessment for tomorrow
- **Dev:**
  - Pull first. The war room alert stays until you do.
  - Send the 5 Batch 1 follow-ups due today (listed in the war room).
  - Then work the research queue.
- **Aadi:**
  - The call list is empty by design. Spend the first hour finding public sources for the 111–120 numbers.
  - A number enters the call list as soon as it's recorded with a source URL.
  - Log every call.
  - Use WhatsApp only after someone agrees on a call (`--whatsapp-ok`).

## 12. Known limitations
- The score is an unvalidated heuristic.
- No web verification was performed.
- There's no file locking. Two commands writing at the same moment on one machine could lose a write; rare at this scale.
- Email state comes from the local tracker copy.
- The behind-origin check uses the last `git fetch`.
- Research task status is changed by editing the JSON.
- Scope recommendations are archetype defaults.
- Tests are not in CI.
- There is no `tsconfig.json`.
- WhatsApp's business-messaging rules and India's DPDP Act 2023 / UK GDPR apply to this data. Get proper advice before scaling.
