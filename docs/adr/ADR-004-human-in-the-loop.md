# ADR-004: Strict Human-in-the-Loop Review Architecture

> **Status:** Approved & Canonical  
> **Owner:** Solo Operator / Lead Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## Purpose

This Architecture Decision Record records the mandate enforcing strict human-in-the-loop review and manual dispatch for all outreach operations in **Lead Engine**.

---

## Scope

- Boundary between automated data processing and human executive action.
- Rejection of autonomous end-to-end outbound email sending.

---

## Cross References

- [WORKFLOW.md](../WORKFLOW.md) — 30-Minute operator review manual
- [OUTREACH.md](../OUTREACH.md) — Outreach and dispatch guidelines
- [ADR-008](ADR-008-no-autonomous-outreach.md) — No Autonomous Outreach Decision Record

---

## Table of Contents

1. [Context](#context)
2. [Problem](#problem)
3. [Decision](#decision)
4. [Alternatives Considered](#alternatives-considered)
5. [Tradeoffs](#tradeoffs)
6. [Consequences](#consequences)
7. [Future Reconsideration](#future-reconsideration)
8. [Revision History](#revision-history)

---

## Context

In sales automation, there is a strong temptation to build full end-to-end autonomy: discover a website, write an email with AI, and immediately dispatch it to the prospect's inbox via API without human intervention.

---

## Problem

Full autonomy in high-ticket freelance client acquisition creates catastrophic risks:
1. **AI Hallucination Blunders:** If the AI hallucinates a defect or misinterprets a brand, sending that email destroys the developer's professional reputation.
2. **Domain Blacklisting:** Unmonitored automated outbound leads to high spam complaint rates, causing Google Workspace / Gmail to suspend the primary sending domain.
3. **Loss of Subtle Nuance:** AI cannot gauge whether an aesthetic style matches the developer's taste or whether a studio is culturally aligned with custom freelance rates.

---

## Decision

We enforce a strict **Human-in-the-Loop Boundary**: The automation terminates at the Google Sheet. The human operator must personally review every lead, customize the copy if needed, and hit the "Send" button in native Gmail.

```
[ AUTOMATION STAGE: Find -> Audit -> Score -> Draft ]
                        │
                        ▼
                [ GOOGLE SHEETS ]
                        │
           ═════════════╪═════════════  ◄── STRICT BOUNDARY
                        │
[ HUMAN STAGE: Review -> Personalize -> Send in Gmail ]
```

---

## Alternatives Considered

1. **Fully Autonomous Outbound (Zero Human Review):** Maximum volume, but catastrophic failure rate and high risk of domain burn.
2. **Automated Sending with 24-Hour Cancellation Delay:** Complex queue management for zero tangible benefit over a dedicated 30-minute evening review session.

---

## Tradeoffs

### Positive:
- **100% Quality Assurance:** Zero hallucinated or embarrassing emails ever reach a client's inbox.
- **Maximum Deliverability:** Manual sending from primary Gmail maintains pristine sender reputation and 99%+ inbox placement.
- **Personal Touch:** 15 seconds of human personalization triples reply rates compared to generic AI cold blasts.

### Negative:
- Requires 30 minutes of dedicated operator effort each evening.

---

## Consequences

- The pipeline contains no email sending libraries or SMTP credentials.
- The review workflow is optimized for speed (36–60s per lead) to make the human time budget sustainable.

---

## Future Reconsideration

This decision is permanent for Version 1. It will not be reconsidered as long as outreach is conducted for high-ticket freelance development services.

---

## Revision History

| Version | Date | Author | Description |
| :--- | :--- | :--- | :--- |
| `1.0.0` | 2026-08-09 | Solo Operator / Lead Engineer | Approved canonical ADR-004. |
