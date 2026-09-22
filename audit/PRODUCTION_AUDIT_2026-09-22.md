# Outbound OS — Hostile Production Audit (2026-09-22)

> **Question asked:** "Find the things that could eventually hurt us."
> **Base:** `main` = `origin/main` = `83442dc` (deployed to Vercel project `os`, deployment `dpl_9NdiN2SMJiwswDFosJF43bXADugo`).
> **Method:** every execution path traced in code (not from docs); the live committed data loaded into in-memory
> Postgres and put through the real services; GitHub Actions run logs read (read-only); Vercel project and
> deployments read (read-only). **No production database was read or written, nothing was sent, no protected Titan
> file was changed.**
> **Companion documents:** [`docs/OPERATOR_EXPERIENCE.md`](../docs/OPERATOR_EXPERIENCE.md) (the UX audit and the new
> operator workflow), [`docs/DESIGN_LANGUAGE.md`](../docs/DESIGN_LANGUAGE.md), [`docs/REDESIGN_PLAN.md`](../docs/REDESIGN_PLAN.md).

---

## 0. Summary

The backend is in better shape than most systems of its age. Canonical lead writes are genuinely safe: one
transaction under a single advisory lock, a row lock, an optimistic version check, suppression re-read inside the
transaction, a field-ownership check, invariants, a revision row and an audit row, all or nothing. History tables are
append-only **in the database**. Contact values are masked on the server. Role checks run on every page and action. I
found **no way for the application to contact a suppressed person, no way to bypass a qualification gate, and no
IDOR**.

What can hurt this business right now is almost entirely **outside the write path**:

1. **Automated email has silently sent nothing for a week, and every run reports success** (§1, A1). This is the most
   consequential finding and no test models it.
2. **The interface presents unverified research as fact on every one of the 120 leads** (B1). An operator can repeat
   an unverified claim to a prospect.
3. **Operator mistakes are easy and silent.** Forms default to consequential values. A second click after success
   records the event twice. "Do not contact" is one click. Errors crash the page and lose what was typed (C1–C6).
4. **The interface explains the system instead of the work.** Engine identifiers, file names, CLI commands and phase
   names are the primary content (see the UX audit).

Severity scale: **S1** can cause wrong or no outreach now · **S2** real failure under a plausible condition ·
**S3** correctness or UX-safety defect · **S4** hardening, maintainability, documentation.

| # | Finding | Sev | Status after this work |
| :-- | :-- | :-: | :-- |
| A1 | Automated dispatch starved since 2026-09-15; green runs, no alert | **S1** | **Surfaced in the app**; fix needs owner approval (protected files) |
| A2 | One opt-out on a queued lead halts *all* automatic email; message says otherwise | S2 | Fixed (message + Today alert) |
| A3 | Ledger "Sent date" is a *planned* date for unsent rows; shown as "Sent on" | S3 | Fixed |
| A4 | The app cannot show what will be sent | S3 | Fixed (read-only preview) |
| A5 | Email state in the app is frozen at deploy time, with no as-of time | S3 | Mitigated (as-of time shown); structural fix recommended |
| A6 | Dispatch ledger commit is skipped when the run is *cancelled* | S4 | Recommended (protected file) |
| A7 | Maintenance workflow interpolates free-text inputs into shell | S4 | Fixed |
| A8 | Pause marker and workflow header say "paused" while live | S4 | Recommended (protected files) |
| B1 | Unverified research rendered as fact (120/120 leads) | S2 | Fixed |
| B2 | Invented "why" text on the Research page | S3 | Fixed |
| B3 | "Approved, queued for import" candidates cannot be imported from the UI | S4 | Copy fixed; action recommended |
| C1 | Consequential form defaults (call, stage, **Approve**) | S2 | Fixed |
| C2 | Second click after success records a duplicate (reproduced) | S2 | Fixed |
| C3 | "Do not contact" is one click, no confirmation, no consequences stated | S3 | Fixed |
| C4 | Blocked leads not flagged prominently; call form shown without warning | S3 | Fixed |
| C5 | No error, loading or not-found states; expired session in a form crashes the page | S3 | Fixed |
| C5b | “Try again” on the error screen did not retry — `reset()` replays the cached failure | S3 | Fixed |
| C6 | Malformed ids reach Postgres → 500 (reproduced) | S3 | Fixed |
| C7 | A refused submit wipes everything typed (React resets form actions before they run) | S3 | Fixed |
| D1 | Gate labels mismatched: 2 of 8 keys match (reproduced) | S3 | Fixed + test |
| D2 | "187 actions recorded" badge; same counts shown 3× on Today | S3 | Fixed (redesign) |
| D3 | Inventory shortfall ranked "critical" above replies and follow-ups | S3 | Fixed (redesign) |
| D4 | History omits emails; shows 240 system re-scoring events | S4 | Fixed |
| D5–D6 | Raw enums, file names, env vars and CLI commands in operator copy | S4 | Fixed (redesign) |
| D7 | Contact source text and call notes not scrubbed for masked roles | S4 | Fixed |
| E1 | Whole database loaded 2–3× per request; layout swallows DB errors | S3 | Fixed |
| E2 | No connection/query timeout on the database pool | S3 | Fixed |
| E3 | `revalidatePath` targets a route that doesn't exist | S4 | Fixed |
| F1 | Research writes bypass the write kill switch (documented decision) + `.env.local` targets production | S4 | Recommendation |
| F2 | CSP `script-src 'unsafe-inline'` | S4 | Recommendation (unchanged) |
| G | Tests are strong on invariants, blind to presentation, forms, failure paths and the dispatcher's timing | — | Tests added |
| H | Most of `docs/` describes a different, never-built system | S4 | Banner + current index |

