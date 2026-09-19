import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { KachmoLead, SuppressionEntry } from '@kachmo/core/leads/schema.js';
import { evaluateLeadGates, applyQualification } from '@kachmo/core/qualification/gates.js';
import { calculateLeadScores, applyScores } from '@kachmo/core/scoring/score.js';
import { applyOpportunity } from '@kachmo/core/leads/opportunity.js';
import { outreachBlock } from '@kachmo/core/suppression/match.js';
import { eventSubject, type DomainEvent } from '@kachmo/core/state/decision.js';
import { canonicalJson, sha256 } from '../db/migration/canonical';
import { REPO_ROOT } from '../repo/titan-ledger';

/**
 * DETERMINISTIC RE-EVALUATION (ADR-020).
 *
 * The Postgres counterpart of `npm run leads:refresh`: for one lead, exactly the chain the CLI runs over every lead,
 * in exactly its order — 8-gate qualification → heuristic scoring → opportunity, channel, readiness and next action.
 * Nothing here decides anything new; every rule is core/'s, and the golden baseline is the parity oracle.
 *
 * The CLI runs each step over all leads before starting the next. No step reads another lead, so running the three
 * steps per lead produces the same records — which the parity test proves against the pinned baseline.
 *
 * Pure apart from reading core's build to name the engine revision. The caller persists the result.
 */

export interface ReevaluationContext {
  suppression: SuppressionEntry[];
  ledgerStatus: string | null;
  /** Stamped on `updated_at` when the research state changes, exactly as applyQualification always has. */
  now: string;
}

export interface EvaluationRecord {
  gates: unknown;
  missingIntelligence: string[];
  reasons: string[];
  researchState: string;
  researchCompletenessScore: number;
  scores: Record<string, unknown>;
  leadPriority: string | null;
  priorityConfidence: string | null;
  inputSha256: string;
}

export interface Reevaluation {
  /** The lead after re-evaluation. The input is never mutated. */
  next: KachmoLead;
  /** Top-level fields whose value differs from the input. Empty means re-evaluation changed nothing. */
  changedFields: string[];
  /** The events the CLI would have appended for this lead (actor SYSTEM, as leads:qualify / leads:score record). */
  events: DomainEvent[];
  evaluation: EvaluationRecord;
}

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

/** Top-level keys whose values differ between two records. */
export function changedKeys(before: KachmoLead, after: KachmoLead): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(k => !same((before as unknown as Record<string, unknown>)[k], (after as unknown as Record<string, unknown>)[k])).sort();
}

/**
 * What an evaluation describes: the record as it is STORED after re-evaluation (less its timestamp), the ledger
 * status and the suppression verdict for this lead. Re-evaluation is a fixed point — evaluating that stored record
 * again yields exactly the same gates, scores and record — so this hash names the input any later evaluation of the
 * lead would see, and "is this lead's current state already evaluated?" is a lookup rather than a recomputation.
 */
export function evaluationInputSha(lead: KachmoLead, ctx: Pick<ReevaluationContext, 'suppression' | 'ledgerStatus'>): string {
  const record: Record<string, unknown> = { ...lead };
  delete record.updated_at;
  const block = outreachBlock(lead, ctx.suppression, ctx.ledgerStatus);
  return sha256(canonicalJson({ record, ledgerStatus: ctx.ledgerStatus, block: block.blocked ? block.reason : null }));
}

export function reevaluateLead(lead: KachmoLead, ctx: ReevaluationContext): Reevaluation {
  const next = structuredClone(lead);
  const events: DomainEvent[] = [];

  // 1. leads:qualify
  const q = evaluateLeadGates(next, ctx.suppression, ctx.ledgerStatus);
  const qualification = applyQualification(next, q, ctx.now);
  if (qualification.changed) {
    events.push({ ...eventSubject(next), event_type: 'QUALIFICATION_CHANGED', channel: 'SYSTEM', actor: 'SYSTEM', payload: { from: qualification.previousState, to: q.state, reasons: q.reasons } });
  }

  // 2. leads:score
  const s = calculateLeadScores(next);
  const scoring = applyScores(next, s);
  if (scoring.changed) {
    events.push({ ...eventSubject(next), event_type: 'PRIORITY_CHANGED', channel: 'SYSTEM', actor: 'SYSTEM', payload: { from: scoring.previousPriority, to: s.priority, kachmo_score: s.kachmoScore } });
  }

  // 3. leads:opportunity
  applyOpportunity(next, ctx.suppression, ctx.ledgerStatus);

  return {
    next,
    changedFields: changedKeys(lead, next),
    events,
    evaluation: {
      gates: q.gates,
      missingIntelligence: q.missing,
      reasons: q.reasons,
      researchState: next.research_state,
      researchCompletenessScore: q.completenessScore,
      scores: {
        commercialFitScore: s.commercialFitScore,
        painScore: s.painScore,
        dmQualityScore: s.dmQualityScore,
        budgetScore: s.budgetScore,
        intentTriggerScore: s.intentTriggerScore,
        kachmoScore: s.kachmoScore,
        signals: s.signals,
      },
      leadPriority: next.lead_priority ?? null,
      priorityConfidence: next.priority_confidence ?? null,
      inputSha256: evaluationInputSha(next, ctx),
    },
  };
}

// ── Engine revision ──────────────────────────────────────────────────────────

let cachedEngineRef: string | null = null;

/**
 * Names the exact engine that produced an evaluation: a SHA-256 over every file of core's emitted build, in sorted
 * path order. The same core sources always build to the same bytes, so the reference is stable across machines and
 * changes exactly when the engine does. `core/` itself is not modified to provide it.
 *
 * When the build is not on disk (a bundled deployment), the reference says so rather than inventing one.
 */
export function engineRef(root: string = REPO_ROOT): string {
  if (cachedEngineRef && root === REPO_ROOT) return cachedEngineRef;
  const dist = join(root, 'core', 'dist');
  if (!existsSync(dist)) return 'core-dist:unavailable';
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.js')) files.push(p);
    }
  };
  walk(dist);
  const h = createHash('sha256');
  for (const f of files) {
    h.update(f.slice(dist.length));
    h.update('\0');
    h.update(readFileSync(f));
    h.update('\0');
  }
  const ref = `core-dist:${h.digest('hex').slice(0, 16)}`;
  if (root === REPO_ROOT) cachedEngineRef = ref;
  return ref;
}
