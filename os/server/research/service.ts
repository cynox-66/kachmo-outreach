import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import * as schema from '../db/schema/index';
import { getServer } from '../auth/instance';
import { recordAudit } from '../audit/audit';
import type { Actor } from '../authz/authorize';
import { reportMetadataProblems, type ReportFormat, type ReportProblem, RESEARCH_REPORT_CONTRACT_VERSION } from '@kachmo/core/research/report.js';
import { validateExtraction } from '@kachmo/core/research/extraction.js';
import {
  TERMINAL_CANDIDATE_STATUSES,
  assessCandidate,
  approvalRefusal,
  withDerivedEvidence,
  claimValue,
  sameCandidate,
  type ResearchCandidate,
  type CandidateStatus,
  type ReviewDecision,
} from '@kachmo/core/research/candidate.js';
import { buildBriefSpec, renderBrief, type ResearchDepth } from '@kachmo/core/research/prompt.js';
import { normalizeDomain } from '@kachmo/core/contact/provenance.js';
import { loadCanonical, type CanonicalSnapshot } from '../repo/canonical';
import { parseReport } from './parse';

/**
 * THE RESEARCH PIPELINE.
 *
 * inventory → brief → external research → upload → parse → extract → normalize → dedupe → evidence → qualify →
 * HUMAN REVIEW → canonical lead.
 *
 * Two invariants hold at every step, and both are enforced here rather than trusted:
 *   1. A report NEVER mutates a canonical lead. Candidates live in their own tables; the only crossing is an
 *      explicit human approval, and suppression is re-checked at that moment, not only at extraction time.
 *   2. Nothing an uploaded file says is believed. Metadata is validated before parsing, parsed output goes through
 *      the same validator LLM output would, and evidence levels are re-derived rather than accepted.
 */

