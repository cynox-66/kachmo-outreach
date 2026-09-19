# ADR-025: A Candidate MERGE Attaches Evidence; It Never Merges Fields

> **Status:** Approved & Canonical (Phase B)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-19
> **Version:** 1.0.0

---

## Decision

After cutover, MERGE records the decision and attaches the candidate's claims to the existing lead as
`EXTERNAL_RESEARCH` evidence, in one transaction. **No lead field changes.** Adopting a value onto the lead stays an
explicit, attributed `lead.research_recorded` write by a person who has looked at the evidence.

This closes Phase 2 limitation 5 ("merge records the decision but does not merge fields") without inventing
field-level merge semantics, which would need the ownership model applied per field and per source.

The candidate records the lead it was merged into (`resolved_lead_id`) and who decided.

## Implementation

`os/server/research/service.ts` (`mergeAsEvidence`), `os/tests/evidence.ts` §8.
