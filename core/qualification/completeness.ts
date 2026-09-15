import type { KachmoLead, GateOutcome } from '../leads/schema.js';
import { isUrl } from '../contact/provenance.js';

/** A sourced gate earns full credit, an unsourced claim half, anything else nothing. */
export const gateCredit = (g: GateOutcome) => (g === 'PASS' ? 1 : g === 'UNVERIFIED' ? 0.5 : 0);

export interface CompletenessGateInputs {
  gate1: GateOutcome;
  gate2: GateOutcome;
  gate3: GateOutcome;
  gate4: GateOutcome;
  gate5: GateOutcome;
  gate6: GateOutcome;
  gate8: GateOutcome;
}

/**
 * Research completeness (0–100): the weighted share of required intelligence that is on file AND sourced.
 * Unsourced claims earn half credit. The frontend-team dimension only applies to archetype 1.
 *
 * Returns the missing-intelligence entries this dimension set adds (technology, frontend team) in the exact order
 * the 8-gate evaluation has always appended them.
 *
 * Known v1.0 limitation: "sourced" means `isUrl()` — URL-shaped, not verified. Evidence validation is Phase 2.
 */
export function researchCompleteness(lead: KachmoLead, g: CompletenessGateInputs, triggerCredit: number): { score: number; missing: string[] } {
  const missing: string[] = [];
  const hasTech = !!(lead.current_framework || lead.cms);
  const techCredit = hasTech ? (isUrl(lead.technology_source) ? 1 : 0.5) : 0;
  if (techCredit === 0) missing.push('technology_stack');
  if (techCredit === 0.5) missing.push('technology_source');

  let frontendCredit: number | null = null; // only relevant for white-label agency partners
  if (lead.archetype_id === '1') {
    const known = lead.frontend_team_status && lead.frontend_team_status !== 'NOT_RESEARCHED';
    frontendCredit = known ? (isUrl(lead.frontend_team_evidence) ? 1 : 0.5) : 0;
    if (!known) missing.push('frontend_team_status');
  }
  const budgetCredit = g.gate6 === 'PASS' || g.gate6 === 'FAIL' ? 1 : g.gate6 === 'UNVERIFIED' ? 0.5 : 0;

  const dims: Array<[number, number | null]> = [
    [15, gateCredit(g.gate1)],
    [15, gateCredit(g.gate2)],
    [15, gateCredit(g.gate3)],
    [15, gateCredit(g.gate4)],
    [5, gateCredit(g.gate5)],
    [10, budgetCredit],
    [10, triggerCredit],
    [10, techCredit],
    [5, frontendCredit],
    [5, gateCredit(g.gate8)],
  ];
  const applicable = dims.filter(([, c]) => c !== null) as Array<[number, number]>;
  const score = Math.round(
    (applicable.reduce((s, [w, c]) => s + w * c, 0) / applicable.reduce((s, [w]) => s + w, 0)) * 100
  );
  return { score, missing };
}
