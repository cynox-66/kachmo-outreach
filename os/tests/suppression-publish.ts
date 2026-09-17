/**
 * ADR-010 SUPPRESSION PUBLISHER — END-TO-END INTEGRATION TESTS.
 *
 * Everything runs against a throwaway in-memory PGlite with the real migrations applied, and a temp workspace
 * standing in for the repository. NOTHING here touches production Postgres, the real artifact, or SMTP, and every
 * identifier is synthetic.
 *
 * Cases A-J follow the required sequence: empty/in-sync, publish, idempotence, tampering in both directions,
 * source unavailable, dispatch refusal on stale state, restoration, and audit-event behaviour.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc } from 'drizzle-orm';
import type { SuppressionEntry } from '@kachmo/core/leads/schema.js';
import { verifySuppressionArtifact, serializeSuppressionArtifact, suppressionStateHash } from '@kachmo/core/reconciliation/suppression-artifact.js';
import { leadFromCandidate, nextTargetNumber, PromotionError } from '@kachmo/core/research/promotion.js';
import { validateLeadDatabase } from '@kachmo/core/leads/validation.js';
import { findInvariantViolations } from '@kachmo/core/leads/invariants.js';
import { createRehearsalDatabase } from '../server/db/rehearsal-db';
import * as schema from '../server/db/schema/index';
import { publishSuppression, verifySuppression, LOCK_FILE } from '../server/sync/publish-suppression';
import { readSuppressionArtifact, writeSuppressionArtifact, sha256, ArtifactConflictError, SUPPRESSION_ARTIFACT } from '../server/sync/suppression-artifact-store';

let passed = 0;
const failures: string[] = [];
function assert(cond: unknown, name: string, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ❌ ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
}
const group = (t: string) => console.log(`\n${t}`);

const OS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempDirs: string[] = [];
function newRoot(artifact: string | null = '[]\n'): string {
  const dir = mkdtempSync(join(tmpdir(), 'kachmo-suppression-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, 'database'), { recursive: true });
  if (artifact !== null) writeFileSync(join(dir, SUPPRESSION_ARTIFACT), artifact);
  return dir;
}

/** Synthetic only. `.invalid` is reserved by RFC 2606 and can never be a real recipient. */
const synthetic = (n: string): SuppressionEntry => ({
  target_number: `9${n}`,
  company_name: `Synthetic ${n}`,
  email: `opt-out-${n}@example.invalid`,
  domain: `synthetic-${n}.invalid`,
  reason: 'TEST_OPT_OUT',
  suppressed_at: `2026-09-1${n}T00:00:00.000Z`,
  source: 'integration test',
});

const { db, close } = await createRehearsalDatabase();
let seq = 0;
async function insertSuppression(e: SuppressionEntry, revoked = false): Promise<void> {
  await db.insert(schema.suppressionEntry).values({
    sequence: ++seq,
    leadId: e.lead_id ?? null,
    targetNumber: e.target_number ?? null,
    companyName: e.company_name ?? null,
    email: e.email ?? null,
    phone: e.phone ?? null,
    domain: e.domain ?? null,
    reason: e.reason,
    suppressedAt: e.suppressed_at,
    source: e.source,
    revokedAt: revoked ? new Date() : null,
    revokeReason: revoked ? 'test revocation' : null,
  });
}
const auditCount = async (): Promise<number> => (await db.select().from(schema.auditEvent)).length;
const auditActions = async (): Promise<string[]> => (await db.select().from(schema.auditEvent).orderBy(asc(schema.auditEvent.occurredAt))).map(r => r.action);

console.log('\n🔒 ADR-010 SUPPRESSION PUBLISHER — INTEGRATION');

// ─────────────────────────────────────────────────────────────────────────────
group('A. Empty Postgres, empty artifact → verification passes');
{
  const root = newRoot('[]\n');
  const v = await verifySuppression(db, root);
  assert(v.status === 'IN_SYNC', 'an empty artifact matches empty canonical state', v.status);
  assert(v.outreachAllowed === true, 'outreach is allowed when nothing is suppressed');
  const r = await publishSuppression(db, { apply: true, root });
  assert(r.outcome === 'IN_SYNC', 'publishing with nothing to publish is a no-op', r.outcome);
  assert(readFileSync(join(root, SUPPRESSION_ARTIFACT), 'utf-8') === '[]\n', 'the artifact bytes are untouched');
}

