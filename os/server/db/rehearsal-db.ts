import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema/index';

export const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * A throwaway in-memory PostgreSQL (PGlite) with every migration applied. Used by migration rehearsals and tests,
 * so schema, constraints, triggers, import and reconciliation are exercised without touching any hosted database.
 */
export async function createRehearsalDatabase() {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, client, close: () => client.close() };
}

export type RehearsalDatabase = Awaited<ReturnType<typeof createRehearsalDatabase>>['db'];
