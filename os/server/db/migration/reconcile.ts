import { asc } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '../schema/index.js';
import type { KachmoLead } from '../../../../core/leads/schema.js';
import { findInvariantViolations } from '../../../../core/leads/invariants.js';
import { evaluateLeadGates } from '../../../../core/qualification/gates.js';
import { calculateLeadScores } from '../../../../core/scoring/score.js';
import { outreachBlock } from '../../../../core/suppression/match.js';
import type { CanonicalSource } from './source.js';
import { canonicalJson, canonicalSha256 } from './canonical.js';
import { leadProjection, suppressionEntryFromRow, analyticsEventFromRow } from './transform.js';

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface ReconciliationCheck {
  name: string;
  ok: boolean;
  /** Target numbers, counts or field names only — never contact values. */
  detail?: string;
}
export interface ReconciliationReport {
  ok: boolean;
  checks: ReconciliationCheck[];
}

const sample = (xs: string[]) => (xs.length ? `${xs.length}: ${xs.slice(0, 10).join(', ')}${xs.length > 10 ? ', …' : ''}` : undefined);

/**
 * Proves the database holds exactly the source: same counts, same lead IDs and target numbers, byte-for-byte
 * equivalent records (canonical hash), projections consistent with records, suppression and events identical in
 * order, no invariant violations, and the core engine producing identical gates, scores and outreach blocks from the
 * stored data as from the source.
 */
export async function reconcile(db: Db, source: CanonicalSource): Promise<ReconciliationReport> {
  const checks: ReconciliationCheck[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail: ok ? undefined : detail });

  const rows = await db.select().from(schema.lead).orderBy(asc(schema.lead.targetNumber));
  const dbLeads = rows.map(r => r.record as KachmoLead);
  const srcById = new Map(source.leads.map(l => [l.lead_id, l]));

  add('lead count identical', rows.length === source.leads.length, `source ${source.leads.length}, database ${rows.length}`);
  const missingIds = source.leads.filter(l => !rows.some(r => r.leadId === l.lead_id)).map(l => l.target_number);
  const extraIds = rows.filter(r => !srcById.has(r.leadId)).map(r => r.targetNumber);
  add('every source lead_id present, none extra', !missingIds.length && !extraIds.length, `missing ${sample(missingIds) ?? 0}; extra ${sample(extraIds) ?? 0}`);
  add('lead IDs unchanged (target_number → lead_id mapping identical)', rows.every(r => srcById.get(r.leadId)?.target_number === r.targetNumber), sample(rows.filter(r => srcById.get(r.leadId)?.target_number !== r.targetNumber).map(r => r.targetNumber)));
  add('no duplicate lead records', new Set(rows.map(r => r.leadId)).size === rows.length && new Set(rows.map(r => r.targetNumber)).size === rows.length);

  const recordDiff = rows.filter(r => canonicalSha256(r.record) !== source.leadRecordSha256.get(r.leadId)).map(r => r.targetNumber);
  add('every stored record is identical to its source record (lossless: provenance, history, timestamps)', !recordDiff.length, sample(recordDiff));
  const shaDiff = rows.filter(r => r.recordSha256 !== source.leadRecordSha256.get(r.leadId)).map(r => r.targetNumber);
  add('stored record hashes match the source', !shaDiff.length, sample(shaDiff));
  const projectionDiff = rows.flatMap(r => {
    const expected = leadProjection(r.record as KachmoLead) as Record<string, unknown>;
    const fields = Object.keys(expected).filter(k => canonicalJson(expected[k]) !== canonicalJson((r as Record<string, unknown>)[k]));
    return fields.length ? [`${r.targetNumber} (${fields.join('/')})`] : [];
  });
  add('typed columns equal the stored record (no silent divergence)', !projectionDiff.length, sample(projectionDiff));
  add('every lead at version 1 after import', rows.every(r => r.version === 1));

  const provenanceDiff = rows.filter(r => {
    const s = srcById.get(r.leadId);
    return !s || s.phone_status !== r.phoneStatus || s.email_status !== r.emailStatus || s.phone_source !== (r.record as KachmoLead).phone_source || s.email_source !== (r.record as KachmoLead).email_source;
  }).map(r => r.targetNumber);
  add('contact provenance (status and source) preserved for every lead', !provenanceDiff.length, sample(provenanceDiff));

  const violations = findInvariantViolations(dbLeads);
  add('stored leads have no invariant violations', !violations.length, `${violations.length} violation(s)`);

  const supRows = await db.select().from(schema.suppressionEntry).orderBy(asc(schema.suppressionEntry.sequence));
  const dbSuppression = supRows.map(suppressionEntryFromRow);
  add('suppression entries identical and in the same order', canonicalJson(dbSuppression) === canonicalJson(source.suppression), `source ${source.suppression.length}, database ${supRows.length}`);
  add('no suppression entry revoked by the import', supRows.every(r => r.revokedAt === null));

  const evRows = await db.select().from(schema.analyticsEvent).orderBy(asc(schema.analyticsEvent.sequence));
  add('analytics events identical and in the same order', canonicalJson(evRows.map(analyticsEventFromRow)) === canonicalJson(source.events), `source ${source.events.length}, database ${evRows.length}`);

  const engineDiff = rows.flatMap(r => {
    const s = srcById.get(r.leadId);
    if (!s) return [];
    const same =
      canonicalJson(evaluateLeadGates(r.record as KachmoLead, dbSuppression, null)) === canonicalJson(evaluateLeadGates(s, source.suppression, null)) &&
      canonicalJson(calculateLeadScores(r.record as KachmoLead)) === canonicalJson(calculateLeadScores(s)) &&
      canonicalJson(outreachBlock(r.record as KachmoLead, dbSuppression, null)) === canonicalJson(outreachBlock(s, source.suppression, null));
    return same ? [] : [r.targetNumber];
  });
  add('core engine: gates, completeness, scores and suppression blocks identical from stored data', !engineDiff.length, sample(engineDiff));

  return { ok: checks.every(c => c.ok), checks };
}
