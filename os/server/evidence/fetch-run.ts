/**
 * `npm --prefix os run evidence:fetch -- [--lead=<target>] [--limit=20] [--apply --actor="<your name>"]` (CAP-6).
 *
 * Fetches the source URLs of unchecked evidence so a human can review them. A named person runs it; nothing
 * schedules it.
 *
 *   - DRY RUN by default: lists the URLs it would fetch, touches no network, writes nothing.
 *   - One retrieval per URL, however many claims cite it; every attempt is appended to `evidence_retrieval`.
 *   - A successful fetch links the retrieval to the claims (level becomes RETRIEVED). It never reviews them.
 *   - Retries across runs: after a failure the URL cools down for 1 h, then 24 h; after 3 failures it is left for a
 *     human (NEEDS_HUMAN) and never retried automatically.
 *   - One small transaction per URL, so an interrupted run loses at most the fetch in flight.
 *   - Nothing here touches a lead, a gate, a score, suppression or any outreach path.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import * as schema from '../db/schema/index';
import { recordAudit } from '../audit/audit';
import { assertHumanLabel } from '../leads/actor-binding';
import type { Db } from '../leads/locks';
import { fetchSource, USER_AGENT, type FetchOptions, type FetchOutcome } from './fetch';

export const MAX_ATTEMPTS = 3;
/** Cooldown after the n-th failure (1-based). */
export const COOLDOWN_MS = [60 * 60 * 1000, 24 * 60 * 60 * 1000];

export interface FetchCandidate {
  url: string;
  evidenceIds: string[];
  targetNumbers: string[];
  failures: number;
  /** Why this URL is not being fetched now, or null when it will be. */
  skip: 'COOLDOWN' | 'NEEDS_HUMAN' | 'ALREADY_RETRIEVED' | null;
  reusableRetrievalId: string | null;
}

export interface FetchPlan {
  candidates: FetchCandidate[];
  toFetch: FetchCandidate[];
}

export async function planFetch(db: Db, opts: { targetNumber?: string | null; limit?: number; now?: Date } = {}): Promise<FetchPlan> {
  const now = (opts.now ?? new Date()).getTime();
  const where = [isNull(schema.leadEvidence.retrievalId), eq(schema.leadEvidence.reviewStatus, 'UNREVIEWED'), isNull(schema.leadEvidence.contradictsEvidenceId)];
  const rows = await db
    .select({ id: schema.leadEvidence.id, url: schema.leadEvidence.sourceUrl, leadId: schema.leadEvidence.leadId, targetNumber: schema.lead.targetNumber })
    .from(schema.leadEvidence)
    .innerJoin(schema.lead, eq(schema.lead.leadId, schema.leadEvidence.leadId))
    .where(and(...where, ...(opts.targetNumber ? [eq(schema.lead.targetNumber, opts.targetNumber.padStart(3, '0'))] : [])))
    .orderBy(asc(schema.lead.targetNumber), asc(schema.leadEvidence.recordedAt));

  const byUrl = new Map<string, FetchCandidate>();
  for (const r of rows) {
    if (!r.url) continue;
    const c = byUrl.get(r.url) ?? { url: r.url, evidenceIds: [], targetNumbers: [], failures: 0, skip: null, reusableRetrievalId: null };
    c.evidenceIds.push(r.id);
    if (!c.targetNumbers.includes(r.targetNumber)) c.targetNumbers.push(r.targetNumber);
    byUrl.set(r.url, c);
  }
  const urls = [...byUrl.keys()];
  const history = urls.length
    ? await db
        .select({ id: schema.evidenceRetrieval.id, url: schema.evidenceRetrieval.requestedUrl, outcome: schema.evidenceRetrieval.outcome, at: schema.evidenceRetrieval.fetchedAt })
        .from(schema.evidenceRetrieval)
        .where(inArray(schema.evidenceRetrieval.requestedUrl, urls))
        .orderBy(desc(schema.evidenceRetrieval.fetchedAt))
    : [];

  for (const c of byUrl.values()) {
    const attempts = history.filter(h => h.url === c.url);
    const ok = attempts.find(h => h.outcome === 'OK');
    if (ok) {
      // Another claim already got this page: link to it rather than fetching the same URL again.
      c.skip = 'ALREADY_RETRIEVED';
      c.reusableRetrievalId = ok.id;
      continue;
    }
    c.failures = attempts.length;
    if (c.failures >= MAX_ATTEMPTS) c.skip = 'NEEDS_HUMAN';
    else if (c.failures > 0 && now - attempts[0].at.getTime() < COOLDOWN_MS[Math.min(c.failures, COOLDOWN_MS.length) - 1]) c.skip = 'COOLDOWN';
  }
  const candidates = [...byUrl.values()];
  const toFetch = candidates.filter(c => !c.skip).slice(0, Math.max(1, Math.min(opts.limit ?? 20, 200)));
  return { candidates, toFetch };
}

export interface FetchRunResult {
  runId: string;
  fetched: number;
  linked: number;
  byOutcome: Partial<Record<FetchOutcome, number>>;
}

/**
 * Fetches the planned URLs one at a time, at most one request per host every `spacingMs`, and records each attempt.
 * `fetchOptions` and `sleep` are injectable so the suite never touches the network or the clock.
 */
