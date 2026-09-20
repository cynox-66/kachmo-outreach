import type { QualificationGates } from '../leads/schema.js';
import { atLeast, strictGateOutcomeFor, type EvidenceLevel } from './evidence.js';

/**
 * GATE EVIDENCE COVERAGE (Phase D, ADR-031).
 *
 * Methodology v1.0 asks "is there a source?" and accepts a URL-shaped string. This says something different and
 * strictly more informative: **how far has that source actually been taken** for each gate — offered, fetched, or
 * read by a person and confirmed to state the claim.
 *
 * It is a measurement, not a decision: nothing here changes a gate outcome, a score or a state. The gates keep
 * reading the lead record exactly as they always have (ADR-011, ADR-024). Coverage is shown to a person so they can
 * see which conclusions rest on a checked source and which rest on a string.
 */

/** The claim fields each gate's judgement rests on. Fields with no external source (a human judgement) are empty. */
export const GATE_CLAIM_FIELDS: Record<keyof QualificationGates, readonly string[]> = {
  gate_1_decision_maker: ['decision_maker_name'],
  gate_2_contactability: ['decision_maker_email', 'decision_maker_phone'],
  gate_3_commercial_proof: ['commercial_validation_signal'],
  gate_4_digital_friction: ['observable_friction'],
  gate_5_location_timezone: ['timezone'],
  gate_6_budget_probability: ['budget_probability'],
  gate_7_buying_intent: ['trigger_event'],
  gate_8_kachmo_fit: [],
};

export interface GateCoverage {
  gate: keyof QualificationGates;
  /** The gate outcome Methodology v1.0 produced — unchanged, shown for comparison. */
  outcome: string;
  /** The strongest evidence level recorded for any of the gate's claim fields. */
  level: EvidenceLevel;
  /** True when a person recorded that a source contradicts one of those claims. */
  contradicted: boolean;
  /** The fields this was measured over, so the number is traceable. */
  fields: readonly string[];
}

/** The strongest level in a set, with CONTRADICTED reported separately because it is not "stronger". */
export function bestLevel(levels: readonly EvidenceLevel[]): { level: EvidenceLevel; contradicted: boolean } {
  const contradicted = levels.includes('CONTRADICTED');
  const ranked = levels.filter(l => l !== 'CONTRADICTED');
  return { level: ranked.reduce<EvidenceLevel>((best, l) => (atLeast(l, best) ? l : best), 'NONE'), contradicted };
}

/**
 * Coverage for every gate. `levelsByField` is what the caller recorded for this lead's claims (from its evidence
 * store); a field with no evidence contributes NONE.
 */
export function gateCoverage(gates: QualificationGates, levelsByField: Record<string, EvidenceLevel[]>): GateCoverage[] {
  return (Object.keys(GATE_CLAIM_FIELDS) as Array<keyof QualificationGates>).map(gate => {
    const fields = GATE_CLAIM_FIELDS[gate];
    const levels = fields.flatMap(f => levelsByField[f] ?? []);
    const { level, contradicted } = bestLevel(levels);
    return { gate, outcome: gates[gate], level, contradicted, fields };
  });
}

/** One line an operator can read: how much of this lead's qualification rests on a source a person has checked. */
export function coverageSummary(coverage: GateCoverage[]): { checked: number; retrieved: number; claimedOnly: number; contradicted: number; measurable: number } {
  const measurable = coverage.filter(c => c.fields.length > 0);
  return {
    measurable: measurable.length,
    checked: measurable.filter(c => c.level === 'SUPPORTED').length,
    retrieved: measurable.filter(c => c.level === 'RETRIEVED').length,
    claimedOnly: measurable.filter(c => c.level === 'URL_SHAPED' || c.level === 'CLAIMED' || c.level === 'NONE').length,
    contradicted: measurable.filter(c => c.contradicted).length,
  };
}

/**
 * SHADOW MEASUREMENT (Phase D, ADR-032) — what an evidence-strict reading WOULD say, without saying it.
 *
 * ADR-011 already defines `strictGateOutcomeFor`: the mapping that would apply if a URL nobody has fetched stopped
 * counting as a passed source. No gate calls it, and none does here either. This computes, per gate, the outcome
 * that mapping would produce for the evidence actually recorded, so an owner can SEE the difference before deciding
 * whether a Methodology v1.1 should exist.
 *
 * Deliberately limited to gate outcomes. It does not derive a shadow research state: the state rules belong to the
 * engine, and duplicating them here would put the methodology in two places. Activating a new methodology means
 * running the real engine under a new version, with its own golden and an explicit re-evaluation.
 */
export interface ShadowGateDifference {
  gate: keyof QualificationGates;
  current: string;
  shadow: string;
  level: EvidenceLevel;
}

/** Gate outcomes that would differ under the strict reading. Gates with no recorded evidence are left alone. */
export function shadowDifferences(coverage: GateCoverage[]): ShadowGateDifference[] {
  return coverage
    .filter(c => c.fields.length > 0 && (c.level !== 'NONE' || c.contradicted))
    .map(c => ({ gate: c.gate, current: c.outcome, shadow: strictGateOutcomeFor(c.contradicted ? 'CONTRADICTED' : c.level), level: c.contradicted ? ('CONTRADICTED' as EvidenceLevel) : c.level }))
    .filter(d => d.current !== d.shadow);
}