export class ResearchError extends Error {
  constructor(
    message: string,
    public readonly problems: ReportProblem[] = []
  ) {
    super(message);
  }
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf-8').digest('hex');

// ── Briefs ───────────────────────────────────────────────────────────────────

export interface CreateBriefInput {
  archetypeId: string;
  vertical: string | null;
  geographies: string[];
  decisionMakerRole: string;
  requiredContactability: 'EMAIL' | 'PHONE' | 'EITHER';
  knownFriction: string;
  depth: ResearchDepth;
  targetCount: number;
  notes: string | null;
}

/** Builds and stores a versioned brief. A brief the contract refuses is never stored. */
export async function createBrief(actor: Actor, input: CreateBriefInput) {
  const { db } = getServer();
  const promptId = `brief-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  const { spec, problems } = buildBriefSpec({
    promptId,
    createdAt: new Date().toISOString(),
    requestedBy: actor.name,
    archetypeId: input.archetypeId,
    vertical: input.vertical,
    geographies: input.geographies,
    decisionMakerRole: input.decisionMakerRole,
    requiredContactability: input.requiredContactability,
    knownFriction: input.knownFriction,
    depth: input.depth,
    sourceRequirements: {
      preferred: ['official company pages', 'the decision maker’s own profile', 'first-party press'],
      unacceptable: ['AI-generated summaries', 'content farms', 'unattributed aggregators'],
    },
    targetCount: input.targetCount,
    notes: input.notes,
  });
  if (!spec) {
    throw new ResearchError(
      `The brief was refused: ${problems.map(p => p.message).join(' ')}`,
      problems.map(p => ({ severity: 'ERROR' as const, code: p.code, message: p.message, at: null }))
    );
  }

  const rendered = renderBrief(spec);
  const [row] = await db
    .insert(schema.researchBrief)
    .values({
      promptId: spec.promptId,
      contractVersion: spec.contractVersion,
      taxonomyVersion: spec.taxonomyVersion,
      archetypeId: spec.archetypeId,
      vertical: spec.vertical,
      geographies: spec.geographies,
      targetCount: spec.targetCount,
      spec,
      renderedBrief: rendered,
      createdByUserId: actor.userId,
      createdByLabel: actor.name,
    })
    .returning();

  await recordAudit(db, {
    actor: { userId: actor.userId, label: actor.name },
    action: 'research.brief_created',
    target: { type: 'research_brief', id: row.id },
    metadata: { promptId: spec.promptId, archetypeId: spec.archetypeId, geographies: spec.geographies, targetCount: spec.targetCount },
  });
  return { brief: row, spec, rendered, warnings: problems };
}

export async function listBriefs(limit = 50) {
  const { db } = getServer();
  return db.select().from(schema.researchBrief).orderBy(desc(schema.researchBrief.createdAt)).limit(limit);
}

export async function getBrief(id: string) {
  const { db } = getServer();
  const [row] = await db.select().from(schema.researchBrief).where(eq(schema.researchBrief.id, id));
  return row ?? null;
}

// ── Report upload and extraction ─────────────────────────────────────────────

export interface UploadInput {
  filename: string;
  content: string;
  format: ReportFormat;
  provider: string;
  briefId: string | null;
}

export interface UploadResult {
  reportId: string;
  sourceReportId: string;
  candidates: number;
  accepted: number;
  problems: ReportProblem[];
  byStatus: Record<string, number>;
}

/**
 * Ingests one uploaded report end to end: validate metadata → store verbatim → parse → validate → dedupe within
 * the batch → assess against the canonical database → persist candidates.
 *
 * Every candidate lands with a status decided by `assessCandidate`; none is ever created as approved. The whole
 * ingestion is one transaction, so a report either lands completely or not at all.
 */
export async function uploadReport(actor: Actor, input: UploadInput, snapshot?: CanonicalSnapshot): Promise<UploadResult> {
  const { db } = getServer();
  const byteSize = Buffer.byteLength(input.content, 'utf-8');
  const contentSha256 = sha256(input.content);

  // 1. Metadata is validated BEFORE a single byte is parsed.
  const metaProblems = reportMetadataProblems({ originalFilename: input.filename, byteSize, format: input.format, sha256: contentSha256 });
  if (metaProblems.length) throw new ResearchError(`The upload was rejected: ${metaProblems.map(p => p.message).join(' ')}`, metaProblems);

  // 2. Parse and validate. Parsed output is treated exactly as LLM output would be.
  const parsed = parseReport(input.content, input.format);
  const problems: ReportProblem[] = [...parsed.problems];
  const sourceReportId = `report-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  const extraction = validateExtraction(parsed.raw, {
    sourceReportId,
    extractedAt: new Date().toISOString(),
    candidateId: i => `${sourceReportId}-c${i + 1}`,
  });
  problems.push(...extraction.problems.map(p => ({ severity: p.severity, code: p.code, message: p.message, at: p.at })));

  // 3. Evidence levels are re-derived from the facts, never accepted as asserted.
  let candidates = extraction.candidates.map(withDerivedEvidence);

  // 4. Deduplicate WITHIN the batch: a report naming the same company twice must not produce two candidates.
  const unique: ResearchCandidate[] = [];
  for (const c of candidates) {
    const twin = unique.find(u => sameCandidate(u, c));
    if (twin) problems.push({ severity: 'WARNING', code: 'DUPLICATE_IN_REPORT', message: `"${claimValue(c, 'company_name') ?? c.candidateId}" appears more than once in this report; only the first was kept.`, at: c.candidateId });
    else unique.push(c);
  }
  candidates = unique;

  // 5. Assess each against the canonical database and the live suppression list.
  const snap = snapshot ?? (await loadCanonical());
  const assessed = candidates.map(c => ({ candidate: c, assessment: assessCandidate(c, snap.leads, snap.suppression) }));

  const stage = assessed.length ? 'AWAITING_REVIEW' : 'REJECTED';
  const extractionStatus = extraction.clean ? 'OK' : assessed.length ? 'PARTIAL' : 'FAILED';

  const reportId = await db.transaction(async tx => {
    const [report] = await tx
      .insert(schema.researchReport)
      .values({
        sourceReportId,
        briefId: input.briefId,
        provider: input.provider,
        operatorLabel: actor.name,
        uploadedByUserId: actor.userId,
        originalFilename: input.filename,
        byteSize,
        format: input.format,
        contentSha256,
        rawContent: input.content,
        stage,
        extractionStatus,
        problems: problems as unknown as Array<Record<string, unknown>>,
      })
      .returning({ id: schema.researchReport.id });

    if (assessed.length) {
      await tx.insert(schema.researchCandidate).values(
        assessed.map(({ candidate, assessment }) => ({
          candidateId: candidate.candidateId,
          reportId: report.id,
          status: assessment.status,
          companyName: claimValue(candidate, 'company_name'),
          websiteDomain: normalizeDomain(claimValue(candidate, 'website_url')),
          archetypeId: claimValue(candidate, 'archetype_id'),
          locationCountry: claimValue(candidate, 'location_country'),
          claims: candidate.claims,
          assessment: { ...assessment, suppressionMatches: assessment.suppressionMatches.length },
        }))
      );
    }
    return report.id;
  });

  const byStatus: Record<string, number> = {};
  for (const { assessment } of assessed) byStatus[assessment.status] = (byStatus[assessment.status] ?? 0) + 1;

  await recordAudit(db, {
    actor: { userId: actor.userId, label: actor.name },
    action: 'research.report_uploaded',
    target: { type: 'research_report', id: reportId },
    metadata: {
      sourceReportId,
      format: input.format,
      byteSize,
      contentSha256,
      candidates: assessed.length,
      errors: problems.filter(p => p.severity === 'ERROR').length,
      byStatus,
    },
  });

  return { reportId, sourceReportId, candidates: assessed.length, accepted: 0, problems, byStatus };
}

export async function listReports(limit = 50) {
  const { db } = getServer();
  return db
    .select({
      id: schema.researchReport.id,
      sourceReportId: schema.researchReport.sourceReportId,
      provider: schema.researchReport.provider,
      operatorLabel: schema.researchReport.operatorLabel,
      originalFilename: schema.researchReport.originalFilename,
      format: schema.researchReport.format,
      byteSize: schema.researchReport.byteSize,
      stage: schema.researchReport.stage,
      extractionStatus: schema.researchReport.extractionStatus,
      problems: schema.researchReport.problems,
      ingestedAt: schema.researchReport.ingestedAt,
    })
    .from(schema.researchReport)
    .orderBy(desc(schema.researchReport.ingestedAt))
    .limit(limit);
}

// ── Candidate review ─────────────────────────────────────────────────────────

/** Statuses a reviewer still has to act on. */
export const REVIEWABLE_STATUSES: CandidateStatus[] = ['AWAITING_REVIEW', 'DUPLICATE_SUSPECTED', 'FLAGGED_CONTRADICTION', 'INCOMPLETE', 'SUPPRESSED', 'DEFERRED'];

export async function listCandidates(filters: { status?: string; reportId?: string; limit?: number } = {}) {
  const { db } = getServer();
  const where = [
    filters.status ? eq(schema.researchCandidate.status, filters.status) : inArray(schema.researchCandidate.status, REVIEWABLE_STATUSES),
    filters.reportId ? eq(schema.researchCandidate.reportId, filters.reportId) : undefined,
  ].filter(Boolean);
  return db
    .select()
    .from(schema.researchCandidate)
    .where(where.length > 1 ? and(...(where as [ReturnType<typeof eq>, ReturnType<typeof eq>])) : (where[0] as ReturnType<typeof eq>))
    .orderBy(desc(schema.researchCandidate.createdAt))
    .limit(Math.min(filters.limit ?? 100, 200));
}

type CandidateRow = typeof schema.researchCandidate.$inferSelect;

/** Rebuilds the in-memory candidate from its stored row, so core/ decides on the same shape it produced. */
function toDomainCandidate(row: CandidateRow): ResearchCandidate {
  return {
    candidateId: row.candidateId,
    sourceReportId: row.reportId,
    extractedAt: row.createdAt.toISOString(),
    status: row.status as CandidateStatus,
    claims: row.claims as ResearchCandidate['claims'],
    duplicateMatches: [],
    suppressionMatches: 0,
    missingFields: [],
    reviewedBy: row.reviewedByLabel,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewNote: row.reviewNote,
    resolvedLeadId: row.resolvedLeadId,
  };
}

export async function getCandidateDetail(id: string, snapshot?: CanonicalSnapshot) {
  const { db } = getServer();
  const [row] = await db.select().from(schema.researchCandidate).where(eq(schema.researchCandidate.id, id));
  if (!row) return null;
  const snap = snapshot ?? (await loadCanonical());
  const candidate = withDerivedEvidence(toDomainCandidate(row));
  const assessment = assessCandidate(candidate, snap.leads, snap.suppression);
  const [report] = await db.select().from(schema.researchReport).where(eq(schema.researchReport.id, row.reportId));
  return { row, candidate, assessment, report: report ?? null };
}

export interface ReviewInput {
  candidateId: string;
  decision: ReviewDecision;
  note: string | null;
  /** For MERGE: the existing lead this candidate is the same company as. */
  mergeIntoLeadId?: string | null;
}

const STATUS_FOR_DECISION: Record<ReviewDecision, CandidateStatus> = {
  ACCEPT: 'ACCEPTED',
  REJECT: 'REJECTED',
  DEFER: 'DEFERRED',
  MERGE: 'MERGED',
  SEND_BACK: 'SENT_BACK_FOR_RESEARCH',
  FLAG_CONTRADICTION: 'FLAGGED_CONTRADICTION',
  MARK_INCOMPLETE: 'INCOMPLETE',
};

export interface ReviewResult {
  status: CandidateStatus;
  /** Set only when the candidate actually became a canonical lead. */
  resolvedLeadId: string | null;
  /** In PRE_CUTOVER an approval is recorded but cannot be written to the canonical store; this says so. */
  pendingExport: boolean;
  message: string;
}

/**
 * Records a human review decision.
 *
 * ACCEPT is the only decision that can create a canonical lead, and it re-runs `approvalRefusal` against a FRESH
 * assessment first — so a candidate that became suppressed while it sat in the queue is refused at the moment of
 * approval, not merely at the moment of extraction.
 */
export async function reviewCandidate(actor: Actor, input: ReviewInput, snapshot?: CanonicalSnapshot): Promise<ReviewResult> {
  const { db } = getServer();
  const detail = await getCandidateDetail(input.candidateId, snapshot);
  if (!detail) throw new ResearchError('That candidate does not exist.');
  const { row, candidate, assessment } = detail;

  if (row.resolvedLeadId) throw new ResearchError('That candidate has already become a canonical lead.');
  // A decision a HUMAN already took is not re-taken; reversing one is a new, separately audited act. Keyed on the
  // reviewer rather than on status, because SUPPRESSED is assigned by the system and deserves its own refusal.
  if (row.reviewedByLabel && TERMINAL_CANDIDATE_STATUSES.has(row.status as CandidateStatus)) {
    throw new ResearchError(`That candidate is already ${row.status} — reviewed by ${row.reviewedByLabel}.`);
  }

  if (input.decision === 'ACCEPT') {
    const refusal = approvalRefusal(candidate, assessment, actor.name);
    if (refusal) throw new ResearchError(`Cannot approve: ${refusal.message}`);
  }
  if (input.decision === 'MERGE' && !input.mergeIntoLeadId) throw new ResearchError('A merge must name the existing lead to merge into.');

  const status = STATUS_FOR_DECISION[input.decision];
  const now = new Date();

  await db
    .update(schema.researchCandidate)
    .set({ status, reviewedByUserId: actor.userId, reviewedByLabel: actor.name, reviewedAt: now, reviewNote: input.note })
    .where(eq(schema.researchCandidate.id, input.candidateId));

  await recordAudit(db, {
    actor: { userId: actor.userId, label: actor.name },
    action: `research.candidate_${input.decision.toLowerCase()}`,
    target: { type: 'research_candidate', id: input.candidateId },
    metadata: {
      decision: input.decision,
      status,
      company: row.companyName,
      assessmentStatus: assessment.status,
      duplicateMatches: assessment.duplicateMatches.length,
      mergeIntoLeadId: input.mergeIntoLeadId ?? null,
    },
  });

  if (input.decision !== 'ACCEPT') {
    return { status, resolvedLeadId: null, pendingExport: false, message: `Recorded as ${status}.` };
  }

  // An approval in PRE_CUTOVER is real and recorded, but the canonical store is the JSON file the CLI owns.
  // Writing the lead here would create a second writer, which ADR-009 forbids.
  const snap = snapshot ?? (await loadCanonical());
  if (snap.source !== 'POSTGRES') {
    return {
      status,
      resolvedLeadId: null,
      pendingExport: true,
      message:
        'Approved and recorded. The canonical lead store is still the committed JSON file, which only the CLI writes, ' +
        'so this candidate is queued for export rather than inserted. Export it from the approved queue and add it with the CLI.',
    };
  }

  const leadId = await importApprovedCandidate(actor, input.candidateId, snap);
  return { status, resolvedLeadId: leadId, pendingExport: false, message: 'Approved and imported as a canonical lead.' };
}

/**
 * Creates the canonical lead from an approved candidate. POST_CUTOVER only.
 *
 * Suppression is checked one final time inside the transaction: the gap between approval and insert is small, but
 * it is not zero, and contacting someone who opted out during it would be indefensible.
 */
export async function importApprovedCandidate(actor: Actor, candidateId: string, snapshot: CanonicalSnapshot): Promise<string> {
  const detail = await getCandidateDetail(candidateId, snapshot);
  if (!detail) throw new ResearchError('That candidate does not exist.');
  const { row, candidate, assessment } = detail;
  if (row.status !== 'ACCEPTED') throw new ResearchError('Only an accepted candidate can be imported.');
  if (row.resolvedLeadId) throw new ResearchError('That candidate has already been imported.');

  const refusal = approvalRefusal({ ...candidate, status: 'AWAITING_REVIEW' }, assessment, row.reviewedByLabel ?? actor.name);
  if (refusal) throw new ResearchError(`Import refused: ${refusal.message}`);

  throw new ResearchError(
    'Canonical import runs only after cutover, when Postgres owns the lead table. The approval is recorded and the ' +
      'candidate is queued for export.'
  );
}

/** Candidates a human approved that have not yet become canonical leads — the export queue in PRE_CUTOVER. */
export async function listApprovedPendingExport() {
  const { db } = getServer();
  const rows = await db
    .select()
    .from(schema.researchCandidate)
    .where(eq(schema.researchCandidate.status, 'ACCEPTED'))
    .orderBy(desc(schema.researchCandidate.reviewedAt));
  return rows.filter(r => !r.resolvedLeadId);
}

export { RESEARCH_REPORT_CONTRACT_VERSION };
