import type { KachmoLead, SuppressionEntry } from '../leads/schema.js';
import { FIELD_OWNERSHIP, OWNED_FIELDS, isImmutableField, type CutoverPhase, type Store } from './ownership.js';

/**
 * DRIFT DETECTION between two stores holding the same leads.
 *
 * Pure comparison: it reports what differs and how serious that is. It never merges, never picks a winner and
 * never writes. Resolution is a human decision, taken with this report in front of them.
 *
 * The design assumption is that in a correct single-writer system this report is EMPTY. Any finding means either
 * a write happened in a store that does not own the field, or a publish did not complete.
 */

export type DriftSeverity = 'BLOCKING' | 'WARNING' | 'INFO';

export interface FieldDrift {
  field: string;
  group: string;
  /** SHA-free: values are not included, because they may be contact data. Presence and shape only. */
  leftPresent: boolean;
  rightPresent: boolean;
  severity: DriftSeverity;
  reason: string;
}

export interface LeadDrift {
  leadId: string;
  targetNumber: string;
  kind: 'ONLY_IN_LEFT' | 'ONLY_IN_RIGHT' | 'IDENTITY_MISMATCH' | 'FIELD_DRIFT';
  severity: DriftSeverity;
  fields: FieldDrift[];
  reason: string;
}

export interface DriftReport {
  phase: CutoverPhase;
  left: Store;
  right: Store;
  leftCount: number;
  rightCount: number;
  leads: LeadDrift[];
  suppression: {
    onlyInLeft: number;
    onlyInRight: number;
    severity: DriftSeverity;
    reason: string;
  };
  /** True when the two stores may be treated as equivalent: no BLOCKING finding anywhere. */
  safeToCutOver: boolean;
  counts: Record<DriftSeverity, number>;
}

/**
 * `updated_at` changes on every write in either store, so comparing it would flag every lead forever and drown
 * the findings that matter. Drift is judged on the fields that carry meaning.
 */
export const DRIFT_IGNORED_FIELDS: readonly string[] = ['updated_at'];

const groupOf = (field: string) => FIELD_OWNERSHIP.find(g => g.fields.includes(field))?.group ?? 'UNCLASSIFIED';

