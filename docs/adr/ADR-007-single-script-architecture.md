# ADR-007: Single-Script Architecture Over Distributed Microservices

> **Status:** Approved & Canonical  
> **Owner:** Solo Operator / Lead Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## Purpose

This Architecture Decision Record records the choice to implement Lead Engine as a single, cohesive TypeScript CLI program (`src/run.ts`) rather than a distributed microservices network.

---

## Scope

- Codebase organization, process lifecycle, and orchestration patterns.
- Rejection of Docker containers, Kubernetes, Redis, and multi-service topologies.

---

## Cross References

- [ARCHITECTURE.md](../ARCHITECTURE.md) — System topology & monolithic module structure
- [ENGINEERING.md](../ENGINEERING.md) — Axiom 5: One Script > Multiple Services

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

Previous architectures split prospecting tasks across multiple microservices: a discovery scraper service, a queue manager (Redis/BullMQ), a browser worker service (Docker/Playwright), an AI evaluation service, and a database sync worker.

---

## Problem

Operating a distributed microservice topology for a single-user batch workload creates immense operational overhead:
1. **Coordination Failure:** Managing inter-service network communication, serialization errors, and dead-letter queues.
2. **Local Debugging Nightmare:** Running 4 separate Docker containers locally just to test a small regex change wastes hours of evening engineering time.
3. **Deployment Friction:** Managing multiple continuous deployment pipelines across cloud providers.

---

## Decision

We collapse all pipeline stages into a **single cohesive TypeScript codebase** executed via a single entry-point script: `node dist/run.js` (or `npm start`).

```
REJECTED: Microservice Mesh
[ Scraper Service ] ──► [ Redis Queue ] ──► [ Worker Pool ] ──► [ DB Sync Service ]

APPROVED: Single TypeScript Program
[ src/run.ts ] ──► (discover -> fetch -> qualify -> audit -> evaluate -> sync)
```

---

## Alternatives Considered

1. **Microservices with Docker Compose:** High isolation, but massive configuration overhead.
2. **Serverless Functions (AWS Lambda / Cloudflare Workers):** Hard execution timeouts (15 minutes max on Lambda; 30s on Workers) make long browser batch auditing difficult.
3. **Single TypeScript Runner (GitHub Actions):** **Selected.** Zero infrastructure to maintain; runs cleanly in 15 minutes and exits.

---

## Tradeoffs

### Positive:
- **Zero Local Ops:** Run `npm run dev` in the terminal to execute and debug the entire pipeline in seconds.
- **Single Process Memory:** Shares in-memory arrays between stages without Redis serialization.
- **Trivial Deployment:** Single GitHub Actions YAML file runs the build and script.

### Negative:
- Horizontal scaling across multiple machines is not supported out of the box (unnecessary for 100–200 leads/day).

---

## Consequences

- The entire codebase is organized cleanly inside `src/`.
- Execution is completely linear and deterministic.

---

## Future Reconsideration

Reconsider splitting into separate worker services only if daily discovery volume scales to **>5,000 websites/day**, which is explicitly out of scope for Lead Engine V1.

---

## Revision History

| Version | Date | Author | Description |
| :--- | :--- | :--- | :--- |
| `1.0.0` | 2026-08-09 | Solo Operator / Lead Engineer | Approved canonical ADR-007. |
