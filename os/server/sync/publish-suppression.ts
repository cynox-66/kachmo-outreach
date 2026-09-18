/**
 * THE ADR-010 SUPPRESSION PUBLISHER. `npm run suppression:publish` / `npm run suppression:verify`
 *
 * Postgres is canonical for suppression. The GitHub Actions dispatcher reads the committed
 * database/suppression.json. This is the one audited executor that carries the former into the latter, and the
 * only thing permitted to write that file (ADR-018).
 *
 * WHAT PROTECTS AGAINST WHAT — the concurrency story, stated plainly because a vague one is worthless:
 *
 *   two publishers in the same workspace   → an O_EXCL lock file. The second exits rather than interleaving.
 *   the artifact moving between read/write → compare-and-swap on the SHA-256 of the exact bytes read
 *                                            (core/reconciliation/publish.ts plans against it; the store enforces
 *                                            it). This is what protects publishers on DIFFERENT machines: the
 *                                            loser's write is refused, not merged.
 *   a partial write                        → write-to-temp then rename, so the dispatcher never sees half a file
 *   a stale Postgres read                  → the whole plan is recomputed from a single snapshot each run, and
 *                                            re-verified against the written bytes afterwards. A publish that
 *                                            cannot verify itself reports failure and blocks outreach
 *   losing a suppression                   → the plan is additive-only; WOULD_REMOVE is a refusal, not a merge
 *   an unexplained artifact entry          → verification refuses rather than overwriting it
 *
 * Idempotent: the serialization is deterministic and the publisher writes nothing when the bytes would not change,
 * so re-running produces no diff, no commit churn, and no second "published" audit event.
 *
 * DRY RUN BY DEFAULT. `--apply` is required to write, matching every other operator-facing command here.
 */
import { asc } from 'drizzle-orm';
import { existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { SuppressionEntry } from '@kachmo/core/leads/schema.js';
import { planSuppressionPublish } from '@kachmo/core/reconciliation/publish.js';
import { verifySuppressionArtifact, suppressionStateHash, type ArtifactVerdict } from '@kachmo/core/reconciliation/suppression-artifact.js';
import * as schema from '../db/schema/index';
import { suppressionEntryFromRow } from '../db/migration/transform';
import { recordAudit } from '../audit/audit';
import { safeTargetLabel } from '../db/migration/hosted-target';
import { loadLocalEnv } from '../db/local-env';
import { runDispatchPreflight } from './dispatch-preflight';
import { REPO_ROOT, SUPPRESSION_ARTIFACT, readSuppressionArtifact, writeSuppressionArtifact, sha256, ArtifactConflictError } from './suppression-artifact-store';

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const LOCK_FILE = 'database/.suppression-publish.lock';

export interface CanonicalSuppression {
  active: SuppressionEntry[];
  revoked: SuppressionEntry[];
}

/**
 * Active suppression is what gets published. A REVOKED entry is deliberately NOT published: revocation means the
 * person is no longer suppressed. An already-published entry that is later revoked stays in the artifact, because
 * a publish never removes — lifting it there is a separate, attributed act.
 */
export async function readCanonicalSuppression(db: Db): Promise<CanonicalSuppression> {
  const rows = await db.select().from(schema.suppressionEntry).orderBy(asc(schema.suppressionEntry.sequence));
  return {
    active: rows.filter(r => r.revokedAt === null).map(suppressionEntryFromRow),
    revoked: rows.filter(r => r.revokedAt !== null).map(suppressionEntryFromRow),
  };
}

export type PublishOutcome = 'IN_SYNC' | 'PUBLISHED' | 'WOULD_PUBLISH' | 'REFUSED' | 'CONFLICT' | 'FAILED';

export interface PublishResult {
  outcome: PublishOutcome;
  /** Verification of the artifact BEFORE the run. */
  before: ArtifactVerdict;
  /** Verification of the artifact AFTER the run. A publish that cannot verify itself is a failure. */
  after: ArtifactVerdict | null;
  appended: number;
  artifactShaBefore: string;
  artifactShaAfter: string | null;
  canonicalHash: string;
  outreachAllowed: boolean;
  reason: string;
}

export interface PublishOptions {
  apply?: boolean;
  root?: string;
  /** Identifies who ran it in the audit trail. */
  actor?: { userId: string | null; label: string };
}

class Lock {
  private fd: number | null = null;
  constructor(private readonly path: string) {}
  acquire(): void {
    try {
      this.fd = openSync(this.path, 'wx');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`another suppression publish is in progress (${this.path} exists). If that is stale, remove it and re-run.`);
      }
      throw e;
    }
  }
  release(): void {
    if (this.fd === null) return;
    closeSync(this.fd);
    this.fd = null;
    if (existsSync(this.path)) unlinkSync(this.path);
  }
}

