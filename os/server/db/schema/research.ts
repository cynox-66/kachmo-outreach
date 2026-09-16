import { sql } from 'drizzle-orm';
import { pgTable, text, uuid, integer, jsonb, timestamp, index, check, unique } from 'drizzle-orm/pg-core';
import { lead } from './leads';

/**
 * PHASE 2 RESEARCH INGESTION.
 *
 * Three tables, mirroring the contracts in `core/research/`. They exist beside the canonical `lead` table and never
 * inside it: a research report can never mutate a lead. The only path from here to `lead` is an explicit human
 * approval, recorded in `research_candidate.reviewed_by`, which the import step re-checks.
 *
 * Raw report content is stored verbatim and hashed, so what a reviewer reads can always be proven to be what was
 * uploaded. It is never executed, never interpreted as a path, and never re-encoded.
 */

/** A versioned research brief, generated from a real inventory gap and handed to an external researcher. */
export const researchBrief = pgTable(
  'research_brief',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    promptId: text('prompt_id').notNull().unique(),
    contractVersion: text('contract_version').notNull(),
    taxonomyVersion: text('taxonomy_version').notNull(),
    archetypeId: text('archetype_id').notNull(),
    vertical: text('vertical'),
    geographies: jsonb('geographies').$type<string[]>().notNull(),
    targetCount: integer('target_count').notNull(),
    /** The full ResearchBriefSpec, so a brief stays readable after the contract evolves. */
    spec: jsonb('spec').notNull(),
    /** The exact text handed to the researcher. Pinned so a returned report can be judged against what was asked. */
    renderedBrief: text('rendered_brief').notNull(),
    status: text('status').notNull().default('OPEN'),
    createdByUserId: text('created_by_user_id'),
    createdByLabel: text('created_by_label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  t => [
    index('research_brief_archetype_idx').on(t.archetypeId),
    check('research_brief_status_check', sql`${t.status} in ('OPEN', 'FULFILLED', 'ABANDONED')`),
    check('research_brief_target_count_check', sql`${t.targetCount} between 1 and 50`),
  ]
);

/** An uploaded research report. Untrusted input from first byte to human approval. */
export const researchReport = pgTable(
  'research_report',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceReportId: text('source_report_id').notNull().unique(),
    briefId: uuid('brief_id').references(() => researchBrief.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    /** The named human who ran the research and uploaded it. Never 'SYSTEM'. */
    operatorLabel: text('operator_label').notNull(),
    uploadedByUserId: text('uploaded_by_user_id'),
    originalFilename: text('original_filename').notNull(),
    byteSize: integer('byte_size').notNull(),
    format: text('format').notNull(),
    contentSha256: text('content_sha256').notNull(),
    /** Verbatim upload. Stored, never executed; the filename above is metadata only and never a path. */
    rawContent: text('raw_content').notNull(),
    stage: text('stage').notNull().default('RECEIVED'),
    extractionStatus: text('extraction_status').notNull().default('NOT_STARTED'),
    problems: jsonb('problems').$type<Array<Record<string, unknown>>>().notNull().default([]),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull(),
  },
  t => [
    index('research_report_stage_idx').on(t.stage),
    index('research_report_brief_idx').on(t.briefId),
    check('research_report_format_check', sql`${t.format} in ('markdown', 'text', 'json', 'csv')`),
    check(
      'research_report_stage_check',
      sql`${t.stage} in ('RECEIVED', 'PARSED', 'EXTRACTED', 'NORMALIZED', 'DEDUPLICATED', 'EVIDENCE_CHECKED', 'QUALIFIED', 'AWAITING_REVIEW', 'REVIEWED', 'REJECTED')`
    ),
    check('research_report_extraction_status_check', sql`${t.extractionStatus} in ('NOT_STARTED', 'OK', 'PARTIAL', 'FAILED')`),
    check('research_report_size_check', sql`${t.byteSize} > 0 and ${t.byteSize} <= 5242880`),
    check('research_report_hash_check', sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
  ]
);

/**
 * A proposed lead. Never a lead.
 *
 * `resolved_lead_id` is set only when a human accepted it and the canonical import succeeded. The paired check
 * constraint makes the database itself refuse a candidate that claims a lead without a recorded reviewer.
 */
export const researchCandidate = pgTable(
  'research_candidate',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    candidateId: text('candidate_id').notNull(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => researchReport.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('EXTRACTED'),
    companyName: text('company_name'),
    websiteDomain: text('website_domain'),
    archetypeId: text('archetype_id'),
    locationCountry: text('location_country'),
    /** The ExtractedClaim[] exactly as validated, each with its own evidence records. */
    claims: jsonb('claims').notNull(),
    /** The latest CandidateAssessment: duplicates, suppression matches, contradictions, missing fields. */
    assessment: jsonb('assessment'),
    reviewedByUserId: text('reviewed_by_user_id'),
    reviewedByLabel: text('reviewed_by_label'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    resolvedLeadId: uuid('resolved_lead_id').references(() => lead.leadId, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  t => [
    unique('research_candidate_report_candidate_key').on(t.reportId, t.candidateId),
    index('research_candidate_status_idx').on(t.status),
    index('research_candidate_domain_idx').on(t.websiteDomain),
    check(
      'research_candidate_status_check',
      sql`${t.status} in ('EXTRACTED', 'NORMALIZED', 'DUPLICATE_SUSPECTED', 'EVIDENCE_CHECKED', 'QUALIFIED', 'AWAITING_REVIEW', 'ACCEPTED', 'REJECTED', 'DEFERRED', 'MERGED', 'SENT_BACK_FOR_RESEARCH', 'FLAGGED_CONTRADICTION', 'INCOMPLETE', 'SUPPRESSED')`
    ),
    // A review is always attributed: a reviewed candidate has both a reviewer and a timestamp, or neither.
    check('research_candidate_review_consistency_check', sql`(${t.reviewedByLabel} is null) = (${t.reviewedAt} is null)`),
    // Nothing may claim a canonical lead without a recorded human reviewer.
    check('research_candidate_resolution_check', sql`${t.resolvedLeadId} is null or ${t.reviewedByLabel} is not null`),
  ]
);
