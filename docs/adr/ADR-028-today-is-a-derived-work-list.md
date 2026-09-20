# ADR-028: Today Is a Derived Work List, Never a Stored Queue

> **Status:** Approved & Canonical (Phase C)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-20
> **Version:** 1.0.0

---

## Context

After Phase B every operator action was possible, but "what should I do now?" was still assembled by hand across six
pages. The dashboard's "work due today" guessed the action by matching regular expressions against the free-text
`next_action` ("if it mentions 'call', link to calls"), which is presentation inventing domain meaning.

## Decision

**Today is computed on every read from state that already exists, and never stored.** The rules live in core
(`queues/today.ts`); the application only gathers inputs and renders.

- Ten kinds of work, in a fixed order of consequence: replies waiting, positive-without-meeting, follow-ups due,
  email follow-ups due, WhatsApp to send, calls ready, WhatsApp to approve, candidates to review, evidence to check,
  research to unblock.
- Within a kind: overdue first, then due date, then priority, then score, then target number — so two people looking
  at the same state see the same list in the same order.
- Every item carries **why** it is there as the stored facts it came from, and **who** owes it.
- A lead blocked from outreach never appears in an outreach item, because the rules call `outreachBlock`.
- Email items are marked as happening in **Titan**, not in the OS.
- Items the actor lacks the permission to act on are not shown at all.

There is no task table, no snooze, no assignment and no "done" flag: a work item exists exactly as long as the state
that implies it, so it cannot drift from reality.

### One definition of "who is owed what"

The war room (markdown, strings) and Today (application, structured) now select work with the same predicates,
extracted to `core/queues/work-rules.ts`. The golden baseline pins the war room's output, so the extraction is proven
behaviour-preserving, and a test asserts the two lists agree lead for lead.

## Consequences

- Nothing can be "marked done" without changing the underlying state — which is the point.
- The list is only as good as the state; a stale lead shows up as stale work rather than as a silent gap.

## Implementation

`core/queues/{today,work-rules}.ts`, `os/server/services/today.ts`, `os/app/(app)/page.tsx`,
`os/tests/operating-loop.ts` §1–§3.