/**
 * Publishes (or, without `apply`, reports what a publish would do).
 *
 * Every exit records an audit event before returning, refusals included: an unaudited refusal is indistinguishable
 * from the command never having been run.
 */
export async function publishSuppression(db: Db, opts: PublishOptions = {}): Promise<PublishResult> {
  const root = opts.root ?? REPO_ROOT;
  const apply = opts.apply ?? false;
  const actor = opts.actor ?? { userId: null, label: 'SUPPRESSION_PUBLISHER' };

  let canonical: CanonicalSuppression;
  try {
    canonical = await readCanonicalSuppression(db);
  } catch (e) {
    const before = verifySuppressionArtifact({ canonicalActive: null, artifactRaw: readSuppressionArtifact(root).raw, hash: sha256 });
    const result: PublishResult = {
      outcome: 'FAILED', before, after: null, appended: 0,
      artifactShaBefore: before.artifactHash ?? '', artifactShaAfter: null, canonicalHash: '',
      outreachAllowed: false, reason: `canonical suppression could not be read: ${(e as Error).message}`,
    };
    await safeAudit(db, actor, 'suppression.publish_failed', result);
    return result;
  }

  const canonicalHash = suppressionStateHash(canonical.active, sha256);
  const read = readSuppressionArtifact(root);
  const before = verifySuppressionArtifact({ canonicalActive: canonical.active, canonicalRevoked: canonical.revoked, artifactRaw: read.raw, hash: sha256 });

  const finish = async (r: PublishResult, action: Parameters<typeof safeAudit>[2]): Promise<PublishResult> => {
    await safeAudit(db, actor, action, r);
    return r;
  };
  const base = { before, after: null as ArtifactVerdict | null, appended: 0, artifactShaBefore: read.sha, artifactShaAfter: null as string | null, canonicalHash };

  // A malformed or unexplained artifact is never overwritten: something put data there that nothing should have,
  // and silently replacing it would destroy the only evidence of what happened.
  if (before.status === 'MALFORMED' || before.status === 'EXTRA_ENTRIES') {
    return finish({ ...base, outcome: 'REFUSED', outreachAllowed: false, reason: before.reason }, 'suppression.publish_refused');
  }

  const plan = planSuppressionPublish({ canonical: canonical.active, remote: read.entries, remoteSha: read.sha, observedSha: read.sha });

  if (plan.refusal?.code === 'NOTHING_TO_PUBLISH' && before.status === 'IN_SYNC') {
    return finish({ ...base, outcome: 'IN_SYNC', after: before, artifactShaAfter: read.sha, outreachAllowed: true, reason: before.reason }, 'suppression.publish_verified');
  }
  if (plan.refusal) {
    return finish({ ...base, outcome: 'REFUSED', outreachAllowed: false, reason: plan.refusal.message }, 'suppression.publish_refused');
  }
  if (!apply) {
    return finish(
      { ...base, outcome: 'WOULD_PUBLISH', appended: plan.toAppend.length, outreachAllowed: false, reason: `${plan.toAppend.length} entr(y/ies) would be appended; re-run with --apply` },
      'suppression.publish_attempted'
    );
  }

  const lock = new Lock(join(root, LOCK_FILE));
  try {
    lock.acquire();
  } catch (e) {
    return finish({ ...base, outcome: 'CONFLICT', outreachAllowed: false, reason: (e as Error).message }, 'suppression.publish_conflict');
  }
  try {
    const written = writeSuppressionArtifact(plan.nextContents, plan.expectedBaseSha, root);
    // Re-read from disk and re-verify. A publish that trusts its own write is exactly the "showed synced because
    // the request was sent" failure ADR-010 forbids.
    const after = verifySuppressionArtifact({
      canonicalActive: canonical.active,
      canonicalRevoked: canonical.revoked,
      artifactRaw: readSuppressionArtifact(root).raw,
      hash: sha256,
    });
    const ok = after.status === 'IN_SYNC';
    return finish(
      {
        ...base, outcome: ok ? 'PUBLISHED' : 'FAILED', after, appended: plan.toAppend.length,
        artifactShaAfter: written.sha, outreachAllowed: ok,
        reason: ok ? `published ${plan.toAppend.length} entr(y/ies); artifact verified against Postgres` : `wrote the artifact but verification failed afterwards: ${after.reason}`,
      },
      ok ? 'suppression.publish_verified' : 'suppression.publish_failed'
    );
  } catch (e) {
    const conflict = e instanceof ArtifactConflictError;
    return finish(
      { ...base, outcome: conflict ? 'CONFLICT' : 'FAILED', outreachAllowed: false, reason: (e as Error).message },
      conflict ? 'suppression.publish_conflict' : 'suppression.publish_failed'
    );
  } finally {
    lock.release();
  }
}

/**
 * Audit metadata carries hashes and counts, never contact values: an audit row that listed suppressed email
 * addresses would leak exactly the data suppression exists to protect.
 */
