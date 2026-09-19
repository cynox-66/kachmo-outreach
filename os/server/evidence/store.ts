import { asc, desc, eq, inArray } from 'drizzle-orm';
import type { ResearchCandidate } from '@kachmo/core/research/candidate.js';
import { FIELD_OWNERSHIP } from '@kachmo/core/reconciliation/ownership.js';
import { deriveEvidenceLevel, SOURCE_TYPES, VALIDATORS, type EvidenceLevel, type SourceType, type Validator } from '@kachmo/core/research/evidence.js';
import { isUrl, normalizeDomain } from '@kachmo/core/contact/provenance.js';
import * as schema from '../db/schema/index';
import type { Db } from '../leads/locks';

/**
 * CLAIM-LEVEL EVIDENCE (CAP-5, ADR-024).
 *
 * `lead_evidence` records where each claim about a lead came from and how far that source has been checked. It
 * stores FACTS (a URL, a retrieval, a reviewer, a verbatim excerpt) and never a level: the level is derived by core's
 * `deriveEvidenceLevel` every time it is read, so a stored row can never claim more than its facts justify.
 *
 * Evidence never changes a lead. Moving a lead's provenance (e.g. a phone to PUBLICLY_LISTED) is a separate,
 * explicit `lead.research_recorded` write by a named person. Wiring evidence levels into the gates would be
 * Methodology v1.1, which has not been approved.
 */

/** Fields whose claimed VALUE is a contact detail. Their value lives only on the lead, behind `contactsFor`. */
export const CONTACT_VALUE_FIELDS: ReadonlySet<string> = new Set([
  ...(FIELD_OWNERSHIP.find(g => g.group === 'CONTACT_PROVENANCE')?.fields ?? []),
  'whatsapp_number',
]);

export const EVIDENCE_ORIGINS = ['LEGACY_RECORD', 'HUMAN_RECORD', 'EXTERNAL_RESEARCH', 'IDE_AGENT', 'CALL'] as const;
export type EvidenceOrigin = (typeof EVIDENCE_ORIGINS)[number];

const MAX_CLAIM = 500;

export type EvidenceRow = typeof schema.leadEvidence.$inferSelect;
export type RetrievalRow = typeof schema.evidenceRetrieval.$inferSelect;

export interface NewEvidence {
  leadId: string;
  field: string;
  claimValue: string | null;
  sourceUrl: string | null;
  sourceType: string;
  observedAt: string | null;
  origin: EvidenceOrigin;
  validator: Validator;
  candidateId?: string | null;
  contradictsEvidenceId?: string | null;
  recordedByUserId: string | null;
  recordedByLabel: string;
}

/** The value stored for a claim: never a contact value, never unbounded. */
export function storableClaim(field: string, value: string | null | undefined): string | null {
  if (CONTACT_VALUE_FIELDS.has(field)) return null;
  const v = value?.replace(/[\u0000-\u001f]/g, ' ').trim();
  return v ? v.slice(0, MAX_CLAIM) : null;
}

const asSourceType = (t: string | null | undefined): SourceType => ((SOURCE_TYPES as readonly string[]).includes(t ?? '') ? (t as SourceType) : 'other');

/**
 * Evidence rows for a research candidate's claims, attached to a lead (on import, or on MERGE into an existing
 * lead). One row per (field, source URL); a claim with no URL still records that it was asserted. An extractor's
 * retrieval, excerpt or asserted level is NOT carried: none of those happened in this system, so none is believed.
 */
