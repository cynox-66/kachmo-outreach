import 'server-only';
import { count, desc, eq } from 'drizzle-orm';
import * as schema from '../db/schema/index';
import { getServer } from '../auth/instance';

/**
 * Counts for the dashboard, read from the hosted database only. Nothing here derives or re-implements engine results:
 * lead states are stored values produced by core/. When the database holds no leads (no approved migration yet) the
 * UI says exactly that rather than showing zeros as if they were findings.
 */
export interface OverviewCounts {
  leads: number;
  byResearchState: Array<{ state: string; count: number }>;
  suppressionEntries: number;
  auditEvents: number;
  methodology: { id: string; title: string; activatedAt: Date | null } | null;
  migrated: boolean;
}

export async function getOverviewCounts(): Promise<OverviewCounts> {
  const { db } = getServer();
  const [{ leads }] = await db.select({ leads: count() }).from(schema.lead);
  const byResearchState = await db
    .select({ state: schema.lead.researchState, count: count() })
    .from(schema.lead)
    .groupBy(schema.lead.researchState)
    .orderBy(desc(count()));
  const [{ suppressionEntries }] = await db.select({ suppressionEntries: count() }).from(schema.suppressionEntry);
  const [{ auditEvents }] = await db.select({ auditEvents: count() }).from(schema.auditEvent);
  const [methodology] = await db
    .select({ id: schema.methodologyVersion.id, title: schema.methodologyVersion.title, activatedAt: schema.methodologyVersion.activatedAt })
    .from(schema.methodologyVersion)
    .where(eq(schema.methodologyVersion.status, 'ACTIVE'));

  return { leads, byResearchState, suppressionEntries, auditEvents, methodology: methodology ?? null, migrated: leads > 0 };
}