// ─────────────────────────────────────────────────────────────────────────────
group('B. One synthetic suppression → publish → artifact holds exactly one entry');
{
  await insertSuppression(synthetic('1'));
  const root = newRoot('[]\n');

  const stale = await verifySuppression(db, root);
  assert(stale.status === 'STALE', 'before publishing, the artifact is STALE', stale.status);
  assert(stale.outreachAllowed === false, 'a stale artifact blocks outreach');
  assert(stale.missing.length === 1, 'the missing entry is identified', stale.missing.length);

  const dry = await publishSuppression(db, { apply: false, root });
  assert(dry.outcome === 'WOULD_PUBLISH', 'a dry run reports what it would do', dry.outcome);
  assert(readFileSync(join(root, SUPPRESSION_ARTIFACT), 'utf-8') === '[]\n', 'a dry run writes nothing');

  const r = await publishSuppression(db, { apply: true, root });
  assert(r.outcome === 'PUBLISHED', 'the publish succeeds', r.outcome);
  assert(r.appended === 1, 'exactly one entry was appended', r.appended);
  assert(r.outreachAllowed === true, 'outreach is allowed once the artifact verifies');
  const written = JSON.parse(readFileSync(join(root, SUPPRESSION_ARTIFACT), 'utf-8')) as SuppressionEntry[];
  assert(written.length === 1, 'the artifact holds exactly one entry', written.length);
  assert(written[0].email === 'opt-out-1@example.invalid', 'the identifier survives the round trip', written[0].email);
  assert(written[0].suppressed_at === '2026-09-11T00:00:00.000Z', 'the original timestamp is preserved', written[0].suppressed_at);
  assert(written[0].reason === 'TEST_OPT_OUT' && written[0].source === 'integration test', 'reason and provenance are preserved');
  assert((await verifySuppression(db, root)).status === 'IN_SYNC', 'verification passes after publishing');
}

// ─────────────────────────────────────────────────────────────────────────────
group('C. Publishing again is idempotent and deterministic');
{
  const root = newRoot('[]\n');
  await publishSuppression(db, { apply: true, root });
  const first = readFileSync(join(root, SUPPRESSION_ARTIFACT), 'utf-8');
  const second = await publishSuppression(db, { apply: true, root });
  assert(second.outcome === 'IN_SYNC', 'the second publish has nothing to do', second.outcome);
  assert(readFileSync(join(root, SUPPRESSION_ARTIFACT), 'utf-8') === first, 'the bytes are byte-identical — no diff, no commit churn');
  const other = newRoot('[]\n');
  await publishSuppression(db, { apply: true, root: other });
  assert(readFileSync(join(other, SUPPRESSION_ARTIFACT), 'utf-8') === first, 'the same canonical state always produces the same bytes');
  assert(JSON.parse(first).length === 1, 'no duplicate entry was appended', JSON.parse(first).length);
}

