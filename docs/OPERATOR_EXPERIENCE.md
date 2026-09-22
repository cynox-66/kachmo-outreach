# Outbound OS — The Operator Experience

> **Status:** Adopted 2026-09-22 · implemented in the same change set
> **Companions:** [`audit/PRODUCTION_AUDIT_2026-09-22.md`](../audit/PRODUCTION_AUDIT_2026-09-22.md) ·
> [`DESIGN_LANGUAGE.md`](DESIGN_LANGUAGE.md) · [`REDESIGN_PLAN.md`](REDESIGN_PLAN.md) · ADR-035, ADR-036

The Outbound OS was an interface for engineers operating a lead-management system. This document redesigns it into a
tool a non-technical person can use to find, understand, approve and manage Kachmo's outreach. It does that without
losing any of the inspection power the system has earned.

**Principle: simple by default, complete on request.** Nothing technical is deleted. It moves one deliberate click
further away, under a label that says what it is.

---

## 1. Who operates this, and what they need

| Person | What they do here | What they must never have to understand |
| :-- | :-- | :-- |
| **Dev** (owner, email, approvals) | Replies and follow-ups, approving new companies, deciding who to contact | Cutover phases, stores, engine actors, file names |
| **Aadi** (calls, WhatsApp) | Calls, WhatsApp drafts, recording what happened | Provenance enums, gates, evidence levels |
| **A future researcher or intern** | Finding facts and sources, uploading research | Anything about the database or Titan |

Every screen answers some of seven questions. Nothing on a primary screen should answer a question nobody asked.

| # | The operator's question | Where it is answered |
| :-: | :-- | :-- |
| 1 | What needs my attention? | **Today**: one ordered list, in sentences |
| 2 | Which companies are ready? | **Companies**: plain status, "Ready to contact" filter |
| 3 | Why are we considering this company? | Company page → **Why them**, each claim marked checked / not checked |
| 4 | Who are we contacting? | Company page → **Who**, with "can we contact them?" answered in words |
| 5 | What are we going to send? | Company page → **What we'll send**; **Emails** page previews |
| 6 | What happens if I approve it? | Every approval and record action states its consequence *before* the button |
| 7 | What happened previously? | Company page → **History**: emails, calls, replies, decisions; system changes on request |

---

## 2. UX audit of the previous interface

Specific problems found by using every screen with the real 120-lead data. The fix column refers to §3–§6.

### 2.1 Terminology the operator cannot be expected to know

