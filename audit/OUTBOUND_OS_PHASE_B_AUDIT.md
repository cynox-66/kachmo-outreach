# Outbound OS — Phase B Audit (the post-cutover write path)

> **Date:** 2026-09-19
> **Base:** `9d55230` plus the uncommitted Phase A working tree
> **Committed:** NO · **Pushed:** NO · **Deployed:** NO · **Production migration:** NO · **Production data changed:** NO · **Outreach sent:** NO
> **Methodology v1.0 changed:** NO · **Golden baselines regenerated:** NO · **core/, scripts/, .github/ touched:** NO

---

## 1. Why Phase B existed

After cutover (2026-09-17) Postgres was canonical, ADR-018 refused every legacy CLI writer, and the application had
**exactly one lead write** (candidate import). Nobody could log a call, record a WhatsApp review, move a sales stage,
record research, re-qualify a lead — or **record an opt-out** — while Titan dispatch was live. Phase A's call and
WhatsApp pages still told operators to run CLI commands that now refuse.

Phase B restores the write path **without new semantics**: every change runs the existing core/ decision, the existing
ownership table, the existing invariants and the existing qualify → score → opportunity chain, committed as one audited
Postgres transaction. It then makes claim-level evidence provable above URL_SHAPED.

---

## 2. What was built

| Stage | What | Where |
| :-- | :-- | :-- |
| B.0 | Write kill switch `KACHMO_APP_WRITES` (default **off**); ownership-coverage test; ADRs 019–027 | `server/repo/phase.ts`, `docs/adr/` |
| B.1 | Migration 0004 (additive); canonical write lock; engine-actor binding + `actor:bind`; the Postgres applier; persisted re-evaluation + `leads:reevaluate` | `server/leads/{locks,actor-binding,actor-bind-cli,mutate,reevaluate,reevaluate-run,operator-db}.ts` |
| B.2 | Operator commands + server actions (call, WhatsApp, pipeline, research, **suppression**); candidate approval hardened; MERGE-as-evidence; evidence store; SSRF-guarded fetcher + `evidence:fetch`; human review | `server/leads/{commands,actions,suppression}.ts`, `server/research/service.ts`, `server/evidence/*` |
| B.3 | CLI hints replaced with forms on Calls and WhatsApp; lead page "Record what happened", claim-evidence panel with review, drift notice; Settings write-path health | `app/(app)/components/{LeadActions,EvidenceReview}.tsx`, `calls`, `whatsapp`, `leads/[id]`, `settings` pages, `server/services/{write-status,admin,leads,operations}.ts`, `server/repo/canonical.ts` |
| B.4 | Forward-only `leads:revert` (never across a suppression); refusal auditing; fetch cooldown / give-up; this audit and runbook | `server/leads/revert.ts` |

### Database — migration `0004_phase_b_write_path` (additive only)

| Object | Change | Guard |
| :-- | :-- | :-- |
| `user_engine_actor` | new | never deleted; only a single attributed revocation |
| `lead_revision` | new | append-only |
| `evidence_retrieval` | new | append-only; OK ⇔ content present; text ≤ 256 KB |
| `lead_evidence` | + `retrieval_id`, `supporting_excerpt`, `validator`, `candidate_id`, `recorded_by_label`, `reviewed_by_label`, `review_note` | never deleted; claim and source immutable; final once reviewed; an excerpt needs a retrieval; CHECKED needs an excerpt |

No column dropped or retyped, no data rewritten. The existing `lead.version`, `lead_evaluation`, `analytics_event`,
`suppression_entry` and `methodology_version` get their first real writers.

### New permission

`evidence.review` → OWNER, ADMIN, RESEARCHER. Every other action reuses an existing permission; recording fit also
needs `lead.approve`, recording an email/phone also needs `lead.view_contacts`, reviewing evidence also needs
`lead.view_contacts`.

---

## 3. Proof

| Suite | Before | After |
| :-- | --: | --: |
| Root (legacy · golden · write-path · Titan · core · reconciliation · research · freeze) | 776 | **776** (unchanged) |
| OS (db · migration · auth · shell · sync · research · app · suppression · historical sends) | 708 | 718 |
| **OS lead writes** (new) | — | **100** |
| **OS evidence & operator commands** (new) | — | **155** |
| **OS concurrency** (new, real Postgres 16, loopback only; `test:concurrency`, not in `npm test`) | — | **36** |
| **Total** | 1484 | **1785** |

Typecheck (root, os), lint, and `next build` are clean.

**The two golden baselines are the oracles, read and never regenerated:**

- Re-evaluating the pinned 120 leads in Postgres gives records **byte-identical** to `leads:refresh`, with the same
  number of QUALIFICATION_CHANGED events.
- Replaying the whole write-path golden scenario through the Postgres applier gives **every step the same
  applied/refused outcome and every lead byte-identical to the CLI result — except lead 001**, whose FOLLOW_UP_SENT is
  refused because `email_follow_up_sent_at` is Titan-owned (ADR-019). Suppression entries, their order and reasons,
  and the domain events match.
- A refresh after any inline-re-evaluated write changes nothing (re-evaluation is a fixed point).

Protected files, hashed before and after this phase — **all identical**:

