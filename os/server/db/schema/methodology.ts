import { sql } from 'drizzle-orm';
import { pgTable, text, jsonb, timestamp, check, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Versioned research/qualification methodology. v1.0 = the tested core/ engine, pinned by its golden baseline.
 * At most one version is ACTIVE. Once a version has been ACTIVE its content can never change (database trigger);
 * a change to the methodology is a new version, so past evaluations stay attributable.
 */
export const methodologyVersion = pgTable(
  'methodology_version',
  {
    id: text('id').primaryKey(),
    status: text('status').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    config: jsonb('config').notNull(),
    goldenBaselineSha256: text('golden_baseline_sha256'),
    createdByLabel: text('created_by_label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  t => [
    check('methodology_version_status_check', sql`${t.status} in ('DRAFT', 'ACTIVE', 'RETIRED')`),
    check('methodology_version_id_format_check', sql`${t.id} ~ '^[0-9]+\\.[0-9]+$'`),
    uniqueIndex('methodology_version_single_active_idx').on(t.status).where(sql`${t.status} = 'ACTIVE'`),
  ]
);
