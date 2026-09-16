import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';

/**
 * Production database connection: node-postgres pool against Neon's pooled endpoint.
 * Chosen over the Neon HTTP driver because Better Auth's adapter needs real transactions.
 * TLS always verifies the server certificate. Import only from server code.
 */
export function createDatabase(connectionString: string) {
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: true }, max: 5, idleTimeoutMillis: 10_000 });
  return { db: drizzle({ client: pool, schema }), pool };
}

export type Database = ReturnType<typeof createDatabase>['db'];