---

## 1. Outreach, dispatch and the Titan boundary

### A1 — Automated dispatch has delivered nothing since 2026-09-15, and reports success · **S1 · CONFIRMED**

**What happens.** `scripts/cron-dispatch.ts` sends a queued email only when the recipient's local time is inside
07:30–11:30 on a weekday (`evaluateWindow`, lines 111–161). The workflow is scheduled at `0 8`, `30 13` and `30 16`
UTC. GitHub runs the schedules hours late, consistently:

| Scheduled (UTC) | Actually ran (UTC), every day since 09-15 | London local at run time |
| :-- | :-- | :-- |
| 08:00 | ~12:59–13:05 | ~14:00 — past the window |
| 13:30 | ~17:40 | ~18:40 — past the window |
| 16:30 | ~19:40 | ~20:40 — past the window |

The five queued emails (101–105) are all London/Amsterdam. Every run logs `Past morning window … Held for future
window: 5 … No emails currently in their local morning window. Holding queue.` and exits 0.

**Evidence** (read-only `gh run view --log`): runs `35224345997`, `35266938878` (09-17), `35614529750`,
`35641207169`, `35651381332` (09-21), `35730852946` (09-22). All green. `origin/main` has no bot commit since
`e922b03` (2026-09-14, the last successful send, of US targets 106–110 at 14:41 UTC = 10:41 New York).

**Why it hurts.**
- A week of outreach has not happened, and nothing says so. The Actions tab is all green.
- `OUTREACH_TRACKER.md` rows 101–105 read `2026-09-15 | 2026-09-18 | **SCHEDULED**`, i.e. a "sent date" and a
  "follow-up due" date in the past for emails never sent. A person reading the ledger reasonably concludes they went
  out and are due a follow-up (see A3).
- The copy of those emails was written for "Tue ~9:00 AM"; it is now stale.

**Why no test caught it.** Every dispatcher test runs with `--force`/`--dry-run` or a fixed clock. Nothing models the
gap between *scheduled* and *actual* start time, and nothing alerts on a queue entry that is older than its plan.

**Recommendation (owner decision: these are protected Titan files).**
1. **Make a stuck queue fail loudly.** The dispatcher should exit non-zero (a red run, which GitHub emails about) when
   any queued entry is more than one working day past its planned date. A green run must mean "sent, or legitimately
   waiting". This alone would have surfaced A1 on 2026-09-16.
2. **Run often enough that a late start still lands in a window.** GitHub's scheduler is late by hours at busy times
   (the top of the hour is the busiest), and the lateness is not predictable, so pick off-peak minutes and cover each
   window more than once — e.g. `17,47 6-9 * * 1-5` (06:17–09:47 UTC = 07:17–10:47 London in summer time, 08:17–11:47
   Amsterdam) and `17,47 11-14 * * 1-5` (11:17–14:47 UTC = 07:17–10:47 New York in daylight time). Re-derive the
   hours when the clocks change. Repeats are safe: the concurrency group serialises runs and the ledger's `**SENT**`
   marker makes a second run skip what the first sent.
