/**
 * Applies SCHEMA migrations to a hosted Postgres (Neon). `npm run db:migrate`
 *
 * Refuses unless DATABASE_URL is set AND KACHMO_MIGRATE_CONFIRM_HOST exactly equals its host, so a migration can
 * never hit a database by accident. This command creates/alters tables only. It never imports, rewrites or deletes
 * lead data: importing the real leads into a hosted database is not implemented in Phase 1.2 and requires explicit
 * owner approval after a passing rehearsal (npm run db:rehearse).
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { MIGRATIONS_FOLDER } from './rehearsal-db.js';

async function main() {
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
  const db = drizzle({ client: neon(url) });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  console.log(`✅ Schema migrations applied to ${host}. No data was imported.`);
}

main().catch(err => {
  console.error(`❌ ${(err as Error).message}`);
  process.exit(1);
});
