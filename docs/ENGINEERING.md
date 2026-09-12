# Engineering Constitution, Principles & Quality Standards

> **Status:** Canonical & Supreme  
> **Owner:** Solo Operator / Principal Engineer  
> **Last Updated:** 2026-09-11  
> **Version:** 1.1.0  

---

## 1. Project Constitution (The Supreme Law)

This Constitution is the highest authority in the repository. Everything else follows it.

### Article I: Fundamental Mandate
Lead Engine exists for exactly **ONE** purpose: To consistently deliver high-quality freelance web development client opportunities to a single operator at **under $2.00/month operating cost** in **under 30 minutes** of daily effort.

### Article II: The Triad of Justification
No code, prompt, dependency, or feature may exist unless it directly satisfies at least one of these three criteria:
1. **IMPROVES LEAD QUALITY** (Higher client budget, stronger fit)
2. **INCREASES LEAD VOLUME** (More qualified candidates per batch)
3. **REDUCES REVIEW TIME** (Faster operator triage in Google Sheets)

### Article III: The Rule of Immediate Deletion
- If a scraper breaks twice in one month: **DELETE THE SOURCE**.
- If a prompt causes hallucinations: **ROLL BACK THE PROMPT**.
- If a query yields < 1% positive replies: **PURGE THE QUERY**.

---

## 2. The 10 Governing Engineering Axioms

```
 1. Money > Architecture            6. Google Sheets > Database
 2. Rules > AI                     7. Manual Approval > Automated Outreach
 3. Workflow > Application         8. Batch Execution > Continuous Queues
 4. Evidence > Assumptions         9. Queries > Platform Scrapers
 5. One Script > Microservices     10. Revenue > Infrastructure
```

- **Money > Architecture:** Build only what directly accelerates client acquisition and revenue.
- **Rules > AI:** Compute deterministic checks (HTTP, DOM overflow, regex) before calling any LLM.
- **Workflow > Application:** Use Google Sheets as database and UI; never build custom web dashboards.
- **Evidence > Assumptions:** Never assert a website defect without empirical DOM or screenshot proof.
- **Delete Before Adding:** Exhaust all possibilities of removing code before adding new lines.

---

## 3. Engineering Mantras

```
Money > Architecture.
Delete before adding.
Every dependency must justify itself.
Rules are cheap.
AI is expensive.
Workflows beat applications.
Google Sheets is your database.
Revenue funds engineering.
Never build for imaginary scale.
Never optimize for hypothetical future users.
Evidence beats assumptions.
Humans send messages.
Bots do not close clients.
If it does not improve lead quality, delete it.
If it does not increase lead volume, delete it.
If it does not save review time, delete it.
Batch execution beats continuous queues.
Deterministic checks come first.
One script beats multiple microservices.
A dirty script that makes money beats an elegant system that does not.
Thirty minutes in the evening is the absolute limit.
Simplicity always wins.
Open public web sources beat bot arms races.
Never invent a website defect.
Speak to prospects as an engineering peer.
Outcomes change weights, not intuition.
Unit economics precede automation.
A broken scraper should be deleted, not nurtured.
Zero dollars per month is the target.
Three dollars per month is the absolute ceiling.
When in doubt, delete code.
```

---

## 4. Definition of Done (The 10 Gates)

Every milestone and PR is complete only if:
1. **Implementation Complete:** Fully functional without placeholder stubs.
2. **Zero TypeScript Errors:** Strict compilation passes with `tsc --noEmit`.
3. **Zero Lint Warnings:** Passes `npm run lint` cleanly.
4. **100% Passing Tests:** All Vitest unit and regression tests pass.
5. **No TODOs:** Zero lingering TODO comments in production code paths.
6. **Manual Run Verified:** End-to-end batch execution verified with real output in Google Sheets.
7. **Cost Verified:** Projected monthly spend stays at or under the $2.00 soft cap; every service except Gemini stays inside free-tier allowances.
8. **Documentation Synchronized:** Relevant `docs/` files and README updated.
9. **Changelog Updated:** Version entry added to `CHANGELOG.md`.
10. **CI Passing:** GitHub Actions CI build passes cleanly.

