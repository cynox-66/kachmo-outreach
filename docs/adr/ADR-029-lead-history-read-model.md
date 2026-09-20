# ADR-029: Lead History Is a Read Model Over the Logs That Already Exist

> **Status:** Approved & Canonical (Phase C)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-20
> **Version:** 1.0.0

---

## Decision

"What happened with this lead?" is answered by merging what is already recorded — domain events
(`analytics_event`), audited actions (`audit_event`, which names the real person) and the record's own call
attempts — into one timeline, newest first. **No new table, no new write, nothing inferred.**

- Domain events name the engine actor (DEV/AADI/SYSTEM); audit rows name the person.
- A call logged through the write path produces both an event and a `call_attempts` entry at the same instant; the
  record's history is shown only for attempts no event describes (for example from before cutover).
- Contact values never appear: audit metadata is redacted when written, event payloads carry none by construction,
  and the view redacts again so an older row cannot leak one either.

## Implementation

`os/server/services/timeline.ts`, the lead page's History section, `os/tests/operating-loop.ts` §4.
