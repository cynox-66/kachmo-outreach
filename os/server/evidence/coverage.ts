/**
 * EVIDENCE COVERAGE AND THE METHODOLOGY SHADOW (Phase D, ADR-031 / ADR-032).
 *
 * Coverage answers "how well sourced is each gate's fact?" for one lead, and the shadow answers "what would an
 * evidence-strict reading say differently?" across the whole database.
 *
 * Both are measurements. Neither writes anything, neither changes a gate, a score or a state, and the shadow is
 * never persisted to a lead: activating a different methodology is a separate, versioned, golden-backed decision.
 */
import { asc, eq } from 'drizzle-orm';
import type { KachmoLead, QualificationGates } from '@kachmo/core/leads/schema.js';
import { evaluateLeadGates } from '@kachmo/core/qualification/gates.js';
import { gateCoverage, coverageSummary, shadowDifferences, type GateCoverage } from '@kachmo/core/research/coverage.js';
import type { EvidenceLevel } from '@kachmo/core/research/evidence.js';
import * as schema from '../db/schema/index';
import { readTitanState, ledgerLookup } from '../repo/titan-ledger';
import { readSuppressionInTx } from '../leads/mutate';
import type { Db } from '../leads/locks';
import { derivedLevel, type EvidenceRow, type RetrievalRow } from './store';

/** The evidence levels recorded for each claim field of one lead, derived from its rows. */
export function levelsByField(rows: EvidenceRow[], retrievals: Map<string, RetrievalRow>): Record<string, EvidenceLevel[]> {
  const out: Record<string, EvidenceLevel[]> = {};
  for (const r of rows) {
    const level = derivedLevel(r, r.retrievalId ? retrievals.get(r.retrievalId) ?? null : null).level;
    (out[r.field] ??= []).push(level);
  }
  return out;
}

async function evidenceFor(db: Db, leadIds: string[] | null) {
  const rows = leadIds && leadIds.length === 1 ? await db.select().from(schema.leadEvidence).where(eq(schema.leadEvidence.leadId, leadIds[0])) : await db.select().from(schema.leadEvidence);
  const retrievals = await db.select().from(schema.evidenceRetrieval).where(eq(schema.evidenceRetrieval.outcome, 'OK'));
  return { rows, byId: new Map(retrievals.map(r => [r.id, r])) };
}

/** Per-gate coverage for one lead, plus a one-line summary. */
export async function coverageForLead(db: Db, lead: KachmoLead, gates: QualificationGates): Promise<{ coverage: GateCoverage[]; summary: ReturnType<typeof coverageSummary> }> {
  const { rows, byId } = await evidenceFor(db, [lead.lead_id]);
  const coverage = gateCoverage(gates, levelsByField(rows, byId));
  return { coverage, summary: coverageSummary(coverage) };
}

export interface ShadowReport {
  leads: number;
  /** Leads with at least one recorded claim source. Without evidence there is nothing to measure. */
  leadsWithEvidence: number;
  /** Leads where the strict reading would change at least one gate outcome. */
  leadsAffected: number;
  byGate: Array<{ gate: string; changes: number; examples: string[] }>;
  byTransition: Array<{ from: string; to: string; count: number }>;
}

/**
 * The shadow across the whole database. Read-only; the caller prints it. It reports gate-level differences only —
 * research states are not shadow-derived, because the state rules belong to the engine (ADR-032).
 */
export async function shadowReport(db: Db): Promise<ShadowReport> {
  const leadRows = await db.select().from(schema.lead).orderBy(asc(schema.lead.targetNumber));
  const { rows, byId } = await evidenceFor(db, null);
  const suppression = await readSuppressionInTx(db);
  const ledger = ledgerLookup(readTitanState().tracker);
  const evidenceByLead = new Map<string, EvidenceRow[]>();
  for (const r of rows) evidenceByLead.set(r.leadId, [...(evidenceByLead.get(r.leadId) ?? []), r]);

  const gateCounts = new Map<string, { changes: number; examples: string[] }>();
  const transitions = new Map<string, number>();
  let leadsWithEvidence = 0;
  let leadsAffected = 0;

  for (const row of leadRows) {
    const lead = row.record as KachmoLead;
    const mine = evidenceByLead.get(row.leadId) ?? [];
    if (!mine.length) continue;
    leadsWithEvidence++;
    const gates = evaluateLeadGates(lead, suppression, ledger(lead.target_number)).gates;
    const diffs = shadowDifferences(gateCoverage(gates, levelsByField(mine, byId)));
    if (!diffs.length) continue;
    leadsAffected++;
    for (const d of diffs) {
      const g = gateCounts.get(d.gate) ?? { changes: 0, examples: [] };
      g.changes++;
      if (g.examples.length < 5) g.examples.push(row.targetNumber);
      gateCounts.set(d.gate, g);
      const key = `${d.current}→${d.shadow}`;
      transitions.set(key, (transitions.get(key) ?? 0) + 1);
    }
  }

  return {
    leads: leadRows.length,
    leadsWithEvidence,
    leadsAffected,
    byGate: [...gateCounts.entries()].map(([gate, v]) => ({ gate, ...v })).sort((a, b) => b.changes - a.changes || a.gate.localeCompare(b.gate)),
    byTransition: [...transitions.entries()].map(([k, count]) => ({ from: k.split('→')[0], to: k.split('→')[1], count })).sort((a, b) => b.count - a.count),
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1] && /server[\\/]evidence[\\/]coverage\.ts$/.test(process.argv[1])) {
  const { openOperatorDatabase } = await import('../leads/operator-db');
  const { db, close, label } = openOperatorDatabase();
  (async () => {
    console.log(`\n🔬 Methodology shadow (measurement only) — target ${label}`);
    const r = await shadowReport(db);
    console.log(`   ${r.leads} leads · ${r.leadsWithEvidence} with recorded claim sources · ${r.leadsAffected} where an evidence-strict reading would differ`);
    for (const g of r.byGate) console.log(`   ${g.gate.padEnd(28)} ${String(g.changes).padStart(4)} gate(s) would change   e.g. ${g.examples.join(', ')}`);
    for (const t of r.byTransition) console.log(`   ${t.from} → ${t.to}: ${t.count}`);
    console.log('\n   Nothing was written. Methodology v1.0 remains the only ACTIVE methodology; no lead was changed.');
    console.log('   Adopting a stricter reading would be a new methodology version, with its own golden and an explicit re-evaluation.');
    return 0;
  })()
    .then(code => close().then(() => process.exit(code)))
    .catch(err => {
      console.error(`\n❌ ${(err as Error).message}`);
      close().finally(() => process.exit(1));
    });
}