// ─────────────────────────────────────────────────────────────────────────────
group('D/E/F. A tampered artifact fails verification');
{
  const base = newRoot('[]\n');
  await publishSuppression(db, { apply: true, root: base });
  const good = readFileSync(join(base, SUPPRESSION_ARTIFACT), 'utf-8');

  // E. entry removed
  const removed = newRoot('[]\n');
  const vRemoved = await verifySuppression(db, removed);
  assert(vRemoved.status === 'STALE', 'E: a removed entry is STALE', vRemoved.status);
  assert(vRemoved.outreachAllowed === false, 'E: a removed entry blocks outreach');

  // F. unexpected extra entry
  const extra = newRoot(serializeSuppressionArtifact([...(JSON.parse(good) as SuppressionEntry[]), synthetic('7')]));
  const vExtra = await verifySuppression(db, extra);
  assert(vExtra.status === 'EXTRA_ENTRIES', 'F: an unexplained extra entry is EXTRA_ENTRIES', vExtra.status);
  assert(vExtra.outreachAllowed === false, 'F: an extra entry blocks outreach');
  assert(vExtra.extraUnexplained.length === 1, 'F: the unexplained entry is identified');

  // D. modified in place — the identifier no longer matches any canonical entry
  const modified = (JSON.parse(good) as SuppressionEntry[]).map(e => ({ ...e, email: 'tampered@example.invalid', domain: 'tampered.invalid', target_number: '999' }));
  const vModified = await verifySuppression(db, newRoot(serializeSuppressionArtifact(modified)));
  assert(vModified.status !== 'IN_SYNC', 'D: a modified entry is not IN_SYNC', vModified.status);
  assert(vModified.outreachAllowed === false, 'D: a modified entry blocks outreach');

  // D. malformed
  const vMalformed = await verifySuppression(db, newRoot('{not json'));
  assert(vMalformed.status === 'MALFORMED', 'D: unparseable JSON is MALFORMED', vMalformed.status);
  assert(vMalformed.outreachAllowed === false, 'D: a malformed artifact blocks outreach');
  const vNotArray = await verifySuppression(db, newRoot('{"a":1}'));
  assert(vNotArray.status === 'MALFORMED', 'D: a non-array artifact is MALFORMED', vNotArray.status);
  const vBadEntry = await verifySuppression(db, newRoot('[{"reason":"x"}]'));
  assert(vBadEntry.status === 'MALFORMED', 'D: an entry with no identifier is MALFORMED', vBadEntry.status);

  // Missing entirely
  const vMissing = await verifySuppression(db, newRoot(null));
  assert(vMissing.status === 'MISSING', 'an absent artifact is MISSING, not "no suppressions"', vMissing.status);
  assert(vMissing.outreachAllowed === false, 'an absent artifact blocks outreach');

  // The publisher refuses to overwrite either, rather than destroying the evidence.
  const rMalformed = await publishSuppression(db, { apply: true, root: newRoot('{not json') });
  assert(rMalformed.outcome === 'REFUSED', 'the publisher refuses to overwrite a malformed artifact', rMalformed.outcome);
  const extraRoot = newRoot(serializeSuppressionArtifact([...(JSON.parse(good) as SuppressionEntry[]), synthetic('7')]));
  const rExtra = await publishSuppression(db, { apply: true, root: extraRoot });
  assert(rExtra.outcome === 'REFUSED', 'the publisher refuses to overwrite an unexplained extra entry', rExtra.outcome);
  assert(JSON.parse(readFileSync(join(extraRoot, SUPPRESSION_ARTIFACT), 'utf-8')).length === 2, 'the refused artifact is left exactly as it was');
}

// ─────────────────────────────────────────────────────────────────────────────
group('G. Postgres unavailable → the publisher fails closed');
{
  const root = newRoot('[]\n');
  const dead = { select: () => { throw new Error('connection terminated'); } } as unknown as Parameters<typeof publishSuppression>[0];
  const v = await verifySuppression(dead, root);
  assert(v.status === 'SOURCE_UNAVAILABLE', 'an unreadable Postgres is SOURCE_UNAVAILABLE', v.status);
  assert(v.outreachAllowed === false, 'an unreadable Postgres blocks outreach');
  const r = await publishSuppression(dead, { apply: true, root });
  assert(r.outcome === 'FAILED', 'the publisher fails rather than writing an empty artifact', r.outcome);
  assert(r.outreachAllowed === false, 'a failed publish blocks outreach');
  assert(readFileSync(join(root, SUPPRESSION_ARTIFACT), 'utf-8') === '[]\n', 'nothing was written when the source was unavailable');
}

// ─────────────────────────────────────────────────────────────────────────────
group('H/I. Stale artifact refuses dispatch; restoring synchronisation allows it');
{
  await insertSuppression(synthetic('2'));
  const root = newRoot('[]\n');
  await publishSuppression(db, { apply: true, root });
  assert((await verifySuppression(db, root)).outreachAllowed === true, 'I: after publishing both entries, outreach is allowed');

  await insertSuppression(synthetic('3'));
  const stale = await verifySuppression(db, root);
  assert(stale.status === 'STALE' && !stale.outreachAllowed, 'H: a new suppression makes the artifact stale and blocks dispatch', stale.status);

  const restored = await publishSuppression(db, { apply: true, root });
  assert(restored.outcome === 'PUBLISHED' && restored.outreachAllowed, 'I: publishing restores synchronisation', restored.outcome);
  assert((JSON.parse(readFileSync(join(root, SUPPRESSION_ARTIFACT), 'utf-8')) as unknown[]).length === 3, 'I: all three entries are present');
}