---

## 5. Pre-Commit Engineering Checklist

Run before committing:
```bash
npm run test && npx tsc --noEmit && npm run lint
```

- [ ] **Architecture:** Improves lead quality, volume, or review time?
- [ ] **Simplicity:** Did I attempt to delete code before adding new lines?
- [ ] **Determinism:** Are deterministic rules running before AI?
- [ ] **Performance:** Are Playwright pages/contexts closed in `finally` blocks?
- [ ] **Cost:** Does this change keep projected monthly spend at or under the $2.00 soft cap?
- [ ] **Security:** Zero secrets or `.env` files staged for commit?
- [ ] **Staging:** Does `git diff --cached --stat` contain *only* files belonging to this change?
- [ ] **Message:** Does the commit subject describe the whole staged diff, not just the headline?
- [ ] **Prompts:** Does the AI prompt forbid hallucinated defects?
- [ ] **Docs:** Are documentation and `CHANGELOG.md` updated?

---

## 6. Git Hygiene & Repository Protocol

**Remote of record:** `https://github.com/cynox-66/Reachout-system-for-kachmo.git` (private).
`main` is the trunk and the only long-lived branch. The repository is private because
`docs/` carries commercial strategy, pricing and prospect reasoning — not because the
code is secret.

### 6.1 Staging Discipline

`git add -A` stages whatever the working tree happens to be holding, including
half-finished work from an unrelated sitting. Before every commit:

```bash
git status --short                # what is about to move
git diff --cached --stat          # what actually got staged
```

- **One logical change per commit.** If the staged set spans two unrelated concerns,
  commit them separately. A commit is a unit of revert, not a save point.
- **The message must describe the whole diff.** A subject line naming one feature on a
  commit that also carries three unrelated documents is a message that lies to the next
  reader — usually you, six months out, running `git log` to find when something broke.
- **Never stage a file you have not looked at.** Untracked research notes and scratch
  files are the usual stowaways.

### 6.2 Secrets

`.gitignore` covers `.env`, `*.pem`, `*.key`, `service-account*.json`, `credentials.json`
and `artifacts/`. That is a safety net, not a policy — verify before pushing to any remote:

```bash
git diff --cached --name-only | xargs grep -lEI 'AIza[0-9A-Za-z_-]{20,}|BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}'
```

Placeholders in `.env.example` and obvious fakes in tests are fine and expected. A real
key that reaches a remote is burned even if the commit is reverted one minute later —
the fix is to rotate the key, never to rewrite the history.

`artifacts/` stays untracked by design. `spend-log.json` is per-machine observability,
not shared state; committing it would create merge conflicts over a file nobody reads
from version control.

### 6.3 Commit Messages

Conventional Commits, scoped to the module touched:

```
feat(pipeline): add deterministic opportunity score for Track B
fix(qualify): stop rejecting React sites on missing booking markup
docs(engineering): record git hygiene protocol
```

Body lists the substantive changes as bullets. Explain **why** where the reason is not
self-evident from the diff — the code shows what changed, never what it was for.

### 6.4 Pre-Push Verification

The pipeline runs unattended on a cron. A broken `main` is discovered by a silent batch
failure at 06:00 UTC, not by a human at the keyboard, so `main` stays green:

```bash
npm test && npm run build && npm run lint
```

### 6.5 Destructive Operations

`--force`, `--force-with-lease`, history rewrites, branch deletion and repository
deletion are **verify-first** operations. Confirm what is actually there before acting:

```bash
git ls-remote origin              # refs the remote really has
git log --oneline origin/main..HEAD   # what you are about to overwrite
```

An empty remote takes a plain `git push -u origin main`; it needs no force and no
rebase. Reach for force only when a real divergence exists and you have read it.

---

## 7. Feature Proposal Evaluation Rubric

Before proposing any feature, evaluate against the **7-Dimension Rubric**:

