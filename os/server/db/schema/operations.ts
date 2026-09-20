import { sql } from 'drizzle-orm';
import { pgTable, text, uuid, integer, jsonb, timestamp, index, check } from 'drizzle-orm/pg-core';

/**
 * Suppression list. Append-only: entries are never deleted and their identifiers never edited (database trigger).
 * Lifting a suppression is an explicit, attributed revocation. `sequence` preserves list order, which determines the
 * reason reported by core's first-match suppression check.
 *
 * Phase 1 boundary: the Titan cron still reads the committed database/suppression.json. This table does not replace
 * that file; propagation to it is a separate, audited step (Phase 0 decision D4).
 */
export const suppressionEntry = pgTable(
  'suppression_entry',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sequence: integer('sequence').notNull().unique(),
    leadId: text('lead_id'),
    targetNumber: text('target_number'),
    companyName: text('company_name'),
    email: text('email'),
    phone: text('phone'),
    domain: text('domain'),
    reason: text('reason').notNull(),
    suppressedAt: text('suppressed_at').notNull(),
    source: text('source').notNull(),
    createdByUserId: text('created_by_user_id'),
    insertedAt: timestamp('inserted_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: text('revoked_by_user_id'),
    revokeReason: text('revoke_reason'),
  },
  t => [
    index('suppression_entry_target_idx').on(t.targetNumber),
    index('suppression_entry_email_idx').on(t.email),
    index('suppression_entry_domain_idx').on(t.domain),
    check(
      'suppression_entry_identifier_check',
      sql`coalesce(btrim(${t.leadId}), '') <> '' or coalesce(btrim(${t.targetNumber}), '') <> '' or coalesce(btrim(${t.email}), '') <> '' or coalesce(btrim(${t.phone}), '') <> '' or coalesce(btrim(${t.domain}), '') <> ''`
    ),
    check('suppression_entry_revocation_check', sql`(${t.revokedAt} is null) = (${t.revokeReason} is null)`),
  ]
);

/** The engine's append-only operational event log (analytics/events.jsonl), migrated as-is in its original order. */
export const analyticsEvent = pgTable(
  'analytics_event',
  {
    eventId: text('event_id').primaryKey(),
    sequence: integer('sequence').notNull().unique(),
    leadId: text('lead_id'),
    targetNumber: text('target_number'),
    companyName: text('company_name'),
    eventType: text('event_type').notNull(),
    channel: text('channel').notNull(),
    actor: text('actor').notNull(),
    occurredAt: text('occurred_at').notNull(),
    payload: jsonb('payload').notNull(),
    insertedAt: timestamp('inserted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  t => [index('analytics_event_lead_idx').on(t.leadId), index('analytics_event_type_idx').on(t.eventType)]
);

/**
 * Security audit log: who did what to which target, when. Append-only for every application role (database trigger
 * rejects UPDATE and DELETE). Contact values are never written into before/after/metadata.
 */
export const auditEvent = pgTable(
  'audit_event',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    actorUserId: text('actor_user_id'),
    actorLabel: text('actor_label').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    requestId: text('request_id'),
    ipHash: text('ip_hash'),
    metadata: jsonb('metadata').notNull().default({}),
    before: jsonb('before'),
    after: jsonb('after'),
  },
  t => [
    index('audit_event_occurred_idx').on(t.occurredAt),
    index('audit_event_target_idx').on(t.targetType, t.targetId),
    index('audit_event_actor_idx').on(t.actorUserId),
    check('audit_event_action_format_check', sql`${t.action} ~ '^[a-z][a-z_]*(\\.[a-z][a-z_]*)+$'`),
  ]
);

/**
 * PHASE E — the job ledger (ADR-033).
 *
 * One row per (job, period). It is what makes a scheduled job safe to run twice: the idempotency key is unique, so
 * a repeat of work that already SUCCEEDED is skipped rather than redone, a run that crashed is recognised by its
 * expired lease, and a failure is retried a bounded number of times and then left for a person.
 *
 * Rows are never deleted (database trigger) and carry no lead data: a summary of counts, and an error string.
 */
export const jobRun = pgTable(
  'job_run',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    job: text('job').notNull(),
    /** `<job>:<period>` — the same work is never done twice. */
    idempotencyKey: text('idempotency_key').notNull().unique(),
    status: text('status').notNull(),
    attempt: integer('attempt').notNull().default(1),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** While this is in the future, another process is believed to be running this key. */
    leaseUntil: timestamp('lease_until', { withTimezone: true }).notNull(),
    actorLabel: text('actor_label').notNull(),
    summary: jsonb('summary').notNull().default({}),
    error: text('error'),
  },
  t => [
    index('job_run_job_idx').on(t.job, t.startedAt),
    check('job_run_status_check', sql`${t.status} in ('RUNNING', 'SUCCEEDED', 'FAILED', 'ABANDONED')`),
    check('job_run_attempt_check', sql`${t.attempt} between 1 and 10`),
    check('job_run_finished_check', sql`(${t.status} = 'RUNNING') = (${t.finishedAt} is null)`),
  ]
);