| File | SHA-256 |
| :-- | :-- |
| `database/kachmo_leads.json` | `9d4c4099…98a7eec` |
| `database/suppression.json` | `4f53cda1…202b945` |
| `analytics/events.jsonl` | `73152f40…a08678c` |
| `OUTREACH_TRACKER.md` | `dcc3924f…209a61d422` |
| `scheduled-queue.json` | `80c34717…f7b28881` |
| golden `methodology-v1.0.baseline.json` | `f7c9345b…98b1569` |
| golden `methodology-v1.0.writepaths.baseline.json` | `ff599ac0…297621764` |

The fetcher was exercised once against the real network (`https://example.com/`, a domain reserved for examples):
TLS verified, robots.txt consulted, pinned lookup accepted, text extracted. The suite itself never opens a socket.

---

## 4. Findings

1. **No legacy lead carries a URL source.** Every one of the 120 migrated leads' sources is prose
   ("kachmo_targets.csv (legacy research, no source URL)"); `research_sources` is empty everywhere. The planned legacy
   backfill would always write nothing, so it was **not shipped**. Evidence starts with what people cite.
2. **Revoked suppression — RESOLVED in the release-candidate review.** The read layer and the Phase B write path
   treated revoked entries as active while the publisher and preflight treated them as lifted. Because the write path
   also deduplicated against revoked entries, a new opt-out equivalent only to a revoked (never-published) entry was
   swallowed as "already suppressed" and never published — reproduced, then fixed: every Postgres consumer now reads
   ACTIVE entries only (ADR-010's meaning), with a regression test.
3. **ADR-017's "suppression re-checked inside the transaction" was not true in code.** It is now (ADR-026), and the
   target-number race the old app test relied on is closed.
4. **FOLLOW_UP_SENT was a latent ownership violation.** The CLI wrote a Titan-owned field before cutover. The app
   cannot (ADR-019).
5. **Concurrency — PROVEN on real Postgres** (release-candidate review): `npm --prefix os run test:concurrency`, 36/36
   against loopback Postgres 16 with two independent connection pools (see ADR-026).
6. Evaluations are attributed to the ACTIVE methodology and refused if it is not the one the engine implements; the
   test fixtures that write evaluations now seed `methodology_version` as a real post-cutover database has it.
7. **Local production-writer guard — ADDED** (release-candidate review): a development server can never write to a
   hosted database; a production build must name the exact host it may write (ADR-027 §0).

---

## 5. Production runbook — NOT executed; each step is an owner decision

Run from `Clients/mails/os`. Every data step is dry-run first and applied with the digest it prints.

0. **Commit** Phase A and Phase B with explicit paths (never the queue/markdown churn: `AADI_DAILY_CALLS.md`,
   `DAILY_WAR_ROOM.md`, `RESEARCH_QUEUE.md`, `WHATSAPP_QUEUE.md`, `database/research-queue.json`, `queues/*.json`).
1. **Schema:** rehearse on a disposable Neon branch (`db:rehearse:hosted`), then
   `KACHMO_MIGRATE_CONFIRM_HOST=<host> npm run db:migrate`. Hash production data before and after.
2. **Bind people:** `npm run actor:bind -- --user=<email> --as=DEV|AADI --actor="<owner name>"` for each writer.
   Settings → *Unbound writers* must be empty.
3. **Re-evaluate:** `npm run leads:reevaluate` (dry run). Rehearsed expectation (see
   `PHASE_B_PRODUCTION_REHEARSAL_2026-09-19.md`): **23 leads change, each only `next_action`** (the 18 reconciled
   webmail sends + 106–110 sent by the cron on 2026-09-14), 97 evaluation-only, no state or priority change.
   **Anything else: stop and investigate before applying.** Then
   `npm run leads:reevaluate -- --apply --confirm=<digest> --actor="<name>"`.
4. **Switch writes on** only in the designated production deployment: `KACHMO_APP_WRITES=on` **and**
   `KACHMO_APP_WRITES_HOST=<the exact production database host>`, in a production build. Never in `os/.env.local`;
   a development server refuses hosted writes regardless.
5. **Evidence**, when there is some: `npm run evidence:fetch` (dry run: lists URLs, no network), then
   `-- --apply --actor="<name>"`. Review on the lead page.
6. Root `npm run audit:baseline` after any production-affecting commit.

**Rollback:** `KACHMO_APP_WRITES` off stops every application write instantly. Code reverts cleanly (the schema is
additive and ignored by old code). A bad lead write is undone with `leads:revert` (forward-only; never across a
suppression). Evidence and retrievals are append-only facts that never changed a lead.

---

## 6. Open decisions for the owner

1. **Methodology v1.1** — should RETRIEVED / SUPPORTED / CONTRADICTED evidence ever affect a gate? (Needs a measured
   diff over live data and a new golden.)
2. **Where the app runs** in production. It is not deployed; with writes on, the host is a production writer.
5. robots.txt policy, if different from "honour it; a 5xx means disallow".
6. ADR-013 taxonomy (unchanged, still open).

---

## 7. What did not happen

- No commit, push, deployment, production migration, production read or production write.
- No email, WhatsApp message or call was sent; no Titan file, workflow, queue or send path was touched.
- No gate, score, threshold, priority or research-state semantic changed; no golden baseline was regenerated.
- No lead, contact, source or evidence was invented; no LLM was added or enabled.
