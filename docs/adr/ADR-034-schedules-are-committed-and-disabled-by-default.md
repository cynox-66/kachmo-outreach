# ADR-034: A Schedule Is a Committed Workflow, Disabled Until Someone Enables It

> **Status:** Approved & Canonical (Phase E)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-20
> **Version:** 1.0.0

---

## Decision

Scheduled maintenance runs as a **committed GitHub Actions workflow** (`.github/workflows/maintenance-jobs.yml`),
never as a hidden cron, a platform timer or an in-app scheduler. Its `schedule:` block ships **commented out** — the
same pattern that pauses the Titan dispatcher — so enabling automation is a reviewed commit on main, visible in the
history. Until then every run is a deliberate `workflow_dispatch`.

The workflow:

- runs one named job per invocation, with `KACHMO_NO_LOCAL_ENV=1` and an explicit `DATABASE_URL`;
- confirms the exact target host (ADR-030), because a job writes;
- runs `jobs:status` afterwards, so the ledger is visible in the run log;
- contains no send path, no Titan file and no suppression publish, which a test asserts.

The Titan dispatch workflow is untouched by this phase.

## Consequences

- Nothing automates itself by being deployed; automation begins with a commit that a person made deliberately.
- A schedule that must be stopped is stopped the same way: comment it out and commit.

## Implementation

`.github/workflows/maintenance-jobs.yml`, `os/tests/jobs.ts` §4.
