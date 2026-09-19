import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema/index';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * THE CANONICAL WRITE LOCK (ADR-026).
 *
 * Every write that changes canonical lead state — a lead update, a lead insert, a suppression entry, an analytics
 * sequence number, a target number — takes this one transaction-scoped advisory lock first. So:
 *
 *   - a suppression and a candidate approval can never interleave: whichever commits second re-reads the first,
 *     which closes the gap ADR-017 describes ("the gap between approval and insert is small but not zero");
 *   - sequence numbers and target numbers are allocated gap-free as max+1 without racing;
 *   - there is exactly one lock, so there is no lock ordering to get wrong and no deadlock to reason about.
 *
 * Serialising every canonical write is a deliberate trade: two operators produce a handful of writes a minute, and
 * correctness under concurrency is worth far more than parallel throughput nobody needs. The lock is released
 * automatically when the transaction commits or rolls back.
 */
export const CANONICAL_WRITE_LOCK = 0x4b41_4348; // "KACH" — a fixed, documented key; never reused for anything else.

export async function lockCanonicalWrites(tx: Db): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${CANONICAL_WRITE_LOCK})`);
}

/** The next gap-free sequence number of an append-only table. Call only while holding the canonical write lock. */
export async function nextSequence(tx: Db, table: 'analytics_event' | 'suppression_entry'): Promise<number> {
  const target = table === 'analytics_event' ? schema.analyticsEvent : schema.suppressionEntry;
  const [row] = await tx.select({ max: sql<number | null>`max(${target.sequence})` }).from(target);
  return Number(row?.max ?? 0) + 1;
}