/** Stable comparison of two field values, ignoring object key order. */
function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (v === undefined) return null;
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map(k => [k, norm((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/**
 * How bad a difference in this field is.
 *
 * An immutable field differing is always blocking: identity has broken, and nothing downstream can be trusted.
 * A difference in a field the RIGHT store does not own is blocking too — it means an unauthorised write happened.
 * A difference in a field the right store legitimately owns is expected during a window where it has been
 * accepting writes, so it is informational.
 */
function severityFor(field: string, phase: CutoverPhase, right: Store): { severity: DriftSeverity; reason: string } {
  if (isImmutableField(field)) return { severity: 'BLOCKING', reason: `${field} is immutable and must never differ between stores` };
  const group = FIELD_OWNERSHIP.find(g => g.fields.includes(field));
  if (!group) return { severity: 'BLOCKING', reason: `${field} has no declared owner, so no store is entitled to its value` };
  if (group.group === 'SUPPRESSION' || group.group === 'CONTACT_PROVENANCE') {
    return { severity: 'BLOCKING', reason: `${group.group} decides who may be contacted; the two stores disagreeing is never acceptable` };
  }
  const owner = group.writer[phase];
  if (owner !== right) return { severity: 'BLOCKING', reason: `${group.group} is owned by ${owner} in ${phase}, so ${right} should not differ` };
  return { severity: 'INFO', reason: `${right} owns ${group.group} in ${phase}; the difference is an expected write` };
}

/** A call history that got shorter is data loss whichever store it happened in. */
function callHistoryRegression(left: KachmoLead, right: KachmoLead): FieldDrift | null {
  const l = left.call_attempts?.length ?? 0;
  const r = right.call_attempts?.length ?? 0;
  if (r >= l) return null;
  return {
    field: 'call_attempts',
    group: 'CALL',
    leftPresent: l > 0,
    rightPresent: r > 0,
    severity: 'BLOCKING',
    reason: `call history shrank from ${l} to ${r} attempts; call history is append-only`,
  };
}

/**
 * Compares two sets of leads field by field.
 *
 * `left` is conventionally the store that is canonical in `phase`; `right` is the one being checked against it.
 */
export function compareLeadStores(
  left: { store: Store; leads: KachmoLead[] },
  right: { store: Store; leads: KachmoLead[] },
  phase: CutoverPhase
): Omit<DriftReport, 'suppression' | 'safeToCutOver' | 'counts'> {
  const leftById = new Map(left.leads.map(l => [l.lead_id, l]));
  const rightById = new Map(right.leads.map(l => [l.lead_id, l]));
  const drifts: LeadDrift[] = [];

  for (const l of left.leads) {
    const r = rightById.get(l.lead_id);
    if (!r) {
      drifts.push({
        leadId: l.lead_id,
        targetNumber: l.target_number,
        kind: 'ONLY_IN_LEFT',
        severity: 'BLOCKING',
        fields: [],
        reason: `present in ${left.store} but missing from ${right.store}; leads are never deleted`,
      });
      continue;
    }
    if (l.target_number !== r.target_number) {
      drifts.push({
        leadId: l.lead_id,
        targetNumber: l.target_number,
        kind: 'IDENTITY_MISMATCH',
        severity: 'BLOCKING',
        fields: [],
        reason: `lead_id maps to ${l.target_number} in ${left.store} but ${r.target_number} in ${right.store}`,
      });
      continue;
    }

    const fields: FieldDrift[] = [];
    for (const field of OWNED_FIELDS) {
      if (DRIFT_IGNORED_FIELDS.includes(field)) continue;
      const a = (l as unknown as Record<string, unknown>)[field];
      const b = (r as unknown as Record<string, unknown>)[field];
      if (sameValue(a, b)) continue;
      const { severity, reason } = severityFor(field, phase, right.store);
      fields.push({ field, group: groupOf(field), leftPresent: a !== undefined && a !== null, rightPresent: b !== undefined && b !== null, severity, reason });
    }
    const regression = callHistoryRegression(l, r);
    if (regression && !fields.some(f => f.field === 'call_attempts' && f.severity === 'BLOCKING')) {
      const i = fields.findIndex(f => f.field === 'call_attempts');
      if (i >= 0) fields[i] = regression;
      else fields.push(regression);
    }

    if (fields.length) {
      const severity: DriftSeverity = fields.some(f => f.severity === 'BLOCKING') ? 'BLOCKING' : fields.some(f => f.severity === 'WARNING') ? 'WARNING' : 'INFO';
      drifts.push({
        leadId: l.lead_id,
        targetNumber: l.target_number,
        kind: 'FIELD_DRIFT',
        severity,
        fields,
        reason: `${fields.length} field(s) differ between ${left.store} and ${right.store}`,
      });
    }
  }

  for (const r of right.leads) {
    if (leftById.has(r.lead_id)) continue;
    drifts.push({
      leadId: r.lead_id,
      targetNumber: r.target_number,
      kind: 'ONLY_IN_RIGHT',
      severity: 'BLOCKING',
      fields: [],
      reason: `present in ${right.store} but missing from ${left.store}; a lead appeared in a store that is not its writer`,
    });
  }

  return { phase, left: left.store, right: right.store, leftCount: left.leads.length, rightCount: right.leads.length, leads: drifts };
}

/** Two suppression lists are compared by identifier set: an entry missing from either side is blocking. */
function suppressionKey(e: SuppressionEntry): string {
  return JSON.stringify([e.lead_id ?? '', e.target_number ?? '', (e.email ?? '').toLowerCase(), e.phone ?? '', (e.domain ?? '').toLowerCase()]);
}

export function compareSuppressionLists(left: SuppressionEntry[], right: SuppressionEntry[]): DriftReport['suppression'] {
  const l = new Set(left.map(suppressionKey));
  const r = new Set(right.map(suppressionKey));
  const onlyInLeft = [...l].filter(k => !r.has(k)).length;
  const onlyInRight = [...r].filter(k => !l.has(k)).length;
  const severity: DriftSeverity = onlyInLeft || onlyInRight ? 'BLOCKING' : 'INFO';
  return {
    onlyInLeft,
    onlyInRight,
    severity,
    reason: onlyInLeft
      ? `${onlyInLeft} suppression entr(y/ies) exist only in the canonical store; the other store would still contact them`
      : onlyInRight
        ? `${onlyInRight} suppression entr(y/ies) exist only in the non-canonical store; they must be adopted before it is trusted`
        : 'both stores hold the same suppression identifiers',
  };
}

/**
 * The full reconciliation. `safeToCutOver` is true only when nothing blocking was found anywhere — it is the one
 * signal a human should need before changing the canonical store, and it is deliberately conservative.
 */
export function reconcileStores(
  left: { store: Store; leads: KachmoLead[]; suppression: SuppressionEntry[] },
  right: { store: Store; leads: KachmoLead[]; suppression: SuppressionEntry[] },
  phase: CutoverPhase
): DriftReport {
  const base = compareLeadStores(left, right, phase);
  const suppression = compareSuppressionLists(left.suppression, right.suppression);
  const counts: Record<DriftSeverity, number> = { BLOCKING: 0, WARNING: 0, INFO: 0 };
  for (const d of base.leads) counts[d.severity]++;
  if (suppression.severity !== 'INFO') counts[suppression.severity]++;
  return {
    ...base,
    suppression,
    counts,
    safeToCutOver: counts.BLOCKING === 0 && left.leads.length === right.leads.length,
  };
}
