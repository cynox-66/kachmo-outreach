# `core/` — the Kachmo lead-intelligence engine

`core/` is the single implementation of Kachmo's qualification, scoring, research-completeness, contact-provenance,
suppression, deduplication and queue-eligibility rules: **Methodology v1.0**. The CLIs in `scripts/` and the future
hosted application in `os/` are adapters around it. There must never be a second copy of these rules anywhere else.

```
CLI (scripts/)  ─┐
Hosted app (os/) ─┼──►  core/  (pure rules, no I/O)
IDE import API   ─┘        ▲
                           │ adapters load/save data (JSON store today, Postgres later)
```

## Modules

| Module | Public interface | Extracted from |
|---|---|---|
| `leads/schema.ts` | `KachmoLead`, `GateOutcome`, `ContactProvenance`, `ResearchState`, `SuppressionEntry`, queue item types, `CALL_OUTCOMES`, `LOST_REASONS`, … | `scripts/lib/schema.ts` |
| `leads/validation.ts` | `validateLeadDatabase`, `leadRecordProblems`, `duplicateLeadIdentity` | `scripts/lib/store.ts` (`loadLeads`) |
| `leads/invariants.ts` | `findInvariantViolations` — impossible states no adapter may persist | `scripts/lib/invariants.ts` |
| `leads/dedupe.ts` | `findDuplicates`, `normalizeCompanyName` — flag only, never delete or merge | `scripts/leads-dedupe.ts` |
| `leads/opportunity.ts` | `applyOpportunity`, `SCOPE_BY_ARCHETYPE` — channel strategy, OUTREACH_READY, deterministic next action | `scripts/leads-opportunity.ts` |
| `contact/provenance.ts` | `phoneEligibility`, `emailRoute`, `whatsappEligibility`, `classifyEmail`, `OUTREACH_USABLE`, normalisers (`normalizeEmail`, `phoneKey`, `normalizeDomain`, `isUrl`) | `scripts/lib/contact.ts` |
| `suppression/match.ts` | `outreachBlock` (the one block check), `checkSuppression`, `suppressionEntryProblems`, `isEquivalentSuppression` | `scripts/lib/contact.ts`, `scripts/lib/store.ts` |
| `qualification/gates.ts` | `evaluateLeadGates` (8 gates), `applyQualification`, `isGenericDecisionMaker` | `scripts/leads-qualify.ts` |
| `qualification/completeness.ts` | `researchCompleteness`, `gateCredit` | inside `evaluateLeadGates` |
| `scoring/score.ts` | `calculateLeadScores`, `applyScores`, `PRIORITY_THRESHOLDS`, `CONFIRMED_COMPLETENESS`, `SCORE_BASIS` | `scripts/leads-score.ts` |
| `research/tasks.ts` | `taskFor`, `buildResearchQueue`, `FIELD_ORDER` | `scripts/leads-research-queue.ts` |
| `queues/calls.ts` | `callEligibility`, `buildCallCard`, `selectCallQueue`, `MAX_UNANSWERED_ATTEMPTS`, `MIN_HOURS_BETWEEN_ATTEMPTS` | `scripts/queue-calls.ts` |
| `queues/whatsapp.ts` | `selectWhatsAppQueue`, `buildWhatsAppDraft`, `waLinkDigits` (human send only) | `scripts/queue-whatsapp.ts` |
| `email-ledger/tracker.ts` | `parseTrackerContent`, `scheduledQueueFromJson`, `EMAIL_SENT_STATUSES` … (read-only interpretation of Titan's ledger) | `scripts/lib/email-state.ts` |
| `email-ledger/queue-check.ts` | `findEmailQueueIssues` (duplicate / already-sent / suppressed recipients in the scheduled queue) | `scripts/email-queue-check.ts` |
| `email-ledger/send-guard.ts` | `evaluateSendGuard`, `outboundEmailKind` — suppression, duplicate-send and ledger-state guard for direct Titan sends (no override) | new in Phase 1.1 |
| `email-ledger/ledger-update.ts` | `applyLedgerSendUpdate` — the ledger transition written after a successful direct send | new in Phase 1.1 |
| `geo/timezone.ts` | `resolveTimezone` (never guesses multi-timezone countries), `addDays` | `scripts/lib/geo.ts` |
| `util/text.ts` | `short`, `greetName`, `priorityLabel`, `signalSummary`, `wordCount` | `scripts/lib/text.ts` |

Everything is re-exported from `core/index.ts`. The old `scripts/` modules re-export the same names, so every
existing import and every `npm run …` command keeps working unchanged.

## Dependency rules

1. **No I/O.** No `fs`, `path`, `child_process`, network, `process.env`, database drivers, mail or auth libraries.
   `core/tsconfig.json` has **no Node or DOM types**, so such code does not compile. The only declared platform
   global is the WHATWG `URL` parser (`platform.d.ts`). The golden runner's boundary group re-checks this.
2. **Nothing outside `core/` is imported.** `scripts/` and `os/` depend on `core/`, never the reverse.
3. **The clock and "today" are parameters.** `callEligibility(…, today, now?)`, `buildResearchQueue(…, now)`,
   `applyQualification(lead, result, now)`. The one exception: `callEligibility` / `selectCallQueue` keep their
   historical `Date.now()` default when `now` is omitted.
4. **`apply*` functions mutate the lead object passed in**, field by field in the historical order, and return what
   changed. They perform no persistence and log no events; the adapter decides whether to save and what to record.
   To preview without mutating, pass a copy.
5. **No way to switch suppression off.** `outreachBlock` has no override parameter, and none may be added.

## Persistence boundaries

- `scripts/lib/store.ts` is the JSON adapter: strict load (`validateLeadDatabase`), concurrent-modification guard,
  invariant check (`findInvariantViolations`), shrink guard, backup, atomic write. It is still the only writer of
  `database/kachmo_leads.json`.
- `scripts/lib/email-state.ts` reads `OUTREACH_TRACKER.md` / `scheduled-queue.json` from disk and hands the content to
  `core/email-ledger`. core never writes Titan files.
- The future Postgres adapter (`os/`) must call the same `validateLeadDatabase` / `findInvariantViolations` before
  every write.

## Not yet extracted (deliberately, still in `scripts/`)

These contain business rules but are entangled with CLI argument handling. They move in Phase 1.4, when the hosted
write paths are built, with their own golden coverage:

- research recording and provenance upgrade rules — `scripts/leads-record.ts`
- call outcome state machine — `scripts/call-log.ts`
- WhatsApp APPROVED → SENT state machine — `scripts/whatsapp-log.ts`
- sales pipeline ordering — `scripts/pipeline-log.ts`
- suppression propagation to leads — `scripts/suppress-add.ts`
- CSV migration and human-data preservation — `scripts/migrate-csv-to-leads.ts`
- war room and weekly report aggregation — `scripts/war-room.ts`, `scripts/analytics-weekly.ts`

## Known v1.0 evidence limitation (do not "fix" inside v1.0)

Gates and research completeness treat a value as **sourced** when its source field is URL-shaped (`isUrl`). That
proves format, not that the page exists or supports the claim. Changing this would change Methodology v1.0
behaviour. It is addressed *upstream* in Phase 2: externally supplied URLs are stored as unreviewed evidence and only
reach a lead's `*_source` field after a human checks them, so the unchanged engine then evaluates them.

## Testing

| Command | What it proves |
|---|---|
| `npm run test:legacy` | The original 225-assertion suite (temp workspaces; never writes the repository) |
| `npm run test:golden` | **Golden behaviour.** The 120 real leads, pinned at git commit `48cfbc0`, produce results identical to the pre-extraction baseline (`scripts/__tests__/golden/methodology-v1.0.baseline.json`), both through the CLI modules and through `core/` directly; plus the dependency boundary above |
| `npm test` | Both of the above |
| `npm run typecheck` | `core/` with no Node types, then `scripts/` + `core/` strictly |

The golden baseline was captured once from the untouched legacy code. It stores contact-bearing values as SHA-256
hashes and strips run-time timestamps. **Never regenerate it to make a failing test pass.** A deliberate methodology
change ships as a new version with its own new baseline file.
