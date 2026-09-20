import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema/index';
import { loadLocalEnv } from '../db/local-env';
import { safeTargetLabel } from '../db/migration/hosted-target';

/**
 * The database connection every Phase B/C operator command uses: node-postgres (real transactions), TLS verified,
 * DATABASE_URL from the environment or os/.env.local. The target is always printed as a safe label, so the operator
 * sees WHICH database a command is about to touch before it touches it.
 *
 * A command that WRITES must also name that host in `KACHMO_OPERATOR_CONFIRM_HOST` (ADR-030). Without it, running a
 * writing command in a shell that forgot to export a rehearsal DATABASE_URL would silently fall back to production
 * from os/.env.local — the same class of accident `db:migrate` has always refused.
 */

/** Why a writing operator command may not run against this URL, or null when it may. Pure. */
export function operatorHostRefusal(url: string, env: Record<string, string | undefined> = process.env): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return 'DATABASE_URL is not a valid connection string.';
  }
  const confirmed = env.KACHMO_OPERATOR_CONFIRM_HOST?.trim();
  if (!confirmed) return `This command writes. Set KACHMO_OPERATOR_CONFIRM_HOST=${host} to confirm that exact target.`;
  if (confirmed.toLowerCase() !== host.toLowerCase()) return `KACHMO_OPERATOR_CONFIRM_HOST does not match the host in DATABASE_URL. Expected ${host}.`;
  return null;
}

export function openOperatorDatabase(opts: { writes?: boolean } = {}) {
  loadLocalEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error('❌ DATABASE_URL is not set. Put it in os/.env.local.');
    process.exit(2);
  }
  if (opts.writes) {
    const refusal = operatorHostRefusal(url);
    if (refusal) {
      console.error(`⛔ ${refusal}`);
      console.error(`   Nothing was contacted. Target would have been ${safeTargetLabel(url)}.`);
      process.exit(2);
    }
  }
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true }, max: 2, connectionTimeoutMillis: 15_000, statement_timeout: 60_000 });
  return { db: drizzle({ client: pool, schema }), close: () => pool.end(), label: safeTargetLabel(url) };
}