| Shown | Where | Replaced with |
| :-- | :-- | :-- |
| "The JSON store is frozen evidence and is never written again. Email send state still belongs to Titan." | first sentence of **Today** | nothing (true, but not the operator's concern). An abnormal store state becomes a banner only when it matters |
| "read from Postgres", "postgres · post cutover" | leads header, sidebar on every page | removed from operator views; kept in **System → Settings** |
| `OUTREACH_TRACKER.md status: SENT on 2026-09-11 · follow_up_due: 2026-09-14` | every Today card, labelled "ACTION:" | "Emailed 11 Sep. The one follow-up was due 14 Sep (8 days ago)." |
| `PUBLICLY_LISTED`, `UNVERIFIED`, `INFERRED` | contact badges | "Published by them", "Source unknown", "Guessed — don't use" |
| `REPLIED_POSITIVE`, `MEETING_BOOKED`, `NONE` | pipeline stage | "Replied — interested", "Meeting booked", "Not contacted" |
| "gate 1 decision maker", "gate 3 commercial proof" | qualification section (a label bug, D1) | "Named decision-maker", "Proof they buy this kind of work" |
| "Recording is unavailable: Application writes are switched off (KACHMO_APP_WRITES is not "on")" | under every form | one banner: "Recording is switched off. You can look at everything; changes can't be saved yet." The variable name lives in Settings |
| "Run `npm --prefix os run leads:reevaluate`", "Ask an owner to run `actor:bind`" | lead page, form errors | "This company's scores are out of date — an owner needs to refresh them." Commands live in Settings |
| "Arch-1", "Candidate", "Evidence level URL_SHAPED", "Titan ledger", "Inventory threshold" | throughout | "White-label agency", "Suggested company", "Source recorded, not checked", "Email records", Inventory moved to System |
| `--stage=REPLIED_POSITIVE requires --channel` | form errors (core's CLI wording) | "Say how they replied (email, call, WhatsApp…)." (translated in the app layer; core unchanged) |

### 2.2 Hierarchy and noise

- **Today showed the same work three times**: "Needs attention" counts, the work list, "Workflow channels"
  cards, then pipeline statistics. The top badge summed them ("187 actions recorded").
- **Ranking contradicted urgency.** "Segments below inventory threshold" was first and red. Replies and
  follow-ups came after it. "Leads with open research tasks: 120" was every lead.
- **The lead page opened on a two-tab switch** ("Overview" / "Full intelligence"). The Overview held *four
  operator forms*; the "intelligence" tab was a wall of eleven tables.
- **Thirteen navigation items in three groups**, including "Research" and "Research queue" as separate
  destinations, "Inventory" filed under "Channels", and no indicator of the current page.
- **Statistics walls** (`<dl class="stats">`) opened Research, Inventory, Pipeline, Email and Analytics. None of those
  numbers asked for an action.

### 2.3 Truthfulness

- **Unverified research was stated as fact.** "Why we're looking at them" printed the commercial claim in bold on
  all 120 leads while its check was `UNVERIFIED` (audit B1).
- **Planned dates were shown as "Sent on"** for emails that never went out (A3).
- **The email queue said "5 queued"** while those five had been stuck for a week (A1).
- **Invented explanations** on the Research page (B2).

### 2.4 Safety of actions

- Consequential defaults (call → "no answer", stage → "replied positive", review → **Approve**) (C1).
- A second click after success recorded the event again (C2).
- "Do not contact" was one click, beside ordinary outcomes, with no statement of consequences (C3).
- Forms on a blocked company gave no stop warning (C4).
- Every form was always open, so it was easy to submit the wrong one.

### 2.5 Empty, error and loading states

- **Errors:** none. Any failure (a permission reached by URL, a database outage, an expired session during a submit)
  showed Next's generic crash page and lost the form input (C5).
- **Loading:** none. A slow page looked like a dead click.
- **Empty states** were decent in places ("You're all clear.") but sometimes wrong: "Every lead in the system has
  complete verified information" when the filter simply matched nothing.

---

## 3. The new information architecture

```
KACHMO                                   (wordmark)
─────────────
Today                  what needs me, in order
Companies              every company, plain status, search
Emails                 what's scheduled, what went out, follow-ups   (read-only — Titan sends)
Calls                  who to call, with the briefing card           (if the role calls)
WhatsApp               drafts to approve, approved to send           (if the role messages)
Research               what to find, suggested companies, uploads    (if the role researches)
Pipeline               conversations and deals                        (if the role updates deals)
─────────────
System                 Inventory · Analytics · Audit log · Team · Settings   (admins)
```

- Routes are unchanged (`/leads` stays `/leads`), so links and bookmarks keep working. Only labels change.
- The current page is marked (`aria-current`).
- "Research queue" is a view inside **Research**, not a second destination.
- Navigation is filtered by permission for convenience only; every page still enforces its own permission
  on the server.

---

## 4. Screens

### 4.1 Today — "what needs me"

Order is urgency, not data source:

1. **Stop and look** (only when true). The automatic sender is stuck (A1). Automatic email is on hold because a
   queued company opted out (A2). Recording is switched off. A source contradicts what we have on file.
2. **Reply now.** Replies waiting; positive replies with no meeting.
3. **Due today.** Email follow-ups due (with how overdue); callbacks and meetings due; WhatsApp approved and waiting to be
   sent; calls ready.
4. **When you have time.** The top research tasks; suggested companies to review; sources to check.

Each item is one line of plain language built from the stored facts. Nothing is invented: the sentence is a
translation of the same fields the engine used to select the item. Each item has **one** button, named for what
happens next ("Open company", "Review", "Check source"). An item never says "Send". Where the work happens outside
the app (email is sent from the studio inbox), the item says so.

"Mine / everyone's" stays. The page opens on "mine" for people with a recording identity.

### 4.2 Companies — "which companies, and where are they?"

A single list with a **plain status** per company, derived (never stored) from the lead record, the email ledger and
the outreach block:

| Status | Meaning |
| :-- | :-- |
| Do not contact | blocked on every channel (opt-out, declined, suppression) |
| Replied / Replied — not now / Declined | a response is recorded |
| Meeting booked · Proposal sent · Won · Lost | the deal stage |
| Follow-up due | emailed, the single follow-up is due |
| Emailed | emailed, waiting |
| Email scheduled / Email drafted | in the automatic queue / drafted, not sent |
| Ready to contact | qualified and has a usable contact route |
| Qualified — no contact route yet | qualified, but nobody reachable |
| Needs research | required facts are missing |
| Disqualified | ruled out by the methodology |

Search by company, city or number. Filter by status, priority and country. Priority shows as "A · provisional" with a
tooltip: the ranking can change once research is complete. No engine value is recomputed in the page; the status is
a label over values core already produced.

### 4.3 The company page — the centre of the product

Top to bottom, in the order an operator reasons:

1. **Identity**: name, city and country, type of business, website. Status in one sentence ("Emailed 12 Sep. Follow-up
   was due 15 Sep.").
2. **Stop banner** when the company is blocked, with the reason in words. It is impossible to miss.
3. **Next step**: the one thing to do, with its button, or "Nothing for you — it sends automatically".
4. **Why them**: each research claim with its **verification mark**:
   - ● **Checked**: a person matched it to a source.
   - ◐ **Source recorded, not checked**: a link exists; nobody has confirmed it says this.
   - ○ **No source**: from earlier research; *don't quote it as fact*.
5. **Who**: the decision-maker and the contact routes, masked for roles that may not see them. Each route
   answers "can we use this?" in words ("Published on their website — usable", "General inbox, not the decision-maker",
   "No phone on file").
6. **What we'll send** (when queued): recipient, subject and the plain-text email, the planned date, and how sending
   works: automatically, in the recipient's weekday morning, from the studio inbox. Stopping it means marking the
   company "Do not contact", which holds all automatic email until the queue is edited. The page says exactly that.
7. **History**: emails (from the ledger), calls, replies, meetings, research recorded, opt-outs, newest first, in
   sentences. **System changes** (re-scoring, identifiers) sit behind "Show system changes".
8. **Record what happened**: a row of choices ("A reply came in", "I made a call", "A meeting, proposal or deal",
   "Research I found", "Do not contact"). Choosing one opens only that form. See §5.
9. **Details** (closed by default, native `<details>`):
   - **Qualification checks**: the 8 gates with correct plain labels and outcomes, and evidence coverage
   - **Scores**: the heuristic breakdown and its caveat
   - **Sources and evidence**: provenance rows, claim evidence, fetch results, review forms
   - **Missing information**: the engine's research tasks, each linking to the right form
   - **Possible duplicates**
   - **System record**: lead id, version, timezone, created/updated, drift from the engine

### 4.4 Emails — read-only, honest about the sender

- **Sender status first**, in words: sending normally / stuck (with planned date and age) / on hold (with the
  queued company that blocks it) / do-not-contact list not yet published. Each carries "email records as of <deploy
  time>".
- **Scheduled**: each queued email with its planned date, age, subject and an expandable plain-text preview.
- **Follow-ups due**, **Replies**, **Sent** (collapsed).
- No form and no send control. The page states that sending happens in the studio inbox (Titan), not here.

### 4.5 Calls, WhatsApp, Research, Pipeline

Same vocabulary, same plates, same forms. The briefing card on Calls marks unverified claims exactly like the company
page. WhatsApp states before approval that approving sends nothing. Research opens on "what to find" (the engine's
queue), then "suggested companies to review", then uploads and briefs.

### 4.6 System (admins)

Settings, Team, Audit log, Inventory and Analytics keep their full technical content: phases, stores, engine build,
field ownership, the job ledger, taxonomy. It is the advanced view. It is where the environment variables, CLI
commands and recording-identity instructions now live.

---

## 5. Safety by design (human error)

| Risk | Design |
| :-- | :-- |
| Recording the wrong thing | One form open at a time; every choice starts empty; the server already refuses an empty choice |
| Not knowing what a choice does | Consequence text next to every choice, before the button |
| Recording twice | After success, the form is replaced by "Recorded: <what>" and a "Record another" link. A network retry is refused by the version check (reproduced) |
| Accidental opt-out | Two steps: choose "Do not contact" → a confirmation stating every consequence (all channels, queue hold, only an owner can undo) → confirm |
| Opt-out chosen inside a call/WhatsApp form | An inline stop warning appears as soon as it is selected |
| Acting on a stale page | Every form carries the version it was rendered from. A change by someone else is refused with "This company changed since you opened it — reload" |
| Contacting a blocked company | The stop banner is at the top of the company page. Queues never include blocked companies (core). The call form on a blocked company is labelled "record a call that already happened" |
| Believing research that isn't verified | Verification marks everywhere a claim appears, including call briefings |
| Believing an email went out | Planned vs sent dates labelled; stuck emails flagged; "as of" time on email state |
| Losing input on an error | Actions never throw to the page. Errors return to the form, which keeps its state, and say whether anything was saved |
| Approving the wrong candidate | No default decision. Approval states "Creates a new company in your list; it will need research before anyone contacts it" |

Confirmation steps are reserved for what is **hard to undo or affects other people's work**: opt-outs and
approvals that create a company. Everything else is one deliberate choice plus one button, because a confirmation on
every action trains people to click through confirmations.

---

## 6. Empty, error and loading states

| State | Behaviour |
| :-- | :-- |
| Loading | A quiet skeleton line in the page's place, immediately, for every route |
| Nothing due | "Nothing needs you today." plus what *is* happening (e.g. "5 emails are scheduled") so empty never reads as broken |
| Filter matches nothing | "No companies match these filters." plus reset. Never a claim about the whole database |
| Not found | "That company isn't in the list." with a link to Companies |
| No permission (by URL) | "You don't have access to this page." Nothing from the page is shown |
| Error | "Something went wrong loading this page. Nothing was changed." with **Try again** and **Go to Today**. The reference code is shown small, for Dev |
| Form: session ended | "You've been signed out. Nothing was saved. Sign in again and redo this." The typed input stays on screen |
| Form: database didn't confirm | "The database didn't confirm this. Reload the page to see whether it was saved before trying again." |

---

## 7. Glossary (engine term → operator term)

| Engine | Operator |
| :-- | :-- |
| lead | company |
| research_state RESEARCH_REQUIRED / QUALIFIED / OUTREACH_READY / DISQUALIFIED | Needs research / Qualified — no contact route yet / Ready to contact / Disqualified |
| lead_priority A+…C, PROVISIONAL | Priority A · provisional |
| gate PASS / UNVERIFIED / PENDING / UNKNOWN / FAIL | Confirmed / Claimed, no source / Missing / Not researched (optional) / Fails |
| provenance PUBLICLY_LISTED / VERIFIED / UNVERIFIED / INFERRED / INVALID / UNKNOWN | Published by them / Confirmed by us / Source unknown / Guessed — don't use / Bounced or wrong / None |
| evidence SUPPORTED / RETRIEVED / URL_SHAPED / CLAIMED / CONTRADICTED | Checked / Fetched, not checked / Source recorded, not checked / No source / Source disagrees |
| suppression, do_not_contact | Do-not-contact list, Do not contact |
| candidate (ACCEPT / REJECT / MERGE …) | Suggested company (Add to companies / Not a fit / Same as an existing company …) |
| Titan, OUTREACH_TRACKER.md, scheduled-queue.json | the studio inbox, email records, the automatic email queue |
| engine actor DEV / AADI | recording identity (System only) |
| KACHMO_APP_WRITES, cutover phase | "Recording is switched off" (System shows the technical reason) |
