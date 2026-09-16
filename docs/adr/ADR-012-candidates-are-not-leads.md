# ADR-012: Candidates Are Not Leads, and Only a Named Human Promotes One

> **Status:** Approved & Canonical (Phase 1.5)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-16
> **Version:** 1.0.0

---

## Purpose

Records the human approval boundary between imported research and the canonical lead database.

---

## Context

Phase 2 ingests research reports produced outside the system. If a report could write leads directly, the canonical database would inherit whatever an external tool asserted — including companies that have already opted out.

---

## Decision

A **candidate** is a proposal that a lead should exist. It lives in its own space and carries the claims and the evidence offered for each one.

```
research report → candidate → normalize → dedupe → evidence check → qualify → HUMAN APPROVAL → lead
```

`approvalRefusal()` is the only function that can say a candidate may become a lead, and it refuses when:

| Code | Refuses because |
| :-- | :-- |
| `NOT_A_HUMAN` | the reviewer is empty, `SYSTEM`, `LLM`, or anything agent-shaped |
| `SUPPRESSED` | the candidate matches a suppression entry — **never approvable, by anyone** |
| `CONTRADICTED` | a source contradicts the report's own claim |
| `INCOMPLETE` | a required field was not supplied |
| `UNRESOLVED_DUPLICATE` | it matches an existing lead that has not been merged or dismissed |
| `NO_EVIDENCE` | no claim offers even a URL |
| `ALREADY_RESOLVED` | it has already been accepted, rejected, merged or suppressed |

`assessCandidate()` grades fail-closed in that order: suppression beats contradiction beats duplicate beats incompleteness, so the most serious reason is the one reported.

There is no automatic path, no bulk override, and no system identity that can approve.

---

## Consequences

**Accepted:**
- Every imported lead costs a human review. That is the point.
- Duplicates are reported, never merged automatically.

**Gained:**
- Someone who opted out cannot be re-added under a new lead by any route.
- A reviewer can answer "why is this lead here?" from the candidate's own claims and evidence.

---

## Implementation

- `core/research/candidate.ts`
- `scripts/__tests__/research-foundation.ts` §5, §6, §10

---

## Cross References

- [ADR-004](ADR-004-human-in-the-loop.md) — strict human-in-the-loop
- [ADR-011](ADR-011-evidence-levels.md)
