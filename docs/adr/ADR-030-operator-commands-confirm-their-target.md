# ADR-030: A Writing Operator Command Must Name Its Target Host

> **Status:** Approved & Canonical (Phase C)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-20
> **Version:** 1.0.0

---

## Context

`db:migrate` has always refused to run without `KACHMO_MIGRATE_CONFIRM_HOST`. The Phase B operator commands
(`actor:bind`, `leads:reevaluate --apply`, `leads:revert --apply`, `evidence:fetch --apply`) had no such check, and
they read `DATABASE_URL` from `os/.env.local` when a shell forgets to export one — which points at **production**.

## Decision

A command that writes refuses unless `KACHMO_OPERATOR_CONFIRM_HOST` names exactly the host in `DATABASE_URL`.
Read-only modes (every dry run) are unaffected, so inspecting a database stays frictionless while writing to the
wrong one takes a deliberate, host-specific acknowledgement. The refusal names the host and contacts nothing.

### Also: a revert that changes nothing is refused

`leads:revert` re-evaluates the restored record, so reverting a change that only affected derived fields reproduces
the current state. It used to write that as a new version anyway — an empty revision and an audit row recording
nothing. It now refuses with "nothing to revert".

## Implementation

`os/server/leads/operator-db.ts` (`operatorHostRefusal`), the four CLI entry points, `os/server/leads/revert.ts`,
`os/tests/operating-loop.ts` §6.
