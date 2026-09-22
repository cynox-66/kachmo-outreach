# ADR-036: Email-Sender Health Is Derived From Data the App Already Has, and Stays Read-Only

> **Status:** Approved & Canonical (operator redesign)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-22
> **Version:** 1.0.0

---

## Context

Automated dispatch delivered nothing between 2026-09-15 and 2026-09-22 (audit A1). Every run was green, because
the dispatcher held entries that fell outside the recipients' morning window, and the scheduled runs start hours late.
An opt-out on a queued company holds *every* queued email, because the preflight refuses the whole run (A2). Neither
condition was visible anywhere an operator looks.

Titan owns email in every phase (ADR-009, ADR-010). The app must not write the queue or the ledger, and must not
gain a send path.

## Decision

The application derives a **sender status** on every read from inputs it already holds, and shows it on Today and
on the Emails page:

- **Stuck**: a queued entry whose ledger row is still `SCHEDULED`/`DRAFTED` and whose planned date is before today.
  The planned date and age are shown.
- **On hold**: the dispatch preflight would refuse the next run. This is computed by the *same pure function* CI runs
  (`evaluateDispatchPreflight`), over the deployed queue and ledger bytes and the canonical Postgres leads and active
  suppression. The blocking companies are named.
- **Not yet published**: an active suppression that the artifact the dispatcher reads does not contain (the existing
  artifact verification).
- **As of**: the time the deployed ledger was built into the app, because email state in a deployment is only as
  fresh as its build (A5).

The queue preview (recipient, subject, plain-text body) is read from `scheduled-queue.json` for display only. The HTML
part is never rendered, and recipients are masked for roles without `lead.view_contacts`.

## Consequences

- A stalled or held sender is visible within one page load, in words, to anyone who can see email state.
- The app still cannot send, schedule, edit or cancel an email. The remedy for A1 (the schedule) stays an owner change
  to a protected file.
- Freshness is bounded by deployment until the owner chooses a live source for the ledger (audit A5).

## Implementation

`os/server/services/sender.ts`, `os/server/repo/titan-ledger.ts`, `os/tests/operator.ts`.
