import { sql } from 'drizzle-orm';
import { pgTable, text, uuid, integer, boolean, jsonb, timestamp, index, check, unique } from 'drizzle-orm/pg-core';
import type { KachmoLead } from '@kachmo/core/leads/schema.js';
import { methodologyVersion } from './methodology';
import { researchCandidate } from './research';

/**
 * Canonical lead store.
 *
 * `record` holds the complete KachmoLead exactly as the engine uses it (lossless: every one of its fields, original
 * lead_id, created_at/updated_at and history arrays). It is the single source of truth for lead state. The typed
 * columns are PROJECTIONS of `record` for querying; they are rewritten from `record` on every write and the
 * reconciliation tool proves they match. Leads are never deleted: `archived_at` hides a lead.
 *
 * Allowed values mirror core/leads/validation.ts (asserted by tests).
 */
export const lead = pgTable(
  'lead',
  {
    leadId: uuid('lead_id').primaryKey(),
    targetNumber: text('target_number').notNull().unique(),
    companyName: text('company_name').notNull(),
    websiteUrl: text('website_url').notNull(),
    archetypeId: text('archetype_id').notNull(),
    locationCountry: text('location_country').notNull(),
    researchState: text('research_state').notNull(),
    leadPriority: text('lead_priority'),
    priorityConfidence: text('priority_confidence'),
    researchCompletenessScore: integer('research_completeness_score').notNull(),
    kachmoScore: integer('kachmo_score'),
    phoneStatus: text('phone_status').notNull(),
    emailStatus: text('email_status').notNull(),
    doNotContact: boolean('do_not_contact').notNull().default(false),
    owner: text('owner'),
    nextActionDate: text('next_action_date'),
    record: jsonb('record').$type<KachmoLead>().notNull(),
    recordSha256: text('record_sha256').notNull(),
    version: integer('version').notNull().default(1),
    recordCreatedAt: text('record_created_at').notNull(),
    recordUpdatedAt: text('record_updated_at').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    insertedAt: timestamp('inserted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  t => [
    index('lead_archetype_idx').on(t.archetypeId),
    index('lead_research_state_idx').on(t.researchState),
    index('lead_priority_idx').on(t.leadPriority),
    check('lead_record_identity_check', sql`(${t.record} ->> 'lead_id') = ${t.leadId}::text and (${t.record} ->> 'target_number') = ${t.targetNumber}`),
    check('lead_research_state_check', sql`${t.researchState} in ('DISCOVERED', 'QUALIFICATION_PENDING', 'RESEARCH_REQUIRED', 'ENRICHED', 'QUALIFIED', 'DISQUALIFIED', 'OUTREACH_READY')`),
    check('lead_phone_status_check', sql`${t.phoneStatus} in ('UNKNOWN', 'INFERRED', 'UNVERIFIED', 'PUBLICLY_LISTED', 'VERIFIED', 'INVALID')`),
    check('lead_email_status_check', sql`${t.emailStatus} in ('UNKNOWN', 'INFERRED', 'UNVERIFIED', 'PUBLICLY_LISTED', 'VERIFIED', 'INVALID')`),
    check('lead_priority_check', sql`${t.leadPriority} is null or ${t.leadPriority} in ('A+', 'A', 'B', 'C', 'DISQUALIFIED')`),
    check('lead_priority_confidence_check', sql`${t.priorityConfidence} is null or ${t.priorityConfidence} in ('CONFIRMED', 'PROVISIONAL')`),
    check('lead_completeness_range_check', sql`${t.researchCompletenessScore} between 0 and 100`),
    check('lead_kachmo_score_range_check', sql`${t.kachmoScore} is null or ${t.kachmoScore} between 0 and 100`),
    check('lead_dnc_disqualified_check', sql`not ${t.doNotContact} or ${t.researchState} = 'DISQUALIFIED'`),
    check('lead_version_positive_check', sql`${t.version} >= 1`),
  ]
);

/**
 * Append-only history of engine evaluations: which gates, scores and state a lead had, under which methodology
 * version and engine revision, computed from which input. Makes every qualification attributable.
 */
export const leadEvaluation = pgTable(
  'lead_evaluation',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leadId: uuid('lead_id').notNull().references(() => lead.leadId, { onDelete: 'restrict' }),
    methodologyVersionId: text('methodology_version_id').notNull().references(() => methodologyVersion.id, { onDelete: 'restrict' }),
    engineRef: text('engine_ref').notNull(),
    inputSha256: text('input_sha256').notNull(),
    gates: jsonb('gates').notNull(),
    missingIntelligence: jsonb('missing_intelligence').$type<string[]>().notNull(),
    reasons: jsonb('reasons').$type<string[]>().notNull(),
    researchState: text('research_state').notNull(),
    researchCompletenessScore: integer('research_completeness_score').notNull(),
    scores: jsonb('scores').notNull(),
    leadPriority: text('lead_priority'),
    priorityConfidence: text('priority_confidence'),
    actorLabel: text('actor_label').notNull(),
    actorUserId: text('actor_user_id'),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  t => [index('lead_evaluation_lead_idx').on(t.leadId, t.computedAt)]
);

/**
 * Claim-level provenance (Phase 2 evidence layer). Created now so the structure exists; intentionally NOT populated by
 * the migration, because lead.record.research_sources remains the source of truth until the evidence workflow ships.
 * A URL here proves nothing by itself: `review_status` records whether a human checked that it supports the claim.
 */
export const leadEvidence = pgTable(
  'lead_evidence',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leadId: uuid('lead_id').notNull().references(() => lead.leadId, { onDelete: 'restrict' }),
    field: text('field').notNull(),
    claimValue: text('claim_value'),
    sourceUrl: text('source_url'),
    sourceType: text('source_type').notNull(),
    observedAt: text('observed_at'),
    origin: text('origin').notNull(),
    reviewStatus: text('review_status').notNull().default('UNREVIEWED'),
    reviewedByUserId: text('reviewed_by_user_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    contradictsEvidenceId: uuid('contradicts_evidence_id'),
    recordedByUserId: text('recorded_by_user_id'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    // ── Phase B (ADR-023/024) ──
    /** The successful retrieval this claim was checked against. Set by the fetcher; never by an extractor. */
    retrievalId: uuid('retrieval_id').references(() => evidenceRetrieval.id, { onDelete: 'restrict' }),
    /** A verbatim excerpt of the retrieval's stored text, chosen by the human who reviewed it. Never invented. */
    supportingExcerpt: text('supporting_excerpt'),
    /** Who or what established the facts on this row (core VALIDATORS). The LEVEL is derived by core, never stored. */
    validator: text('validator').notNull().default('NONE'),
    /** The research candidate this evidence arrived with (import or merge), when it did. */
    candidateId: uuid('candidate_id').references(() => researchCandidate.id, { onDelete: 'restrict' }),
    recordedByLabel: text('recorded_by_label'),
    reviewedByLabel: text('reviewed_by_label'),
    reviewNote: text('review_note'),
  },
  t => [
    index('lead_evidence_lead_field_idx').on(t.leadId, t.field),
    check('lead_evidence_origin_check', sql`${t.origin} in ('LEGACY_RECORD', 'HUMAN_RECORD', 'EXTERNAL_RESEARCH', 'IDE_AGENT', 'CALL')`),
    check('lead_evidence_review_status_check', sql`${t.reviewStatus} in ('UNREVIEWED', 'CHECKED', 'REJECTED')`),
    check('lead_evidence_review_consistency_check', sql`(${t.reviewStatus} = 'UNREVIEWED') = (${t.reviewedAt} is null)`),
    check('lead_evidence_validator_check', sql`${t.validator} in ('NONE', 'SYNTAX_CHECK', 'FETCHER', 'LLM_EXTRACTION', 'HUMAN')`),
    check('lead_evidence_excerpt_length_check', sql`${t.supportingExcerpt} is null or length(${t.supportingExcerpt}) <= 2000`),
    // An excerpt cannot predate its source: nobody can quote a page that was never retrieved (ADR-011).
    check('lead_evidence_excerpt_retrieval_check', sql`${t.supportingExcerpt} is null or ${t.retrievalId} is not null`),
    // A CHECKED review always carries the excerpt that justified it.
    check('lead_evidence_checked_excerpt_check', sql`${t.reviewStatus} <> 'CHECKED' or ${t.supportingExcerpt} is not null`),
  ]
);

/**
 * PHASE B — one attempt to fetch a source URL (ADR-023). Append-only (database trigger).
 *
 * A retrieval records what the world returned and when; it proves a page EXISTED, never that it supports a claim.
 * `text_content` is kept (bounded, normalised) so a human can review it and so an excerpt can be proven verbatim.
 * It may contain a prospect's contact details, so it is shown only to actors allowed to see contact values.
 */
export const evidenceRetrieval = pgTable(
  'evidence_retrieval',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: text('run_id').notNull(),
    requestedUrl: text('requested_url').notNull(),
    finalUrl: text('final_url'),
    redirectChain: jsonb('redirect_chain').$type<string[]>().notNull().default([]),
    httpStatus: integer('http_status'),
    outcome: text('outcome').notNull(),
    contentType: text('content_type'),
    byteSize: integer('byte_size'),
    contentSha256: text('content_sha256'),
    textContent: text('text_content'),
    error: text('error'),
    userAgent: text('user_agent').notNull(),
    fetchedByLabel: text('fetched_by_label').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  },
  t => [
    index('evidence_retrieval_url_idx').on(t.requestedUrl),
    index('evidence_retrieval_run_idx').on(t.runId),
    check(
      'evidence_retrieval_outcome_check',
      sql`${t.outcome} in ('OK', 'DNS_FAILED', 'TIMEOUT', 'HTTP_4XX', 'HTTP_5XX', 'BLOCKED_PRIVATE_ADDRESS', 'TOO_LARGE', 'UNSUPPORTED_TYPE', 'ROBOTS_DISALLOWED', 'TLS_ERROR', 'INVALID_URL', 'TOO_MANY_REDIRECTS', 'NETWORK_ERROR')`
    ),
    check('evidence_retrieval_hash_check', sql`${t.contentSha256} is null or ${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
    // Only a successful fetch holds content, and a successful fetch always does.
    check('evidence_retrieval_ok_content_check', sql`(${t.outcome} = 'OK') = (${t.contentSha256} is not null and ${t.textContent} is not null)`),
    check('evidence_retrieval_text_size_check', sql`${t.textContent} is null or length(${t.textContent}) <= 262144`),
  ]
);

/**
 * PHASE B — the record a lead had at each superseded version (ADR-022). Append-only (database trigger).
 *
 * History for rollback and "what did this lead say before?", never a second source of truth: the canonical record
 * is always `lead.record`. Holds contact values, so no service exposes it; only the revert tool reads it.
 */
export const leadRevision = pgTable(
  'lead_revision',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leadId: uuid('lead_id').notNull().references(() => lead.leadId, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    record: jsonb('record').$type<KachmoLead>().notNull(),
    recordSha256: text('record_sha256').notNull(),
    /** The audit action of the write that superseded this version. */
    supersededBy: text('superseded_by').notNull(),
    writtenByUserId: text('written_by_user_id'),
    writtenByLabel: text('written_by_label').notNull(),
    writtenAt: timestamp('written_at', { withTimezone: true }).defaultNow().notNull(),
  },
  t => [unique('lead_revision_lead_version_key').on(t.leadId, t.version), check('lead_revision_version_positive_check', sql`${t.version} >= 1`)]
);