async function safeAudit(
  db: Db,
  actor: { userId: string | null; label: string },
  action: 'suppression.publish_verified' | 'suppression.publish_attempted' | 'suppression.publish_refused' | 'suppression.publish_conflict' | 'suppression.publish_failed',
  r: PublishResult
): Promise<void> {
  try {
    await recordAudit(db, {
      actor,
      action,
      target: { type: 'suppression_artifact', id: SUPPRESSION_ARTIFACT },
      metadata: {
        outcome: r.outcome,
        reason: r.reason,
        appended: r.appended,
        canonical_hash: r.canonicalHash,
        artifact_sha_before: r.artifactShaBefore,
        artifact_sha_after: r.artifactShaAfter,
        status_before: r.before.status,
        status_after: r.after?.status ?? null,
        missing_count: r.before.missing.length,
        extra_unexplained_count: r.before.extraUnexplained.length,
        outreach_allowed: r.outreachAllowed,
      },
    });
  } catch (e) {
    // The publish result must still reach the operator even if the audit insert fails; the failure is reported
    // rather than swallowed, and outreach is gated on verification, not on this write.
    console.error(`⚠️  audit event could not be recorded: ${(e as Error).message}`);
  }
}

/** Verification only — never writes, never locks. Safe to run anywhere, including before a dispatch. */
export async function verifySuppression(db: Db, root: string = REPO_ROOT): Promise<ArtifactVerdict> {
  let canonical: CanonicalSuppression | null = null;
  try {
    canonical = await readCanonicalSuppression(db);
  } catch {
    return verifySuppressionArtifact({ canonicalActive: null, artifactRaw: readSuppressionArtifact(root).raw, hash: sha256 });
  }
  return verifySuppressionArtifact({
    canonicalActive: canonical.active,
    canonicalRevoked: canonical.revoked,
    artifactRaw: readSuppressionArtifact(root).raw,
    hash: sha256,
  });
}

if (process.argv[1] && /publish-suppression\.ts$/.test(process.argv[1])) {
  loadLocalEnv();
  const apply = process.argv.includes('--apply');
  const verifyOnly = process.argv.includes('--verify');
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error('❌ DATABASE_URL is not set. Put it in os/.env.local.');
    process.exit(2);
  }
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true }, max: 2, connectionTimeoutMillis: 15_000, statement_timeout: 60_000 });
  const db = drizzle({ client: pool, schema });
  const label = safeTargetLabel(url);

  (async () => {
    console.log(`\n🔒 Suppression artifact — target ${label}`);
    console.log(`   artifact: ${SUPPRESSION_ARTIFACT}`);
    if (verifyOnly) {
      const v = await verifySuppression(db);
      console.log(`   status:   ${v.status}`);
      console.log(`   missing:  ${v.missing.length} · unexplained extra: ${v.extraUnexplained.length}`);
      console.log(`   ${v.outreachAllowed ? '✅' : '⛔'} ${v.reason}`);
      // Artifact equivalence alone does not mean the dispatcher will honour every suppression; see dispatch-preflight.
      const p = await runDispatchPreflight(db, REPO_ROOT);
      console.log(`\n🚦 Dispatch preflight — scheduled-queue.json against Postgres`);
      console.log(`   queued:   ${p.queued}`);
      for (const f of p.findings) console.log(`   ⛔ ${f.kind} — target ${f.target_number}`);
      console.log(`   ${p.ok ? '✅' : '⛔'} ${p.reason}`);
      return v.outreachAllowed && p.ok ? 0 : 1;
    }
    const r = await publishSuppression(db, { apply, actor: { userId: null, label: 'CLI' } });
    console.log(`   before:   ${r.before.status} (artifact ${r.artifactShaBefore.slice(0, 12)})`);
    console.log(`   outcome:  ${r.outcome}${r.appended ? ` · ${r.appended} appended` : ''}`);
    if (r.after) console.log(`   after:    ${r.after.status} (artifact ${(r.artifactShaAfter ?? '').slice(0, 12)})`);
    console.log(`   ${r.outreachAllowed ? '✅' : '⛔'} ${r.reason}`);
    if (!apply && r.outcome === 'WOULD_PUBLISH') console.log('\n   DRY RUN — nothing was written. Re-run with --apply to publish.');
    if (r.outcome === 'PUBLISHED') console.log(`\n   ${SUPPRESSION_ARTIFACT} was updated. COMMIT IT: the dispatcher reads the committed file, not your working tree.`);
    return r.outreachAllowed || r.outcome === 'WOULD_PUBLISH' ? 0 : 1;
  })()
    .then(code => pool.end().then(() => process.exit(code)))
    .catch(err => {
      console.error(`\n❌ Suppression publish aborted: ${(err as Error).message}`);
      pool.end().finally(() => process.exit(1));
    });
}
