/**
 * Applies SCHEMA migrations to a hosted Postgres (Neon). `npm run db:migrate`
 *
 * Refuses unless DATABASE_URL is set AND KACHMO_MIGRATE_CONFIRM_HOST exactly equals its host, so a migration can
 * never hit a database by accident. This command creates/alters tables only: it never imports, rewrites or deletes
 * lead data. Importing the real leads is a separate, separately confirmed command (npm run db:migrate:data).
 *
 * Reads DATABASE_URL from os/.env.local when it is not already exported.
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { MIGRATIONS_FOLDER } from './rehearsal-db';
import { loadLocalEnv } from './local-env';

async function main() {
  loadLocalEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }
  if (process.env.KACHMO_MIGRATE_CONFIRM_HOST !== host) {
    throw new Error(`Refusing to migrate: set KACHMO_MIGRATE_CONFIRM_HOST=${host} to confirm this exact target.`);
  }
  // node-postgres, not the HTTP driver: DDL then runs inside a transaction, so a migration that fails part-way
  // rolls back instead of leaving a half-applied schema. It is also the exact transport the hosted rehearsal
  // exercised against real Neon, so production applies schema the same way the proof did.
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true }, max: 2, connectionTimeoutMillis: 15_000 });
  try {
    const db = drizzle({ client: pool, schema: {} });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
  console.log(`✅ Schema migrations applied to ${host}. No data was imported.`);
}

main().catch(err => {
  console.error(`❌ ${(err as Error).message}`);
  process.exit(1);
});