export function evidenceFromCandidate(c: ResearchCandidate, leadId: string, candidateRowId: string, by: { userId: string | null; label: string }): NewEvidence[] {
  const seen = new Set<string>();
  const out: NewEvidence[] = [];
  for (const claim of c.claims) {
    const sources = claim.evidence.length ? claim.evidence : [null];
    for (const e of sources) {
      const url = e?.sourceUrl && isUrl(e.sourceUrl) ? e.sourceUrl : null;
      const key = `${claim.field}|${url ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        leadId,
        field: claim.field,
        claimValue: storableClaim(claim.field, claim.value),
        sourceUrl: url,
        sourceType: asSourceType(e?.sourceType),
        observedAt: null,
        origin: 'EXTERNAL_RESEARCH',
        // What established these facts here: a syntax check at most. The extractor's say-so is not a validator.
        validator: url ? 'SYNTAX_CHECK' : 'NONE',
        candidateId: candidateRowId,
        recordedByUserId: by.userId,
        recordedByLabel: by.label,
      });
    }
  }
  return out;
}

export async function insertEvidence(tx: Db, rows: NewEvidence[]): Promise<number> {
  for (const r of rows) {
    if (!(VALIDATORS as readonly string[]).includes(r.validator)) throw new Error(`invalid validator ${r.validator}`);
    await tx.insert(schema.leadEvidence).values({
      leadId: r.leadId,
      field: r.field,
      claimValue: r.claimValue,
      sourceUrl: r.sourceUrl,
      sourceType: r.sourceType,
      observedAt: r.observedAt,
      origin: r.origin,
      validator: r.validator,
      candidateId: r.candidateId ?? null,
      contradictsEvidenceId: r.contradictsEvidenceId ?? null,
      recordedByUserId: r.recordedByUserId,
      recordedByLabel: r.recordedByLabel,
    });
  }
  return rows.length;
}

// ── Reading: the derived level ───────────────────────────────────────────────

export interface EvidenceView {
  id: string;
  field: string;
  claimValue: string | null;
  sourceUrl: string | null;
  sourceDomain: string | null;
  sourceType: string;
  origin: string;
  level: EvidenceLevel;
  levelReason: string;
  reviewStatus: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  supportingExcerpt: string | null;
  retrieval: { id: string; outcome: string; fetchedAt: string; httpStatus: number | null; finalUrl: string | null } | null;
  /** Failed fetch attempts for this URL, newest first — the operator sees why a source is still unproven. */
  failedAttempts: number;
  contradictsEvidenceId: string | null;
  contradictedBy: string[];
  recordedBy: string | null;
  recordedAt: string;
}

/**
 * The level core derives from a stored row. A contradiction is a HUMAN-recorded row pointing at the claim it
 * contradicts (ADR-011); a check is a HUMAN review with a verbatim excerpt of a real retrieval.
 */
export function derivedLevel(row: EvidenceRow, retrieval: RetrievalRow | null): { level: EvidenceLevel; reason: string } {
  const ok = retrieval && retrieval.outcome === 'OK' ? retrieval : null;
  const validator: Validator = row.reviewStatus === 'CHECKED' || row.contradictsEvidenceId ? 'HUMAN' : ((row.validator as Validator) ?? 'NONE');
  return deriveEvidenceLevel({
    field: row.field,
    claim: row.claimValue ?? row.field,
    sourceUrl: row.sourceUrl,
    sourceDomain: normalizeDomain(row.sourceUrl),
    sourceType: asSourceType(row.sourceType),
    retrievedAt: ok ? ok.fetchedAt.toISOString() : null,
    retrievedContentSha256: ok?.contentSha256 ?? null,
    supportingExcerpt: row.reviewStatus === 'CHECKED' || row.contradictsEvidenceId ? row.supportingExcerpt : null,
    validator,
    validatedAt: row.reviewedAt?.toISOString() ?? null,
    contradictsEvidenceId: row.contradictsEvidenceId,
    notes: row.reviewNote,
  });
}

export async function evidenceForLead(db: Db, leadId: string): Promise<EvidenceView[]> {
  const rows = await db.select().from(schema.leadEvidence).where(eq(schema.leadEvidence.leadId, leadId)).orderBy(asc(schema.leadEvidence.field), asc(schema.leadEvidence.recordedAt));
  const retrievalIds = rows.map(r => r.retrievalId).filter((x): x is string => !!x);
  const retrievals = retrievalIds.length ? await db.select().from(schema.evidenceRetrieval).where(inArray(schema.evidenceRetrieval.id, retrievalIds)) : [];
  const urls = [...new Set(rows.map(r => r.sourceUrl).filter((x): x is string => !!x))];
  const attempts = urls.length
    ? await db.select({ url: schema.evidenceRetrieval.requestedUrl, outcome: schema.evidenceRetrieval.outcome }).from(schema.evidenceRetrieval).where(inArray(schema.evidenceRetrieval.requestedUrl, urls)).orderBy(desc(schema.evidenceRetrieval.fetchedAt))
    : [];
  const byId = new Map(retrievals.map(r => [r.id, r]));
  return rows.map(r => {
    const retrieval = r.retrievalId ? byId.get(r.retrievalId) ?? null : null;
    const d = derivedLevel(r, retrieval);
    return {
      id: r.id,
      field: r.field,
      claimValue: r.claimValue,
      sourceUrl: r.sourceUrl,
      sourceDomain: normalizeDomain(r.sourceUrl),
      sourceType: r.sourceType,
      origin: r.origin,
      level: d.level,
      levelReason: d.reason,
      reviewStatus: r.reviewStatus,
      reviewedBy: r.reviewedByLabel,
      reviewNote: r.reviewNote,
      supportingExcerpt: r.supportingExcerpt,
      retrieval: retrieval ? { id: retrieval.id, outcome: retrieval.outcome, fetchedAt: retrieval.fetchedAt.toISOString(), httpStatus: retrieval.httpStatus, finalUrl: retrieval.finalUrl } : null,
      failedAttempts: attempts.filter(a => a.url === r.sourceUrl && a.outcome !== 'OK').length,
      contradictsEvidenceId: r.contradictsEvidenceId,
      contradictedBy: rows.filter(x => x.contradictsEvidenceId === r.id).map(x => x.id),
      recordedBy: r.recordedByLabel,
      recordedAt: r.recordedAt.toISOString(),
    };
  });
}

/** Counts of evidence by derived level, across all leads — for the health panel. Counts only; no values. */
export async function evidenceLevelCounts(db: Db): Promise<Record<string, number>> {
  const rows = await db.select().from(schema.leadEvidence);
  const retrievals = await db.select().from(schema.evidenceRetrieval).where(eq(schema.evidenceRetrieval.outcome, 'OK'));
  const byId = new Map(retrievals.map(r => [r.id, r]));
  const out: Record<string, number> = {};
  for (const r of rows) {
    const { level } = derivedLevel(r, r.retrievalId ? byId.get(r.retrievalId) ?? null : null);
    out[level] = (out[level] ?? 0) + 1;
  }
  return out;
}