3. Re-review the five held emails' copy and timing before they go out.

**Done in this work (no protected file touched):** the app now derives *stuck* scheduled emails from data it already
has (queued entries whose ledger date is in the past and still `SCHEDULED`) and puts them at the top of Today and on
the Emails page, in plain words, with the planned date and age.

### A2 — One opt-out on a queued lead halts all automatic email · **S2 · CONFIRMED**

`dispatch-preflight.ts` refuses the **whole run** when any queued entry is blocked (line 86). That is the right
fail-closed choice. But the app's success message after recording an opt-out says only *"Still queued for email:
103 — the dispatch preflight will refuse to send them"*. It does not say that the other queued emails are now held too,
or that someone must remove the entry from `scheduled-queue.json`. Reproduced: suppressing only 103 turns the verdict for all 5 from
`ok` to `refused`.

**Fixed:** the opt-out confirmation states the consequence before it is recorded. The result states it again after.
Today shows "Automatic email is on hold" with the reason whenever the in-app preflight (the same pure
`evaluateDispatchPreflight`) would refuse.

### A3 — "Sent date" is a planned date for unsent rows · **S3 · CONFIRMED**

The tracker's date column holds the *planned* date for `SCHEDULED`/`DRAFTED` rows. The lead page rendered it as
"Sent on", and the Email page as "Sent Date". **Fixed:** the date is labelled by status ("Planned for" vs "Sent").

### A4 — The app cannot answer "what are we going to send?" · **S3**

`core/email-ledger/tracker.ts#scheduledQueueFromJson` keeps target, recipient and company only. The subject and body
sitting in `scheduled-queue.json` are never shown. **Fixed:** `os/server/repo/titan-ledger.ts` now also reads the subject
and plain-text body for display. It reads nothing else, writes nothing, and never renders the HTML part. Recipients
stay masked for roles without contact access. core is unchanged.

### A5 — Email state is frozen at deploy time · **S3**

The deployed app reads `OUTREACH_TRACKER.md` and `scheduled-queue.json` from files traced into the build
(`next.config.mjs` `outputFileTracingIncludes`). A send or follow-up made after the deploy is invisible until the next
deploy, and nothing on screen says how old the email state is. The Titan send tools guard against actual
duplicates using their own ledger, so this misinforms rather than double-sends. **Mitigated:** every email-state
surface now shows "Email records as of <deploy time>". **Structural fix (recommended, not done):** read the ledger
at request time from the GitHub API (read-only token), or have the dispatcher publish ledger rows to Postgres. Either
is a design change to the Titan boundary and needs an owner decision.

### A6 — Ledger commit skipped when a dispatch run is cancelled · **S4**

`outreach-dispatch.yml`'s commit step runs only for `success`/`failure`. A run **cancelled** mid-send (manual cancel)
leaves sent emails unrecorded, so the next run could resend. Narrow window. **Recommendation:** include
`steps.dispatch.outcome == 'cancelled'`. Protected file, not changed.

### A7 — Script-injection pattern in the maintenance workflow · **S4**

`maintenance-jobs.yml` interpolates `${{ inputs.limit }}` (free text) and `${{ inputs.job }}` directly into the
`run:` line, with `DATABASE_URL` in the environment. That is the exact pattern the 2026-09-18 audit (#14) removed from the
dispatch workflow. Only repository writers can dispatch it. **Fixed:** inputs pass through `env:` and are validated.
The schedule stays commented out.

### A8 — Stale "paused" statements · **S4**

`OUTREACH_PAUSE.json` has `"paused": false` but its `reason`/`note` still say the pause is in force. The dispatch
workflow's header block says "AUTOMATED DISPATCH IS PAUSED" above live cron lines. Anyone reading either file to
learn the system's state is misled. **Recommendation:** update both in the next reviewed commit to those files.

---

## 2. Research and truthfulness

### B1 — Unverified research presented as fact · **S2 · CONFIRMED (120 of 120 leads)**

Methodology v1.0 defines `UNVERIFIED` as *"claim on file but no source recorded — does not block, but must not be
stated as fact"*. Every migrated lead's commercial-proof gate is `UNVERIFIED` (legacy research carries no URL
sources, see Phase B finding 1). Yet the lead page's first panel, "Why We're Looking At Them", printed
`commercial_validation_signal` in bold. For lead 101: *"BBC, Nike, Apple, Proenza Schouler, Ministry of Sound,
Unit Editions publisher"*. Friction, trigger and decision-maker were stated the same way, and the call card repeats
them as "Why them". An operator preparing a call would reasonably repeat them.

