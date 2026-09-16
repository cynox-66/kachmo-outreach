import type { KachmoLead, SuppressionEntry } from '../leads/schema.js';
import { outreachBlock } from '../suppression/match.js';
import { phoneEligibility, emailRoute } from '../contact/provenance.js';
import { evaluateLeadGates } from '../qualification/gates.js';
import { ARCHETYPE_IDS, archetypeById, verticalFromLabel } from '../config/taxonomy.js';

/**
 * LOW-INVENTORY DETECTION — explicit thresholds, counted from real state.
 *
 * There is no "AI decides inventory is low" here, and there never will be. The system counts how many leads are
 * actually usable in each segment, compares that to a configured threshold, and says which gate is responsible for
 * the shortfall. A human reads that and decides whether to commission research.
 *
 * Nothing in this module launches research. It produces the input to a research queue, not an action.
 */

export interface InventoryThresholds {
  /** Below this many usable leads in a segment, the segment is LOW. */
  low: number;
  /** Below this, it is CRITICAL. */
  critical: number;
  /** Segments with fewer than this many leads in total are not reported — the sample is too small to mean anything. */
  minSegmentSize: number;
}

/**
 * Deliberately conservative starting values. They are configuration, not methodology: changing them changes what
 * gets flagged, never how a lead is qualified.
 */
export const DEFAULT_THRESHOLDS: InventoryThresholds = { low: 10, critical: 3, minSegmentSize: 5 };

export type InventoryStatus = 'HEALTHY' | 'LOW' | 'CRITICAL';

export interface SegmentKey {
  archetypeId: string;
  vertical: string | null;
  country: string;
}

export interface SegmentInventory {
  segment: SegmentKey;
  total: number;
  /** Leads that could be contacted today: qualified, not suppressed, with a usable contact route. */
  usable: number;
  /** Leads blocked only by missing research — the ones research can actually recover. */
  recoverableByResearch: number;
  /** Leads that can never be recovered: suppressed, disqualified or opted out. */
  permanentlyUnavailable: number;
  status: InventoryStatus;
  /** Which gates are causing the shortfall, most common first. */
  blockingGates: Array<{ gate: string; leads: number }>;
  /** Which fields are missing across the segment, most common first. */
  topMissingFields: Array<{ field: string; leads: number }>;
  reason: string;
}

export interface InventoryReport {
  generatedAt: string;
  thresholds: InventoryThresholds;
  segments: SegmentInventory[];
  /** Segments at or below the LOW threshold, worst first. These are what a research queue is built from. */
  needsResearch: SegmentInventory[];
  totals: { leads: number; usable: number; recoverableByResearch: number; permanentlyUnavailable: number };
}

const segmentKey = (s: SegmentKey) => `${s.archetypeId}|${s.vertical ?? ''}|${s.country}`;

/** A lead is usable when it is qualified, not blocked, and has at least one contact route that may actually be used. */
export function isUsable(lead: KachmoLead, suppression: SuppressionEntry[], ledgerStatus: string | null): boolean {
  if (lead.research_state !== 'QUALIFIED' && lead.research_state !== 'OUTREACH_READY') return false;
  if (outreachBlock(lead, suppression, ledgerStatus).blocked) return false;
  const phone = phoneEligibility(lead).ok;
  const email = emailRoute(lead).quality === 'DIRECT';
  return phone || email;
}

/** Permanently unavailable: no amount of research brings these back. */
export function isPermanentlyUnavailable(lead: KachmoLead, suppression: SuppressionEntry[], ledgerStatus: string | null): boolean {
  return lead.do_not_contact === true || lead.research_state === 'DISQUALIFIED' || outreachBlock(lead, suppression, ledgerStatus).blocked;
}

/**
 * Counts usable inventory per archetype/vertical/geography and says what is causing each shortfall.
 *
 * `getLedgerStatus` supplies the email-ledger state, because inventory must account for people who have already
 * replied or opted out through the email pipeline.
 */
