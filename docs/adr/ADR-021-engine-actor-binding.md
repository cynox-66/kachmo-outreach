# ADR-021: Application Users Act Through an Owner-Bound Engine Actor

> **Status:** Approved & Canonical (Phase B)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-19
> **Version:** 1.0.0

---

## Decision

core/'s write decisions take `by: 'DEV' | 'AADI'`. An OWNER binds each application user who may write leads to one
engine actor (`user_engine_actor`, `npm --prefix os run actor:bind`). A user with no active binding cannot write a
lead, whatever their role. core/'s `Actor` type is not changed.

- Bindings are never deleted and never edited; a binding ends with an attributed revocation (database guard).
- Every write records both the application user id and the engine actor, so two people bound to the same actor stay
  distinguishable in the audit log.
- A binding is made by a named person; agent-shaped labels (`SYSTEM`, `claude`, `bot` …) are refused.
- A bound person is an explicit identity, so the CLI's `--by` requirement for a Kachmo fit judgement is met — but
  recording fit additionally needs `lead.approve`.

## Implementation

`os/server/leads/{actor-binding,actor-bind-cli}.ts`, migration 0004, `os/tests/lead-writes.ts` §6.
