import { CALL_OUTCOMES, LOST_REASONS } from '@kachmo/core/leads/schema.js';
import { PRIORITY_THRESHOLDS, CONFIRMED_COMPLETENESS, SCORE_BASIS } from '@kachmo/core/scoring/score.js';
import { SCOPE_BY_ARCHETYPE } from '@kachmo/core/leads/opportunity.js';
import { MAX_UNANSWERED_ATTEMPTS, MIN_HOURS_BETWEEN_ATTEMPTS } from '@kachmo/core/queues/calls.js';

/**
 * Methodology v1.0 = the tested core/ engine. This record DESCRIBES it for attribution; it does not configure it.
 * Behaviour is defined by core/ and pinned by scripts/__tests__/golden/methodology-v1.0.baseline.json.
 * Conflicting prose versions (5-gate SKILL protocol, India adaptations, "v2.3.0" digital-acquisition gate) are
 * recorded as unadopted proposals only (Phase 0 assessment §3.1).
 */
export const METHODOLOGY_V1_0 = {
  id: '1.0',
  status: 'ACTIVE' as const,
  title: 'Kachmo Methodology v1.0 (8-gate engine, V2 hardened 2026-09-14)',
  description:
    'Deterministic 8-gate qualification, research completeness, heuristic commercial scoring, contact provenance and suppression as implemented in core/. Missing information is never FAIL; UNVERIFIED claims do not block; FAIL requires evidence or an outreach block. Scores are heuristic, not conversion probabilities.',
  goldenBaselineSha256: null as string | null,
  createdByLabel: 'MIGRATION',
  config: {
    engine: 'core/',
    goldenBaseline: 'scripts/__tests__/golden/methodology-v1.0.baseline.json',
    goldenInputCommit: '48cfbc0a8d3364fc95654c68b9764cc8af7013ab',
    gates: [
      { id: 'gate_1_decision_maker', label: 'Decision Maker', blocksWhenPending: true },
      { id: 'gate_2_contactability', label: 'Contactability', blocksWhenPending: true },
      { id: 'gate_3_commercial_proof', label: 'Commercial Proof', blocksWhenPending: true },
      { id: 'gate_4_digital_friction', label: 'Digital Friction', blocksWhenPending: true },
      { id: 'gate_5_location_timezone', label: 'Location / Timezone', blocksWhenPending: true },
      { id: 'gate_6_budget_probability', label: 'Budget Probability', blocksWhenPending: false },
      { id: 'gate_7_buying_intent', label: 'Buying Intent', blocksWhenPending: false },
      { id: 'gate_8_kachmo_fit', label: 'Kachmo Fit', blocksWhenPending: true },
    ],
    gateOutcomes: ['PASS', 'UNVERIFIED', 'PENDING', 'UNKNOWN', 'FAIL'],
    contactProvenance: ['UNKNOWN', 'INFERRED', 'UNVERIFIED', 'PUBLICLY_LISTED', 'VERIFIED', 'INVALID'],
    outreachUsableProvenance: ['PUBLICLY_LISTED', 'VERIFIED'],
    scoring: { basis: SCORE_BASIS, priorityThresholds: PRIORITY_THRESHOLDS, confirmedCompletenessMin: CONFIRMED_COMPLETENESS },
    archetypeScopeDefaults: SCOPE_BY_ARCHETYPE,
    calling: { maxUnansweredAttempts: MAX_UNANSWERED_ATTEMPTS, minHoursBetweenAttempts: MIN_HOURS_BETWEEN_ATTEMPTS, outcomes: CALL_OUTCOMES },
    lostReasons: LOST_REASONS,
    knownLimitations: ['A source is "recorded" when it is URL-shaped (isUrl); URL existence and support for the claim are not verified in v1.0.'],
    unadoptedProposals: ['SKILL.md 5-gate discard protocol', 'SKILL.md 8-gate prose differences (support@ disqualifies, no friction = FAIL, A+ capped below 65% completeness)', 'India-adapted gates (SKILL.md §1a)', 'v2.3.0 digital-acquisition Gate 1'],
  },
};
