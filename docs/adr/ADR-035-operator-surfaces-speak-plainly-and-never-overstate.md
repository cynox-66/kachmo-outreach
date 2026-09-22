# ADR-035: Operator Surfaces Speak Plainly, Never Overstate, and Disclose Rather Than Delete

> **Status:** Approved & Canonical (operator redesign)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-22
> **Version:** 1.0.0

---

## Context

The interface was built as an engineering console. Its primary content was engine identifiers, file names,
environment variables and CLI commands. It stated unverified research as fact on every lead (audit B1), and made
consequential actions easy to take by mistake (C1–C3). The people who operate outreach should not need to know how the
system is built to use it safely.

## Decision

1. **Plain language first.** Every operator-facing surface (Today, Companies, the company page, Emails, Calls,
   WhatsApp, Research, Pipeline) describes state in operator terms, using the glossary in `docs/OPERATOR_EXPERIENCE.md`
   §7. The translation lives in one server module (`os/server/services/operator.ts`). It is pure, and it is tested so
   that every value core can produce has a label: no raw enum can reach the UI by accident.
2. **Never overstate.** A research claim is always shown with its verification state (*Checked*, *Source recorded,
   not checked*, *No source*). It is derived from the gate outcome and claim evidence core already computes. A
   planned email date is never shown as a sent date.
3. **Disclose, don't delete.** Technical detail (gates, scores, provenance tables, evidence, identifiers, system
   events, cutover phase, write-path health) remains available. It lives under a labelled disclosure on the company
   page, or on the System pages. Engineering copy (variables, commands) appears only on System pages.
4. **Consequences before commitment.** An action states what it will do before the button. No consequential default.
   Irreversible or shared-impact actions (do-not-contact, approving a company into the list) take an explicit
   confirmation. A recorded action is confirmed in place rather than resetting to a ready-to-submit form.
5. **Presentation never decides.** Labels and sentences are computed from values core produced. Eligibility,
   qualification, scoring and suppression remain core's alone (the existing shell tests continue to enforce that
   pages call no engine function).

## Consequences

- An operator can use the product without the vocabulary of its implementation, and cannot mistake a claim for a
  verified fact.
- A new engine value without an operator label fails a test instead of shipping as an identifier.
- Engineers lose nothing: every technical view still exists, one labelled step away.

## Implementation

`os/server/services/operator.ts`, `os/app/(app)/*`, `os/tests/operator.ts`, `os/tests/shell.ts` §6.
