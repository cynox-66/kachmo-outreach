# ADR-002: Google Sheets Over Dedicated Relational Database

> **Status:** Approved & Canonical  
> **Owner:** Solo Operator / Lead Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## Purpose

This Architecture Decision Record records the choice to use **Google Sheets** as the primary database, review interface, and CRM for Lead Engine in place of a dedicated database (PostgreSQL / Supabase / SQLite).

---

## Scope

- Data persistence layer for Version 1.
- Rejection of Supabase, PostgreSQL, SQLite, and Airtable.
- Evaluation of operational overhead vs. data scale constraints.

---

## Cross References

- [DATA.md](../DATA.md) — Canonical Lead Object & Google Sheets CRM schema
- [ENGINEERING.md](../ENGINEERING.md) — Axiom 6: Google Sheets > Dedicated Database

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

A core requirement of Lead Engine is storing discovered candidates, maintaining a permanent deduplication index, and providing a rapid visual surface where the operator can inspect 30–50 leads in under 30 minutes.

---

## Problem

Introducing a dedicated relational database (e.g., PostgreSQL on Supabase or Railway) introduces multiple layers of overhead:
1. **Schema Migrations & ORMs:** Requires Prisma/TypeORM, migration scripts, and connection pool management.
2. **Lack of Native Visual Interface:** A raw database requires building a separate web dashboard or writing SQL queries to view daily leads.
3. **Synchronization Complexity:** If Airtable or Google Sheets is synced with Postgres, maintaining two-way consistency introduces state synchronization bugs.
4. **Financial Cost:** Supabase/PostgreSQL services incur hosting costs ($25/mo) once free tiers expire or pause due to inactivity.

---

## Decision

We designate **Google Sheets** as the sole database, review surface, and CRM for Lead Engine Version 1 via the official Google Sheets API v4.

---

## Alternatives Considered

1. **Supabase (PostgreSQL) + Custom React UI:** Production-grade, but adds ~$25/mo cost and weeks of development time.
2. **Local SQLite Database:** Zero hosting cost, but lacks mobile access and a native spreadsheet interface for rapid manual editing.
3. **Airtable:** Excellent visual UI, but imposes severe free-tier record limits (1,000 records) and paid API tiers ($20/user/mo).

---

## Tradeoffs

### Positive:
- **Zero Cost:** 100% free with unlimited storage under Google Drive quotas.
- **Instant UI:** Native desktop web app, mobile iOS/Android apps, keyboard shortcuts, filters, and formulas out-of-the-box.
- **Additive Schema:** Adding a new column requires zero migration scripts.
- **Direct Manual Editing:** Operator can edit cells, add notes, and change dropdown statuses instantly.

### Negative:
- Lacks ACID relational constraints (not needed for flat lead data).
- Rate limits on rapid continuous API writes (mitigated by batching writes into single multi-row appends).

---

## Consequences

- The application uses `googleapis` to read `HISTORY` and batch append to `TODAY`.
- The dataset remains completely portable (can export to CSV at any time).
- No database hosting, maintenance, or backup configuration is required.

---

## Future Reconsideration

Reconsider introducing PostgreSQL or SQLite if the total historical lead count exceeds **10,000 rows** and Google Sheets experiences noticeable calculation latency (>3s on filter operations).

---

## Revision History

| Version | Date | Author | Description |
| :--- | :--- | :--- | :--- |
| `1.0.0` | 2026-08-09 | Solo Operator / Lead Engineer | Approved canonical ADR-002. |