// ─────────────────────────────────────────────────────────────────────────────
group('Revocation: revoked entries are not published, and stay if already published');
{
  await insertSuppression(synthetic('4'), true);
  const root = newRoot('[]\n');
  const r = await publishSuppression(db, { apply: true, root });
  const written = JSON.parse(readFileSync(join(root, SUPPRESSION_ARTIFACT), 'utf-8')) as SuppressionEntry[];
  assert(r.outcome === 'PUBLISHED', 'the publish succeeds', r.outcome);
  assert(!written.some(e => e.email === 'opt-out-4@example.invalid'), 'a revoked suppression is never published');
  assert(written.length === 3, 'only the three active entries are published', written.length);

  // An entry revoked AFTER publication stays in the artifact: a publish never removes.
  const withRevoked = newRoot(serializeSuppressionArtifact([...written, synthetic('4')]));
  const v = await verifySuppression(db, withRevoked);
  assert(v.status === 'IN_SYNC', 'a published-then-revoked entry does not fail verification', v.status);
  assert(v.extraExplainedByRevocation.length === 1, 'it is reported as explained by revocation');
  assert(v.extraUnexplained.length === 0, 'and is not counted as unexplained');
  assert(v.outreachAllowed === true, 'it does not block outreach — the person stays protected');
}

// ─────────────────────────────────────────────────────────────────────────────
group('Concurrency: compare-and-swap and the publish lock');
{
  const root = newRoot('[]\n');
  const read = readSuppressionArtifact(root);
  writeFileSync(join(root, SUPPRESSION_ARTIFACT), '[\n]\n'); // someone else writes in between
  let threw: unknown = null;
  try {
    writeSuppressionArtifact([], read.sha, root);
  } catch (e) {
    threw = e;
  }
  assert(threw instanceof ArtifactConflictError, 'a write against a moved artifact is a conflict, not an overwrite');
  assert(readFileSync(join(root, SUPPRESSION_ARTIFACT), 'utf-8') === '[\n]\n', "the other writer's bytes survive");

  const locked = newRoot('[]\n');
  writeFileSync(join(locked, LOCK_FILE), '');
  const r = await publishSuppression(db, { apply: true, root: locked });
  assert(r.outcome === 'CONFLICT', 'a second concurrent publisher refuses', r.outcome);
  assert(r.outreachAllowed === false, 'a refused concurrent publish blocks outreach');
  rmSync(join(locked, LOCK_FILE));
  const after = await publishSuppression(db, { apply: true, root: locked });
  assert(after.outcome === 'PUBLISHED', 'once the lock is gone the publish proceeds', after.outcome);
  assert(!existsSync(join(locked, LOCK_FILE)), 'the lock is released afterwards');
}

// ─────────────────────────────────────────────────────────────────────────────
group('J. Audit events');
{
  const before = await auditCount();
  const root = newRoot('[]\n');
  await publishSuppression(db, { apply: true, root });
  const afterPublish = await auditCount();
  assert(afterPublish === before + 1, 'a publish records exactly one audit event', afterPublish - before);

  await publishSuppression(db, { apply: true, root });
  assert((await auditCount()) === afterPublish + 1, 'a no-op re-publish records its verification, not a second publish');
  const actions = await auditActions();
  assert(actions[actions.length - 1] === 'suppression.publish_verified', 'the no-op is recorded as verified', actions[actions.length - 1]);

  const refusedBefore = await auditCount();
  await publishSuppression(db, { apply: true, root: newRoot('{not json') });
  assert((await auditCount()) === refusedBefore + 1, 'a refusal is audited too — an unaudited refusal is invisible');
  assert((await auditActions()).pop() === 'suppression.publish_refused', 'the refusal is recorded as a refusal');

  // No audit row may carry a contact value or a credential.
  const rows = await db.select().from(schema.auditEvent);
  const blob = JSON.stringify(rows);
  assert(!/opt-out-\d@example\.invalid/.test(blob), 'no audit event contains a suppressed email address');
  assert(!/synthetic-\d\.invalid/.test(blob), 'no audit event contains a suppressed domain');
  assert(!/postgres:\/\/|password/i.test(blob), 'no audit event contains a credential');
  assert(rows.every(r => typeof (r.metadata as Record<string, unknown>).canonical_hash === 'string'), 'every event records the canonical state hash');
  assert(rows.some(r => typeof (r.metadata as Record<string, unknown>).artifact_sha_before === 'string'), 'events record the artifact hash');
}

