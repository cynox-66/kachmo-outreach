import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index';

/**
 * Production database connection: node-postgres pool against Neon's pooled endpoint.
 * Chosen over the Neon HTTP driver because Better Auth's adapter needs real transactions.
 * TLS always verifies the server certificate. Import only from server code.
 */
export function createDatabase(connectionString: string) {
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  // Bounded waits (audit E2): an unreachable or saturated database now fails a request within seconds — and the page
  // shows its error state — instead of hanging until the platform kills the function. Both are CLIENT-side limits on
  // purpose: a server-side `statement_timeout` startup parameter can be rejected by a pooled (PgBouncer) endpoint, which
  // would turn a safety limit into an outage.
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: true }, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
  return { db: drizzle({ client: pool, schema }), pool };
}

export type Database = ReturnType<typeof createDatabase>['db'];
