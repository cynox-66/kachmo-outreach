# ADR-008: Prohibition of Autonomous Cold Outbound Systems

> **Status:** Approved & Canonical  
> **Owner:** Solo Operator / Lead Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## Purpose

This Architecture Decision Record establishes the permanent prohibition of automated cold email sending platforms (Instantly, Smartlead, Lemlist) and programmatic SMTP blasting in **Lead Engine**.

---

## Scope

- Outbound communications architecture.
- Rejection of automated email sequence software and programmatic send APIs.

---

## Cross References

- [OUTREACH.md](../OUTREACH.md) — Outreach and template specifications
- [ADR-004](ADR-004-human-in-the-loop.md) — Strict Human-in-the-Loop Review
- [ENGINEERING.md](../ENGINEERING.md) — Axiom 7: Manual Approval > Automated Outreach

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

Mass cold outbound platforms (such as Instantly and Smartlead) are popular for high-volume sales. They require purchasing secondary domains, configuring SPF/DKIM/DMARC records, warming up inboxes for weeks, and blasting automated multi-step sequences to thousands of scraped contacts.

---

## Problem

Applying automated cold blast infrastructure to freelance web development services is counterproductive and dangerous:
1. **Low Conversion for High-Ticket Services:** Agency founders and design directors immediately detect automated sequences and mark them as spam. High-ticket ($2,000–$5,000+) design/dev contracts require genuine peer-level trust.
2. **Infrastructure Cost:** Secondary domains, Google Workspace seats, inbox warmers, and sending tools cost **$50–$100+/month**, violating the $0–$3 budget constraint.
3. **Severe Brand Burn:** If an automated email goes out with a broken token or bad AI critique to an influential studio, that relationship is burned forever.

---

## Decision

We permanently prohibit integrating automated email sequencing platforms or programmatic SMTP sending APIs into Lead Engine. All emails must be dispatched manually from the operator's primary Gmail inbox after visual inspection.

---

## Alternatives Considered

1. **Integrated SMTP API Sending (Nodemailer / SendGrid):** Programmatic sending without a review UI. (Rejected due to hallucination and deliverability risks).
2. **Dedicated Cold Outbound SaaS (Instantly / Smartlead):** (Rejected due to monthly software fees and low-trust messaging).
3. **Manual 1-Click Dispatch via Native Gmail:** **Selected.** Zero software cost, 100% human-verified quality, maximum inbox placement.

---

## Tradeoffs

### Positive:
- **Pristine Deliverability:** 0% spam complaints; emails land directly in the primary inbox.
- **Zero Cost:** No secondary domains, warmer tools, or SaaS subscriptions.
- **High Trust:** Outreach reads like a personal letter from a real engineer.

### Negative:
- Daily sending volume is capped at human speed (~25–40 emails/day).

---

## Consequences

- No email sending libraries (`nodemailer`, `@sendgrid/mail`) are allowed in `package.json`.
- The output in Google Sheets provides formatted subject lines and draft bodies ready for 1-click copy-pasting.

---

## Future Reconsideration

This decision is permanent and will not be reversed.

---

## Revision History

| Version | Date | Author | Description |
| :--- | :--- | :--- | :--- |
| `1.0.0` | 2026-08-09 | Solo Operator / Lead Engineer | Approved canonical ADR-008. |