export async function runFetch(
  db: Db,
  opts: { actor: string; targetNumber?: string | null; limit?: number; now?: Date; fetchOptions?: FetchOptions; spacingMs?: number; sleep?: (ms: number) => Promise<void> }
): Promise<FetchRunResult> {
  assertHumanLabel(opts.actor);
  const actor = opts.actor.trim();
  const runId = `fetch-${(opts.now ?? new Date()).toISOString()}-${randomUUID().slice(0, 8)}`;
  const plan = await planFetch(db, opts);
  const sleep = opts.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));
  const spacing = opts.spacingMs ?? 5_000;
  const robotsCache = opts.fetchOptions?.robotsCache ?? new Map<string, string | null>();
  const lastHit = new Map<string, number>();
  const byOutcome: Partial<Record<FetchOutcome, number>> = {};
  let linked = 0;

  // Reuse existing successful retrievals first: no network.
  for (const c of plan.candidates.filter(x => x.skip === 'ALREADY_RETRIEVED' && x.reusableRetrievalId)) {
    linked += await linkRetrieval(db, c.evidenceIds, c.reusableRetrievalId!);
  }

  for (const c of plan.toFetch) {
    let host = '';
    try {
      host = new URL(c.url).hostname;
    } catch {
      /* invalid URLs are recorded as such by fetchSource */
    }
    const waited = host ? Date.now() - (lastHit.get(host) ?? 0) : spacing;
    if (host && waited < spacing) await sleep(spacing - waited);
    const r = await fetchSource(c.url, { ...opts.fetchOptions, robotsCache });
    if (host) lastHit.set(host, Date.now());
    byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;

    await db.transaction(async tx => {
      const [row] = await tx
        .insert(schema.evidenceRetrieval)
        .values({
          runId,
          requestedUrl: c.url,
          finalUrl: r.finalUrl,
          redirectChain: r.redirectChain,
          httpStatus: r.httpStatus,
          outcome: r.outcome,
          contentType: r.contentType,
          byteSize: r.byteSize,
          contentSha256: r.contentSha256,
          textContent: r.textContent,
          error: r.error,
          userAgent: USER_AGENT,
          fetchedByLabel: actor,
        })
        .returning({ id: schema.evidenceRetrieval.id });
      if (r.outcome === 'OK') linked += await linkRetrieval(tx, c.evidenceIds, row.id);
    });
  }

  await recordAudit(db, {
    actor: { userId: null, label: actor },
    action: 'evidence.fetch_run',
    target: { type: 'database', id: null },
    metadata: {
      runId,
      planned: plan.toFetch.length,
      byOutcome,
      linked,
      skipped: {
        cooldown: plan.candidates.filter(c => c.skip === 'COOLDOWN').length,
        needsHuman: plan.candidates.filter(c => c.skip === 'NEEDS_HUMAN').length,
        reused: plan.candidates.filter(c => c.skip === 'ALREADY_RETRIEVED').length,
      },
      // Hosts only — a URL's path and query can carry identifiers, and the audit log is not the place for them.
      hosts: [...new Set(plan.toFetch.map(c => {
        try {
          return new URL(c.url).hostname;
        } catch {
          return 'invalid';
        }
      }))].slice(0, 50),
    },
  });
  return { runId, fetched: plan.toFetch.length, linked, byOutcome };
}

/** Links a successful retrieval to still-unreviewed claims. The database guard keeps a linked retrieval fixed. */
async function linkRetrieval(tx: Db, evidenceIds: string[], retrievalId: string): Promise<number> {
  if (!evidenceIds.length) return 0;
  const updated = await tx
    .update(schema.leadEvidence)
    .set({ retrievalId, validator: 'FETCHER' })
    .where(and(inArray(schema.leadEvidence.id, evidenceIds), isNull(schema.leadEvidence.retrievalId), eq(schema.leadEvidence.reviewStatus, 'UNREVIEWED')))
    .returning({ id: schema.leadEvidence.id });
  return updated.length;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1] && /server[\\/]evidence[\\/]fetch-run\.ts$/.test(process.argv[1])) {
  const { openOperatorDatabase } = await import('../leads/operator-db');
  const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const apply = process.argv.includes('--apply');
  const limit = Number(arg('limit') ?? 20);
  const targetNumber = arg('lead') ?? null;
  const { db, close, label } = openOperatorDatabase();
  (async () => {
    console.log(`\n🔎 Evidence fetch — target ${label}`);
    const plan = await planFetch(db, { targetNumber, limit });
    const count = (s: FetchCandidate['skip']) => plan.candidates.filter(c => c.skip === s).length;
    console.log(`   ${plan.candidates.length} source URL(s) awaiting retrieval · ${plan.toFetch.length} to fetch now · ${count('COOLDOWN')} cooling down · ${count('NEEDS_HUMAN')} need a human · ${count('ALREADY_RETRIEVED')} already retrieved (will link)`);
    for (const c of plan.toFetch) console.log(`   ${c.targetNumbers.join(',').padEnd(8)} ${c.url}${c.failures ? `  (attempt ${c.failures + 1})` : ''}`);
    if (!apply) {
      console.log('\n   DRY RUN — no network, nothing written. Re-run with --apply --actor="<your name>".');
      return 0;
    }
    const r = await runFetch(db, { actor: arg('actor') ?? '', targetNumber, limit });
    console.log(`\n   ✅ run ${r.runId}: ${r.fetched} fetched, ${r.linked} claim(s) now RETRIEVED — ${JSON.stringify(r.byOutcome)}`);
    console.log('   Nothing was reviewed: a person must still confirm each page states its claim (lead page → Evidence).');
    return 0;
  })()
    .then(code => close().then(() => process.exit(code)))
    .catch(err => {
      console.error(`\n❌ ${(err as Error).message}`);
      close().finally(() => process.exit(1));
    });
}
