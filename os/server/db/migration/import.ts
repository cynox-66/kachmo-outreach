import { count } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '../schema/index.js';
import type { CanonicalSource } from './source.js';
import { leadRow, suppressionRow, analyticsEventRow } from './transform.js';
import { METHODOLOGY_V1_0 } from '../../methodology/v1.js';

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export class MigrationRefusedError extends Error {}

export interface ImportSummary {
  leads: number;
  suppressionEntries: number;
  analyticsEvents: number;
  methodologySeeded: boolean;
}

const BATCH = 100;

/**
 * Imports a validated canonical source in ONE transaction. Refuses to run when any target table already holds data:
 * a migration never merges into, overwrites or deletes existing rows. On any error the transaction rolls back and
 * nothing is written. Records an audit event with counts and file hashes only (no prospect data).
 */
export async function importCanonicalSource(db: Db, source: CanonicalSource, actorLabel: string): Promise<ImportSummary> {
  return db.transaction(async tx => {
    const occupied: string[] = [];
    for (const [name, table] of [['lead', schema.lead], ['suppression_entry', schema.suppressionEntry], ['analytics_event', schema.analyticsEvent]] as const) {
      const [{ n }] = await tx.select({ n: count() }).from(table);
      if (n > 0) occupied.push(`${name} (${n} rows)`);
    }
    if (occupied.length) {
      throw new MigrationRefusedError(`Refusing to import: target tables already contain data (${occupied.join(', ')}). Migrations never merge, overwrite or delete.`);
    }

    const [{ n: methodologyCount }] = await tx.select({ n: count() }).from(schema.methodologyVersion);
    let methodologySeeded = false;
    if (methodologyCount === 0) {
      await tx.insert(schema.methodologyVersion).values({ ...METHODOLOGY_V1_0, activatedAt: new Date() });
      methodologySeeded = true;
    }

    const leads = source.leads.map(leadRow);
    for (let i = 0; i < leads.length; i += BATCH) await tx.insert(schema.lead).values(leads.slice(i, i + BATCH));
    const sup = source.suppression.map(suppressionRow);
    for (let i = 0; i < sup.length; i += BATCH) await tx.insert(schema.suppressionEntry).values(sup.slice(i, i + BATCH));
    const events = source.events.map(analyticsEventRow);
    for (let i = 0; i < events.length; i += BATCH) await tx.insert(schema.analyticsEvent).values(events.slice(i, i + BATCH));

    const summary: ImportSummary = { leads: leads.length, suppressionEntries: sup.length, analyticsEvents: events.length, methodologySeeded };
    await tx.insert(schema.auditEvent).values({
      actorLabel,
      action: 'migration.import',
      targetType: 'database',
      metadata: { ...summary, sourceFileSha256: source.fileSha256 },
    });
    return summary;
  });
}
