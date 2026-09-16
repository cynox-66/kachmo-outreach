/**
 * HOSTED MIGRATION REHEARSAL. `npm run db:rehearse:hosted`
 *
 * Runs the SAME rehearsal as `npm run db:rehearse` — same source snapshot, same import, same reconciliation, same
 * manifest — but against a real hosted PostgreSQL instead of in-memory PGlite. It exists to prove the things PGlite
 * cannot: real connectivity, bounded timeouts, the wire protocol's jsonb round-trip, and a real server's behaviour
 * under transactions and constraint violations.
 *
 * It is separately gated on purpose (server/db/migration/hosted-target.ts): the presence of DATABASE_URL is NOT
 * authorisation. The operator must name the exact host and acknowledge the target is disposable.
 *
 * This command NEVER runs against production, and the plain `db:rehearse` path never learns how to reach a hosted
 * database at all.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../schema/index';
import { MIGRATIONS_FOLDER } from '../rehearsal-db';
import { rehearse, type RehearsalTarget, type RehearsalResult } from './rehearse';
import { authorizeHostedRehearsal, safeTargetLabel, type HostedAuthorization } from './hosted-target';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Bounded so a rehearsal against an unreachable host fails rather than hanging indefinitely. */
export const HOSTED_CONNECT_TIMEOUT_MS = 15_000;
export const HOSTED_STATEMENT_TIMEOUT_MS = 120_000;

export class HostedRehearsalRefused extends Error {
  constructor(public readonly authorization: HostedAuthorization) {
    super(authorization.message);
  }
}

/**
 * Opens a hosted target and applies every schema migration to it.
 *
 * TLS always verifies the server certificate. Timeouts are explicit on the pool AND as a server-side
 * statement_timeout, so neither a dead network nor a pathological query can wedge the rehearsal.
 */
export async function createHostedTarget(connectionString: string): Promise<RehearsalTarget> {
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    max: 4,
    connectionTimeoutMillis: HOSTED_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: 10_000,
    statement_timeout: HOSTED_STATEMENT_TIMEOUT_MS,
  });
  const db = drizzle({ client: pool, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, close: () => pool.end() };
}

export interface HostedRehearsalResult extends RehearsalResult {
  /** Host and database only — never the credentials. */
  target: string;
}

export async function rehearseHosted(
  env: NodeJS.ProcessEnv = process.env,
  ref = 'HEAD',
  openTarget: (url: string) => Promise<RehearsalTarget> = createHostedTarget
): Promise<HostedRehearsalResult> {
  const authorization = authorizeHostedRehearsal(env);
  if (!authorization.authorized) throw new HostedRehearsalRefused(authorization);
  const url = env.DATABASE_URL!;
  const result = await rehearse(ref, () => openTarget(url));
  return { ...result, target: safeTargetLabel(url) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ref = process.argv.find(a => a.startsWith('--ref='))?.slice(6) ?? 'HEAD';
  rehearseHosted(process.env, ref)
    .then(result => {
      const outDir = join(HERE, 'out');
      mkdirSync(outDir, { recursive: true });
      const file = join(outDir, `hosted-rehearsal-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
      console.log(`\n🌐 HOSTED migration rehearsal — target ${result.target}, source ${result.commit.slice(0, 12)}`);
      console.log(`   ${result.source.leads} leads · ${result.source.suppression} suppression entries · ${result.source.events} events`);
      for (const c of result.report.checks) console.log(`   ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
      console.log(`   ${result.secondImportRefused ? '✅' : '❌'} a second import into a populated database is refused`);
      console.log(`   ${result.losslessByHash ? '✅' : '❌'} stored lead records hash identically to the source records`);
      console.log(`   report: ${file}`);
      const ok = result.report.ok && result.secondImportRefused && result.losslessByHash;
      console.log(ok ? '\n✅ Hosted rehearsal passed. DESTROY the disposable database now.' : '\n❌ Hosted rehearsal FAILED. Do not migrate.');
      process.exit(ok ? 0 : 1);
    })
    .catch(err => {
      if (err instanceof HostedRehearsalRefused) {
        console.error(`\n⛔ ${err.message}`);
        console.error('   Nothing was contacted and nothing was written.');
        process.exit(2);
      }
      console.error(`\n❌ Hosted rehearsal aborted: ${(err as Error).message}`);
      process.exit(1);
    });
}