```
Dimension                 Threshold for Rejection
────────────────────────────────────────────────────────────────────────
Business Value            < 7 / 10                          ──► REJECT
Engineering Effort        > 6 Hours (More than 3 evenings)  ──► REJECT
Maintenance Burden        Medium or High                    ──► REJECT
Monthly Cost              > $2.00 projected (soft cap)      ──► REJECT
Opportunity Cost          Consumes billable client time     ──► REJECT
Formula Alternative       Exists in Google Sheets           ──► USE FORMULA
The Triad Justification   Fails all 3 criteria              ──► REJECT
```

---

## 8. Dependency Policy & Governance

Every third-party package must pass 6 evaluation gates:
1. **Necessity:** Cannot be implemented natively in $\le 30$ lines of TypeScript.
2. **Zero Cost:** 100% free open-source with no required paid API keys.
3. **Runtime Impact:** Fast install, minimal bundle size.
4. **Maintenance Health:** Actively maintained by reputable maintainers.
5. **Security Audit:** Zero high/critical vulnerabilities on `npm audit`.
6. **Removal Strategy:** Can be cleanly removed or replaced in under 2 hours.

*Disallowed Packages:* `lodash`, `moment`, `node-fetch`, `chalk`, `rimraf` (use native Node 20+ built-ins).

---

## 9. Historical Decision Journal

- **[DEC-001] A Single Flash-Lite Multimodal Model:** Eliminated multi-model chaining (Gemini Pro + Claude Sonnet) to reduce cost to $0.00 and latency by 60%. Originally realised with `gemini-2.5-flash-lite`; see DEC-009 for the current model.
- **[DEC-002] In-Memory Screenshots Without Object Storage:** Held JPEG buffers in memory during Playwright execution and streamed to Gemini without persisting to R2/S3.
- **[DEC-003] 4-Gate Decision Tree Over Weighted Scoring:** Replaced arbitrary linear math with sequential binary gates (Fit ➔ Commercial ➔ Need ➔ Reach).
- **[DEC-009] Migration to `gemini-3.5-flash-lite` (2026-08-11):** Google closed `gemini-2.5-flash-lite` and `gemini-2.5-flash` to new API keys — both still appear in `models.list` but return `404 "no longer available to new users"` from `generateContent`. Every candidate model was probed against the live API for the four capabilities this pipeline needs (generateContent, image input, `responseMimeType: application/json`, `responseSchema`). `gemini-3.5-flash-lite` passed all four and is the newest Flash-Lite tier. Pinned to an explicit version rather than the `gemini-flash-lite-latest` alias, because a moving alias would change lead scoring mid-run.
- **[DEC-011] Images and Fonts Are No Longer Blocked During Audits (2026-08-11):** Resource interception originally aborted `image` and `font` requests for speed. This corrupted the audit's own evidence: `hasBrokenImages` tests `naturalWidth === 0`, which is true by construction when every image is aborted (48 of 50 sites in a live run), and the screenshot — the multimodal model's primary evidence — rendered every site as a skeleton of placeholders. The engine was generating outreach copy describing broken hero images and failed webfonts on sites that render perfectly. Images and fonts now load; only `media`, `websocket`, `eventsource`, `manifest` and tracker URLs are blocked, all of which are invisible to a still screenshot. Additionally, `page.on('requestfailed')` fires for requests the engine aborts itself, so those are now filtered out of `failedNetworkUrls` via `isSelfInflictedFailure`.
- **[DEC-012] Structured Output via `responseSchema` (2026-08-11):** A live run produced `issues[].type = "modern_cms_migration"` — a `pitch_angle` value written into an adjacent enum. Prompt wording cannot make that impossible, so the evaluation request now carries an OpenAPI-subset `responseSchema` derived from the same constants as the Zod schema. Zod validation is retained for semantics the schema cannot express (score ranges, evidence length).
- **[DEC-010] Grounding Entitlement Treated as a Preflight Concern (2026-08-11):** The same probe established that Grounding with Google Search is **not available on the Gemini free tier** for any model — its quota is zero, so an ungrounded call succeeds in the same second a grounded one returns 429. Because the status code is identical to an ordinary rate limit, this is now detected explicitly by `checkGeminiGrounding` and surfaced as a preflight warning rather than being discovered as an empty discovery stage.