// ─────────────────────────────────────────────────────────────────────────────
group('Determinism of the state hash');
{
  const a = synthetic('1');
  const b = synthetic('2');
  assert(suppressionStateHash([a, b], sha256) === suppressionStateHash([b, a], sha256), 'the state hash ignores array order');
  assert(suppressionStateHash([a], sha256) !== suppressionStateHash([b], sha256), 'different state hashes differently');
  assert(
    verifySuppressionArtifact({ canonicalActive: [a], artifactRaw: serializeSuppressionArtifact([a]), hash: sha256 }).status === 'IN_SYNC',
    'the serializer produces something the verifier accepts'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
group('Regression: the dashboard freshness indicator is not vacuous');
{
  // Was: `const published = snap.suppression; suppressionFreshness(snap.suppression, published)` — comparing the
  // canonical list against ITSELF, so the dashboard reported "outreach allowed" no matter what the artifact held.
  const ops = readFileSync(join(OS_ROOT, 'server/services/operations.ts'), 'utf-8');
  assert(!/const published = snap\.suppression/.test(ops), 'the dashboard no longer compares canonical suppression against itself');
  assert(/readSuppressionArtifact\(/.test(ops), 'the dashboard reads the actual artifact the dispatcher consumes');
  assert(/verifySuppressionArtifact\(/.test(ops), 'and classifies it with the real verifier');

  // The behaviour that regression protects: canonical holding an entry the artifact lacks must not read as fresh.
  const canonical = [synthetic('1')];
  const vacuous = verifySuppressionArtifact({ canonicalActive: canonical, artifactRaw: '[]\n', hash: sha256 });
  assert(vacuous.outreachAllowed === false, 'an empty artifact against a non-empty canonical blocks outreach');
  assert(vacuous.status === 'STALE', 'and is reported as STALE rather than fresh', vacuous.status);
}

// ─────────────────────────────────────────────────────────────────────────────
group('Regression: an approved candidate can become a canonical lead (POST_CUTOVER)');
{
  const service = readFileSync(join(OS_ROOT, 'server/research/service.ts'), 'utf-8');
  assert(
    !/throw new ResearchError\(\s*'Canonical import runs only after cutover, when Postgres owns the lead table\. The approval is recorded/.test(service),
    'importApprovedCandidate no longer throws unconditionally'
  );
  assert(/leadFromCandidate\(/.test(service), 'it builds the lead from the candidate');
  assert(/db\.transaction\(/.test(service), 'the lead insert and candidate resolution share one transaction');
  assert(/research\.candidate_imported/.test(service), 'the import is audited');

  const claim = (field: string, value: string, level: 'SUPPORTED' | 'RETRIEVED' | 'CLAIMED' | 'CONTRADICTED' = 'SUPPORTED', sourceUrl: string | null = 'https://source.example/about') => ({
    field, value, statedConfidence: 'HIGH' as const, reportLocation: 'p1',
    evidence: [{
      field, claim: value, sourceUrl, sourceDomain: sourceUrl ? 'source.example' : null, sourceType: 'official_website' as const,
      retrievedAt: '2026-09-16T00:00:00.000Z', retrievedContentSha256: 'abc', supportingExcerpt: 'excerpt',
      level, validator: 'HUMAN' as const, validatedAt: '2026-09-16T00:00:00.000Z', contradictsEvidenceId: null, notes: null,
    }],
  });
  const baseClaims = [
    claim('company_name', 'Synthetic Studio'),
    claim('website_url', 'https://synthetic.invalid'),
    claim('location_country', 'United Kingdom'),
    claim('archetype_id', '1'),
    claim('decision_maker_name', 'A Person'),
  ];
  const candidate = {
    candidateId: 'cand-1', sourceReportId: 'rep-1', extractedAt: '2026-09-16T00:00:00.000Z', status: 'ACCEPTED' as const,
    claims: baseClaims, duplicateMatches: [], suppressionMatches: 0, missingFields: [],
    reviewedBy: 'Reviewer', reviewedAt: '2026-09-16T00:00:00.000Z', reviewNote: null, resolvedLeadId: null,
  };

  const lead = leadFromCandidate({ candidate, targetNumber: '121', leadId: 'lead-uuid-1', approvedBy: 'Reviewer', now: '2026-09-17T00:00:00.000Z' });
  assert(lead.target_number === '121' && lead.company_name === 'Synthetic Studio', 'the lead carries the candidate identity');
  assert(lead.research_state === 'RESEARCH_REQUIRED', 'a promoted lead enters as RESEARCH_REQUIRED, not qualified', lead.research_state);
  assert(lead.kachmo_score === null && lead.lead_priority === null, 'it carries no score or priority it has not earned');
  assert(lead.email_status === 'UNKNOWN', 'an unclaimed email is UNKNOWN, not invented', lead.email_status);
  assert((lead as unknown as Record<string, unknown>).decision_maker_email === null, 'no email is fabricated');
  assert(lead.do_not_contact === false && lead.whatsapp_eligible === 'UNCLEAR', 'WhatsApp eligibility is never inferred');
  assert(lead.research_sources.some(r => r.source_url === 'https://source.example/about'), 'evidence source URLs survive as provenance');
  assert(lead.research_sources.every(r => !!r.field_covered && !!r.source_type), 'each source records which field it covers and what kind of source it is');
  assert(lead.research_sources.find(r => r.field_covered === 'company_name')?.confidence === 'HIGH', 'SUPPORTED evidence becomes HIGH confidence');
  assert(/cand-1/.test(lead.decision_maker_source) && /Reviewer/.test(lead.decision_maker_source), 'the lead records where it came from and who approved it');

  // Provenance can never start at VERIFIED, whatever the report claimed.
  const withEmail = leadFromCandidate({ candidate: { ...candidate, claims: [...baseClaims, claim('decision_maker_email', 'x@synthetic.invalid')] }, targetNumber: '122', leadId: 'l2', approvedBy: 'R', now: '2026-09-17T00:00:00.000Z' });
  assert(withEmail.email_status === 'PUBLICLY_LISTED', 'a supported email with a source URL is PUBLICLY_LISTED', withEmail.email_status);
  assert(withEmail.email_status !== 'VERIFIED', 'promotion can never produce VERIFIED');
  const noSource = leadFromCandidate({ candidate: { ...candidate, claims: [...baseClaims, claim('decision_maker_email', 'x@synthetic.invalid', 'CLAIMED', null)] }, targetNumber: '123', leadId: 'l3', approvedBy: 'R', now: '2026-09-17T00:00:00.000Z' });
  assert(noSource.email_status === 'UNVERIFIED', 'an email with no source URL stays UNVERIFIED', noSource.email_status);
  const contradicted = leadFromCandidate({ candidate: { ...candidate, claims: [...baseClaims, claim('decision_maker_email', 'x@synthetic.invalid', 'CONTRADICTED')] }, targetNumber: '124', leadId: 'l4', approvedBy: 'R', now: '2026-09-17T00:00:00.000Z' });
  assert(contradicted.email_status === 'INVALID', 'contradicted evidence produces INVALID, never a usable contact', contradicted.email_status);

  // A candidate missing a methodology-required field cannot be promoted at all.
  let threw: unknown = null;
  try {
    leadFromCandidate({ candidate: { ...candidate, claims: baseClaims.slice(0, 2) }, targetNumber: '125', leadId: 'l5', approvedBy: 'R', now: '2026-09-17T00:00:00.000Z' });
  } catch (e) { threw = e; }
  assert(threw instanceof PromotionError, 'a candidate missing required fields cannot be promoted');

  // The strongest structural proof: the promoted lead passes the SAME validation and invariants as the 120
  // migrated leads, so it is a real canonical lead rather than something merely shaped like one.
  const v = validateLeadDatabase([lead]);
  assert(v.ok, 'a promoted lead passes the canonical lead validation', v.ok ? null : v.problems.slice(0, 3));
  assert(findInvariantViolations([lead]).length === 0, 'and violates no lead invariant', findInvariantViolations([lead]).slice(0, 3));
  // Every migrated lead has been through `leads:score`, so it also carries the two score-derived fields. A
  // freshly promoted lead has kachmo_score null and has not been scored, so it legitimately lacks them until it
  // is. Every OTHER field a migrated lead carries must be present.
  const SCORE_DERIVED = ['score_basis', 'score_signals'];
  const real = JSON.parse(readFileSync(join(OS_ROOT, '..', 'database/kachmo_leads.json'), 'utf-8')) as Record<string, unknown>[];
  const missingKeys = Object.keys(real[0]).filter(k => !SCORE_DERIVED.includes(k) && !(k in (lead as unknown as Record<string, unknown>)));
  assert(missingKeys.length === 0, 'and carries every field a migrated lead carries, bar the score-derived ones', missingKeys);
  assert(lead.kachmo_score === null, 'consistent with it not having been scored yet');
  assert(SCORE_DERIVED.every(k => !(k in (lead as unknown as Record<string, unknown>))), 'and it claims no scoring basis it has not earned');

  assert(nextTargetNumber(['001', '120']) === '121', 'the next target number follows the existing sequence');
  assert(nextTargetNumber(['001', '120']).length === 3, 'and keeps the existing zero padding');
}

await close();
for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
console.log(`\n${'='.repeat(60)}\nSUPPRESSION SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
