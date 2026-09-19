import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema/index';
import { loadLocalEnv } from '../db/local-env';
import { safeTargetLabel } from '../db/migration/hosted-target';

/**
 * The database connection every Phase B operator command uses: node-postgres (real transactions), TLS verified,
 * DATABASE_URL from the environment or os/.env.local. The target is always printed as a safe label so the operator
 * sees WHICH database a command is about to touch before it touches it.
 */
export function openOperatorDatabase() {
  loadLocalEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error('❌ DATABASE_URL is not set. Put it in os/.env.local.');
    process.exit(2);
  }
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true }, max: 2, connectionTimeoutMillis: 15_000, statement_timeout: 60_000 });
  return { db: drizzle({ client: pool, schema }), close: () => pool.end(), label: safeTargetLabel(url) };
}