**Fixed:** every research claim on an operator surface carries its verification state, derived from the gate
outcome and claim evidence the engine already computes. The states are **Checked** (a person matched it to a
source), **Source recorded, not checked**, and **No source**, with one line saying what that means ("don't quote this as
fact"). No engine value changed.

### B2 — Invented explanations · **S3**

The Research page's cards carried a hard-coded "why" chosen by a boolean ("Contact routes exist, but further evidence
verification is needed."). That is narrated reasoning, which the system forbids elsewhere. **Fixed:** replaced by
the engine's own open tasks for that lead.

### B3 — Approved candidates that nothing can import · **S4**

The Research page lists ACCEPTED-but-unresolved candidates as "queued for canonical import". After cutover no UI
calls `importApprovedCandidate` (it is dead code, as is `listSuppression`). Any pre-cutover approvals are stranded.
Production has no research candidates today, so the impact is zero for now. **Copy fixed. Recommendation:** an owner action or CLI to
import or re-review them.

---

## 3. Human error

The dangerous actor in this system is not an attacker. It is a busy person clicking the wrong thing.

### C1 — Consequential defaults · **S2**

| Form | Default | Effect of one stray submit |
| :-- | :-- | :-- |
| Log call | `NO_ANSWER` | a call attempt is recorded; three of them stop calling the lead |
| Record stage | `REPLIED_POSITIVE` | the lead is marked as having replied positively |
| Candidate review | **`ACCEPT` (Approve)** | **a new canonical lead is created** (guarded by `approvalRefusal`, but still a lead nobody chose) |

**Fixed:** no consequential default anywhere. The operator must choose, the server already refuses an empty choice,
and each choice states its consequence before submit.

### C2 — A second click after success records the event twice · **S2 · REPRODUCED**

The optimistic version check makes a *network retry* safe: the stale version is refused. After a *successful* submit,
though, the page re-renders with the new version and React resets the form to its (consequential) defaults. A second
click, the natural reaction when an operator isn't sure it worked, records a second identical event. Reproduced
with the pipeline form: two `REPLY_RECEIVED` events for one reply. **Fixed:** a successful submit replaces the form
with a confirmation of what was recorded. Recording another requires an explicit "Record another".

### C3 — "Do not contact" is one click · **S3**

The opt-out is effectively irreversible from the app: revocation is OWNER-only and has no UI. It was a single button
with a required reason, and `DO_NOT_CONTACT`/`OPT_OUT` sit in the same dropdowns as "no answer". A mistaken opt-out
fails safe (nobody is contacted), but it silently halts all automatic email (A2) and is hard to undo. **Fixed:** a
two-step confirmation naming what happens (every channel; queue impact; who can undo it), and a stop warning when
the call outcome or WhatsApp status is the opt-out.

### C4 — Blocked leads not flagged where it matters · **S3**

The red "must not be contacted" notice used the suppression-list match only. A lead blocked by `do_not_contact`, a
`REPLIED_NO` status or the ledger showed only a small badge. The call form still rendered: core deliberately records a
call that did happen, which is correct, but there was no warning. **Fixed:** one stop banner driven by the full outreach
block and its reason. The call form on a blocked lead is labelled as recording a call that already happened.

### C5 — No error, not-found or loading states · **S3**

There was no `error.tsx`, `not-found.tsx`, `loading.tsx` or `global-error.tsx`. So:
- a database outage, a permission denial reached by URL, or any thrown error rendered Next's generic "Application
  error" page;
- a session that expired while a form was open made the server action **throw**, replacing the page and losing what
  the operator had typed;
- navigation to a slow page showed nothing.

**Fixed:** error, not-found and loading boundaries in operator language. Every server action converts a missing
session, a denied permission or an infrastructure failure into a message the form shows, and says honestly
whether anything was recorded. When the database fails mid-commit the outcome is unknown, and the message says to
reload and check before retrying. The version guard makes that retry safe.

**C5b — the first version of this fix did not actually recover.** Found by stopping the verification database,
loading a page, restarting the database and clicking the button: the error screen stayed. `reset()` re-renders the
boundary against the *cached* failed payload — it is not a retry. An operator would have concluded the app was still
down after it had recovered. The page boundary now runs `router.refresh()` and `reset()` in one transition (and shows
"Trying…" while it works, so a second click cannot pile up); the root boundary reloads the document, because what
failed there is the layout — including the session lookup — and there is no healthy tree to reset into. Both paths
were then re-verified in the browser, the page one proven to recover client-side by a `window` marker that survived.

Two properties worth recording from that outage, both verified rather than assumed:
- Better Auth **throws** `FAILED_TO_GET_SESSION` when the database is unreachable; it does not return "no session".
  So a database outage never becomes `redirect('/login')`. The operator is never told they are signed out when the
  truth is that the database is down — zero login redirects in the server log during the outage.
- The reference number on the error screen is Next's error `digest`, and it matched the digest in the server log
  exactly, so the code an operator reads out is genuinely traceable.

### C6 — Malformed ids reach Postgres · **S3 · REPRODUCED**

`/research/candidates/not-a-uuid` → `invalid input syntax for type uuid` → 500. The merge target in the review action
had the same gap. **Fixed:** UUIDs are validated before any query; a bad id is a 404 or a form error.

### C7 — A refused submit wipes what was typed · **S3 · CONFIRMED in React's source**

Every form was a React form action (`<form action={…}>`). React calls `requestFormReset` *before* such an action runs
(`react-dom-client`, `startHostTransition`), whatever the result. So when the server refused a submission, every field
was cleared: a research record with a long source URL and basis, a pasted research report, a candidate note, even the
sign-in email. The operator had to retype everything to correct one field, and the natural response to an emptied form
("it didn't take") is to give up or guess. **Fixed:** every form submits through a transition (`onSubmit` +
`startTransition(dispatch)`), which does not reset. A refusal keeps the input, and success replaces the form with what was
recorded (C2). A test forbids form actions in these components.

---

## 4. Presentation correctness

- **D1 · S3 · reproduced.** `presentation.ts` `GATE_LABELS` keys (`gate_1_commercial_proof`, `gate_7_decision_maker`, …)
  do not match core's gate keys (`gate_1_decision_maker`, `gate_3_commercial_proof`, …). Only 2 of 8 match, so six
  gates showed raw identifiers on the lead page and Inventory. The danger is the obvious "fix": relabelling by
  position would mislabel them. A second, correct table already existed in `leads.ts`. **Fixed:** one table,
  pinned by a test to exactly core's gate keys.
- **D2 · S3.** Today's badge "N actions recorded" summed overlapping counts (187 with the current data). The same counts
  appeared up to three times (attention list, work list, channel cards, stats).
- **D3 · S3.** "Segments below inventory threshold" was ranked *critical*, first, above replies and follow-ups.
  "Leads with open research tasks: 120" is every lead. Neither is today's work.
- **D4 · S4.** A lead's history showed the 240 migrated `QUALIFICATION_CHANGED` system events and audit rows, but not
  the email that was sent to them.
- **D5/D6 · S4.** Raw enums (`PUBLICLY_LISTED`, `REPLIED_POSITIVE`, `gate 1 decision maker`), file names
  (`OUTREACH_TRACKER.md status: SENT …`), environment variables (`KACHMO_APP_WRITES is not "on"`) and CLI commands
  (`npm --prefix os run leads:reevaluate`, `actor:bind`) were operator-facing copy.
- **D7 · S4.** For roles that may not see contact values, the contact's `source`/verification text and call notes were
  rendered unscrubbed. The value itself was masked.

All fixed; see the UX document.

---

## 5. Reliability and performance

- **E1 · S3.** The layout called `loadCanonical()` (every lead, every suppression entry, every analytics event) just
  to print the phase, and swallowed any error. Each service then loaded it again: three full loads for Today, plus
  duplicate queue computation. That's fine at 120 leads, but it grows with every event. **Fixed:** the layout derives the phase
  from configuration (no database read). Pages load one request-scoped snapshot and pass it to every service.
- **E2 · S3.** The `pg` pool had no `connectionTimeoutMillis` and no query timeout. An unreachable or saturated
  database hung a request until the platform timeout, with no loading state. **Fixed:** bounded connect and query
  timeouts. Failures surface in seconds as the new error state.
- **E3 · S4.** Actions revalidated `/leads/<uuid>`; the route is `/leads/<target number>`. It was harmless only because pages
  are `force-dynamic`. **Fixed.**

---

## 6. Security

What holds (verified in code):
- **AuthN:** Better Auth, invite-only, database sessions (no cookie cache), deactivation effective immediately, rate
  limits in Postgres, origin/CSRF checks on, hashed-IP audit of failures.
- **AuthZ:** deny by default; roles read from `user_role` on every request; every page and every server action calls
  `requirePermission` (pinned by tests); client components make no permission decisions.
- **No IDOR:** there is no per-user data ownership by design (a small trusted team). Every object read is role-gated,
  and contact values are masked server-side for INTERN/VIEWER, including inside core's task text.
- **Write safety:** kill switch; a development server can never write a hosted database; optimistic versions; single
  advisory lock; ownership table; invariants; append-only triggers; audited refusals.
- **Evidence fetcher:** SSRF-guarded, robots-aware, bounded.

Residual:
- **F1 · S4.** `os/.env.local` points at the **production** database, and by ADR-027's stated scope research
  writes (briefs, uploads, non-import review decisions) bypass the kill switch. A developer running `next dev` locally
  can therefore create research rows in production. **Recommendation:** point `.env.local` at a Neon development
  branch, or extend the host rule in `writeRefusal` to research writes. I did neither: it is a documented owner
  decision, and I also never ran the app against that file. Local verification used an isolated worktree with no
  `.env.local` at all (see the redesign plan).
- **F2 · S4.** CSP allows `script-src 'unsafe-inline'` (a TODO in `next.config.mjs`). Nonce-based CSP is the next hardening step.

---

## 7. Tests: what they protect, and what they don't

**Strong:** golden parity for Methodology v1.0 (read and write paths), the Postgres applier against the goldens,
concurrency on real Postgres, append-only triggers, RBAC and masking, suppression publish and preflight, the migration
rehearsal. Baseline at the start of this work: **root 776 passed / 0 failed, os 1085 passed / 0 failed.**

**Blind spots (each allowed a finding above):**
1. **The dispatcher's real timing.** No test models a late-starting run or an entry past its planned date. Every test
   bypasses the time window (A1).
2. **Presentation.** No test compared UI label tables to core's keys (D1), or asserted that an `UNVERIFIED` claim is
   never rendered as fact (B1).
3. **Forms and human error.** No test of defaults, double submission, or confirmation of destructive choices
   (C1–C3).
4. **Failure paths.** No test of an action under an expired session, a denied permission or a database error (C5), or
   of malformed ids (C6).
5. **Text-matching tests.** `tests/shell.ts` pins implementation text: that the layout *mentions* `phaseBanner`, that the email page
   *contains* the word "Read-only". Those pass while behaviour is wrong, and fail on harmless refactors. They are still
   useful as tripwires. The new tests assert behaviour.
6. **No browser test at all.** Nothing renders a page.

The tests added in this work are listed in [`docs/REDESIGN_PLAN.md`](../docs/REDESIGN_PLAN.md) §5.

---

## 8. Documentation

`docs/START_HERE.md`, `ARCHITECTURE.md`, `DATA.md`, `WORKFLOW.md` and most of `docs/` are labelled "Canonical &
Active". They describe a different system that was never built: Google Sheets as the database, Gemini, Playwright,
"never build custom web dashboards". `os/README.md` still says "Not deployed yet" and "No real data has been
migrated". **Fixed:** a banner on `START_HERE.md`, a current-documents index in `docs/README.md`, and a corrected
status line in `os/README.md`. The historical documents are kept, since they are the record of how the project began.

---

## 9. Deliberately not changed

| Not changed | Why |
| :-- | :-- |
| `cron-dispatch.ts`, `outreach-dispatch.yml`, `scheduled-queue.json`, `OUTREACH_TRACKER.md`, `OUTREACH_PAUSE.json` | Protected Titan files; changing send behaviour is an owner decision (A1, A6, A8 are recommendations) |
| `core/` (Methodology v1.0) | Golden-pinned. Every UX fix is presentation over values core already computes |
| Database schema | No finding needs a migration |
| Single-writer ownership, kill switch, append-only triggers, advisory lock | They work. The audit found them sound |
| Email approval inside the app | It would create a second send path. Titan owns email (ADR-009/010). The app shows what will be sent and how to stop it |
| Research-write scope of the kill switch | ADR-027 decision (F1 is a recommendation) |
| Suppression revocation UI | Explicit non-goal. Revocation stays an OWNER act with a reason |
