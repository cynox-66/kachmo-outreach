# ADR-033: Recurring Work Runs Through a Job Ledger: Idempotent, Leased, Bounded

> **Status:** Approved & Canonical (Phase E)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-20
> **Version:** 1.0.0

---

## Context

Phase D added maintenance that genuinely recurs — sources go stale whether or not anyone remembers to re-check them.
Recurring work that is not idempotent is a liability: a retried run repeats side effects, a crashed run blocks the
key forever, and a failing run repeats until someone notices.

## Decision

One table, `job_run`, and one wrapper, `runJob`. There is **no queue, no worker pool and no in-process timer**: a job
is a command invoked by a person or by a committed workflow (ADR-034).

- **Idempotent.** The key is `<job>:<period>` and is unique. Work already SUCCEEDED is skipped, not redone. The
  database refuses to reopen a succeeded key at all.
- **Leased.** A claim carries a lease. A RUNNING row whose lease is still in the future is another process's work and
  is left alone; one whose lease has expired is a crash, and the next invocation takes it over as a new attempt.
- **Bounded.** A FAILED key is retried on later invocations up to three attempts, then left for a person
  (`SKIPPED_EXHAUSTED`) rather than repeating forever.
- **Observable.** Every outcome is a ledger row and an audit event, carrying counts — never lead data. `jobs:status`
  and the Settings panel show the last run of each job.
- **Bounded in power.** Each job declares what it may write (`JOB_WRITES`), and a test asserts it. The two read-only
  jobs write nothing but the ledger; `evidence-refresh` writes only retrievals and their links.

The three jobs are `evidence-refresh`, `stale-data` and `weekly-report`. **None touches a lead, suppression, a queue,
Titan or any outreach path**, and none contacts a prospect.

## Implementation

Migration 0005, `os/server/jobs/{runner,jobs,cli}.ts`, `os/tests/jobs.ts`.
