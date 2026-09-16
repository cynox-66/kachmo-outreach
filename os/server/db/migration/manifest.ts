import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '../schema/index';
import { MIGRATIONS_FOLDER } from '../rehearsal-db';
import { sha256 } from './canonical';
import type { CanonicalSource } from './source';
import { SOURCE_FILES } from './source';

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * An auditable record of exactly what was migrated, from which code, into which schema.
 *
 * A rehearsal is only evidence if it is reproducible. The manifest pins every input that could change the result:
 * the git commit the data came from, the hash of each source file, the schema journal, and the physical shape of
 * the database afterwards (tables, columns, constraints, indexes, triggers). Re-running from the same commit must
 * produce the same manifest apart from the timestamp.
 *
 * It contains counts, identifiers and hashes only — never a contact value.
 */
export interface MigrationManifest {
  generatedAt: string;
  /** The exact commit the source data was read from. */
  sourceCommit: string;
  /** The commit the migration CODE is running from (HEAD of the working tree). */
  codeCommit: string;
  /** True when the working tree has uncommitted changes — a rehearsal from a dirty tree is not reproducible. */
  codeTreeDirty: boolean;
  /** The uncommitted paths that made it so. Regenerated operator artifacts are excluded. */
  codeTreeDirtyPaths: string[];
  schema: {
    /** drizzle journal entries, in order: the schema version this rehearsal applied. */
    migrations: Array<{ tag: string; when: number }>;
    journalSha256: string;
    /** Migration hashes the DATABASE reports as applied. Detects a database behind the code's journal. */
    appliedMigrationHashes: string[];
    tables: string[];
    columnCount: number;
    constraints: Array<{ table: string; name: string; type: string }>;
    indexes: Array<{ table: string; name: string }>;
    triggers: Array<{ table: string; name: string }>;
  };
  source: {
    files: Record<string, { path: string; sha256: string }>;
    leads: number;
    suppression: number;
    events: number;
    leadIds: string[];
    targetNumbers: string[];
    /** SHA-256 over the canonical form of every lead record, in target-number order. */
    leadRecordsSha256: string;
    provenance: { phoneStatus: Record<string, number>; emailStatus: Record<string, number>; withResearchSources: number };
  };
  target: {
    rowCounts: Record<string, number>;
    leadRecordsSha256: string;
    leadIds: string[];
  };
}

const CONSTRAINT_TYPE = { p: 'PRIMARY KEY', u: 'UNIQUE', c: 'CHECK', f: 'FOREIGN KEY' } as const;

async function rows<T>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

/** Reads the physical shape of the database, so a schema drift between rehearsal and production is detectable. */
export async function describeSchema(db: Db) {
  const journalPath = join(MIGRATIONS_FOLDER, 'meta/_journal.json');
  const journalRaw = existsSync(journalPath) ? readFileSync(journalPath, 'utf-8') : '{}';
  const journal = JSON.parse(journalRaw) as { entries?: Array<{ tag: string; when: number }> };

  const tables = await rows<{ table_name: string }>(
    db,
    sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`
  );
  const [cols] = await rows<{ n: string | number }>(db, sql`select count(*)::int as n from information_schema.columns where table_schema = 'public'`);
  const constraints = await rows<{ table: string; name: string; type: string }>(
    db,
    sql`select rel.relname as "table", con.conname as name, con.contype::text as type
        from pg_constraint con join pg_class rel on rel.oid = con.conrelid join pg_namespace ns on ns.oid = rel.relnamespace
        where ns.nspname = 'public' order by rel.relname, con.conname`
  );
  const indexes = await rows<{ table: string; name: string }>(
    db,
    sql`select tablename as "table", indexname as name from pg_indexes where schemaname = 'public' order by tablename, indexname`
  );
  // drizzle records what it has applied; a database behind the journal shows fewer entries here.
  let appliedMigrationHashes: string[] = [];
  try {
    const applied = await rows<{ hash: string }>(db, sql`select hash from drizzle.__drizzle_migrations order by created_at`);
    appliedMigrationHashes = applied.map(a => a.hash);
  } catch {
    appliedMigrationHashes = [];
  }

  const triggers = await rows<{ table: string; name: string }>(
    db,
    sql`select event_object_table as "table", trigger_name as name from information_schema.triggers
        where trigger_schema = 'public' group by event_object_table, trigger_name order by event_object_table, trigger_name`
  );

  return {
    migrations: journal.entries?.map(e => ({ tag: e.tag, when: e.when })) ?? [],
    journalSha256: sha256(journalRaw),
    appliedMigrationHashes,
    tables: tables.map(t => t.table_name),
    columnCount: Number(cols?.n ?? 0),
    constraints: constraints.map(c => ({ table: c.table, name: c.name, type: CONSTRAINT_TYPE[c.type as keyof typeof CONSTRAINT_TYPE] ?? c.type })),
    indexes,
    triggers,
  };
}

export async function buildManifest(
  db: Db,
  source: CanonicalSource,
  meta: { sourceCommit: string; codeCommit: string; codeTreeDirty: boolean; codeTreeDirtyPaths: string[]; generatedAt: string }
): Promise<MigrationManifest> {
  const ordered = [...source.leads].sort((a, b) => a.target_number.localeCompare(b.target_number));
  const sourceRecordsSha = sha256(ordered.map(l => source.leadRecordSha256.get(l.lead_id)).join('\n'));

  const tally = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});

  const counts: Record<string, number> = {};
  for (const [name, table] of [
    ['lead', schema.lead],
    ['lead_evaluation', schema.leadEvaluation],
    ['lead_evidence', schema.leadEvidence],
    ['suppression_entry', schema.suppressionEntry],
    ['analytics_event', schema.analyticsEvent],
    ['audit_event', schema.auditEvent],
    ['methodology_version', schema.methodologyVersion],
  ] as const) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
    counts[name] = Number(r.n);
  }

  const storedLeads = await db.select({ leadId: schema.lead.leadId, targetNumber: schema.lead.targetNumber, recordSha256: schema.lead.recordSha256 }).from(schema.lead);
  const storedOrdered = [...storedLeads].sort((a, b) => a.targetNumber.localeCompare(b.targetNumber));

  return {
    generatedAt: meta.generatedAt,
    sourceCommit: meta.sourceCommit,
    codeCommit: meta.codeCommit,
    codeTreeDirty: meta.codeTreeDirty,
    codeTreeDirtyPaths: meta.codeTreeDirtyPaths,
    schema: await describeSchema(db),
    source: {
      files: Object.fromEntries(Object.entries(SOURCE_FILES).map(([k, path]) => [k, { path, sha256: source.fileSha256[k] }])),
      leads: source.leads.length,
      suppression: source.suppression.length,
      events: source.events.length,
      leadIds: ordered.map(l => l.lead_id),
      targetNumbers: ordered.map(l => l.target_number),
      leadRecordsSha256: sourceRecordsSha,
      provenance: {
        phoneStatus: tally(source.leads.map(l => l.phone_status)),
        emailStatus: tally(source.leads.map(l => l.email_status)),
        withResearchSources: source.leads.filter(l => (l.research_sources ?? []).length > 0).length,
      },
    },
    target: {
      rowCounts: counts,
      leadRecordsSha256: sha256(storedOrdered.map(l => l.recordSha256).join('\n')),
      leadIds: storedOrdered.map(l => l.leadId),
    },
  };
}