export function buildInventoryReport(
  leads: KachmoLead[],
  suppression: SuppressionEntry[],
  getLedgerStatus: (targetNumber: string) => string | null,
  generatedAt: string,
  thresholds: InventoryThresholds = DEFAULT_THRESHOLDS
): InventoryReport {
  const bySegment = new Map<string, { key: SegmentKey; leads: KachmoLead[] }>();
  for (const l of leads) {
    const def = archetypeById(l.archetype_id);
    const key: SegmentKey = {
      archetypeId: l.archetype_id,
      vertical: def?.labelsAreVerticals ? verticalFromLabel(l.archetype_id, l.archetype_label) : null,
      country: l.location_country,
    };
    const k = segmentKey(key);
    const bucket = bySegment.get(k) ?? { key, leads: [] };
    bucket.leads.push(l);
    bySegment.set(k, bucket);
  }

  const segments: SegmentInventory[] = [];
  for (const { key, leads: segLeads } of bySegment.values()) {
    const ledger = (l: KachmoLead) => getLedgerStatus(l.target_number);
    const usable = segLeads.filter(l => isUsable(l, suppression, ledger(l)));
    const permanent = segLeads.filter(l => isPermanentlyUnavailable(l, suppression, ledger(l)));
    const recoverable = segLeads.filter(l => !isUsable(l, suppression, ledger(l)) && !isPermanentlyUnavailable(l, suppression, ledger(l)));

    const gateCounts = new Map<string, number>();
    const fieldCounts = new Map<string, number>();
    for (const l of recoverable) {
      const q = evaluateLeadGates(l, suppression, ledger(l));
      for (const [gate, outcome] of Object.entries(q.gates)) {
        if (outcome === 'PENDING' || outcome === 'FAIL') gateCounts.set(gate, (gateCounts.get(gate) ?? 0) + 1);
      }
      for (const f of q.missing) fieldCounts.set(f, (fieldCounts.get(f) ?? 0) + 1);
    }
    const blockingGates = [...gateCounts.entries()].map(([gate, n]) => ({ gate, leads: n })).sort((a, b) => b.leads - a.leads || a.gate.localeCompare(b.gate));
    const topMissingFields = [...fieldCounts.entries()].map(([field, n]) => ({ field, leads: n })).sort((a, b) => b.leads - a.leads || a.field.localeCompare(b.field));

    const status: InventoryStatus = usable.length <= thresholds.critical ? 'CRITICAL' : usable.length < thresholds.low ? 'LOW' : 'HEALTHY';
    const worst = blockingGates[0];
    segments.push({
      segment: key,
      total: segLeads.length,
      usable: usable.length,
      recoverableByResearch: recoverable.length,
      permanentlyUnavailable: permanent.length,
      status,
      blockingGates,
      topMissingFields,
      reason:
        status === 'HEALTHY'
          ? `${usable.length} usable lead(s), at or above the threshold of ${thresholds.low}`
          : `${usable.length} usable lead(s) against a threshold of ${thresholds.low}. ` +
            (recoverable.length
              ? `${recoverable.length} could be recovered by research${worst ? `, mostly blocked on ${worst.gate} (${worst.leads} lead(s))` : ''}.`
              : 'no lead here can be recovered by research; new leads are needed.'),
    });
  }

  segments.sort((a, b) => a.usable - b.usable || segmentKey(a.segment).localeCompare(segmentKey(b.segment)));
  const needsResearch = segments.filter(s => s.status !== 'HEALTHY' && s.total >= thresholds.minSegmentSize);

  return {
    generatedAt,
    thresholds,
    segments,
    needsResearch,
    totals: {
      leads: leads.length,
      usable: segments.reduce((n, s) => n + s.usable, 0),
      recoverableByResearch: segments.reduce((n, s) => n + s.recoverableByResearch, 0),
      permanentlyUnavailable: segments.reduce((n, s) => n + s.permanentlyUnavailable, 0),
    },
  };
}

/**
 * Turns a shortfall into the research that would fix it — as a suggestion for a human, with the segment and the
 * blocking gate named, so the brief that gets written is about a real gap rather than a hunch.
 */
export interface ResearchNeed {
  segment: SegmentKey;
  status: InventoryStatus;
  /** How many new usable leads would bring the segment back to healthy. */
  shortfall: number;
  /** Whether existing leads can be rescued, or whether genuinely new companies are needed. */
  approach: 'RESEARCH_EXISTING' | 'FIND_NEW' | 'BOTH';
  blockingGate: string | null;
  missingFields: string[];
  rationale: string;
}

export function researchNeeds(report: InventoryReport): ResearchNeed[] {
  return report.needsResearch.map(s => {
    const shortfall = Math.max(0, report.thresholds.low - s.usable);
    const approach: ResearchNeed['approach'] = s.recoverableByResearch >= shortfall ? 'RESEARCH_EXISTING' : s.recoverableByResearch === 0 ? 'FIND_NEW' : 'BOTH';
    return {
      segment: s.segment,
      status: s.status,
      shortfall,
      approach,
      blockingGate: s.blockingGates[0]?.gate ?? null,
      missingFields: s.topMissingFields.slice(0, 5).map(f => f.field),
      rationale:
        approach === 'RESEARCH_EXISTING'
          ? `${s.recoverableByResearch} existing lead(s) here are blocked only on missing research; finding it is cheaper than sourcing new companies.`
          : approach === 'FIND_NEW'
            ? `nothing here can be recovered by research; ${shortfall} new compan(y/ies) are needed.`
            : `${s.recoverableByResearch} existing lead(s) can be recovered, but that still leaves a gap; both research and new sourcing are needed.`,
    };
  });
}

/** Segments the taxonomy declares but the database has no leads for at all. Reported separately from a shortfall. */
export function uncoveredArchetypes(leads: KachmoLead[]): string[] {
  const present = new Set(leads.map(l => l.archetype_id));
  return ARCHETYPE_IDS.filter(id => !present.has(id));
}
