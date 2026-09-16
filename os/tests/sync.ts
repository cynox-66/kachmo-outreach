/**
 * PHASE 1.5D — TITAN BOUNDARY TESTS.
 *
 * The bridge is a contract, not a running integration. These tests prove it is inert (no network, refuses by
 * default), that every failure path fails closed, and that nothing in the app can send while a suppression is
 * unpublished.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SuppressionEntry } from '../../core/leads/schema.js';
import { planPublish, titanOutreachGate, unconfiguredTransport, TitanBridgeNotConfiguredError, type SuppressionTransport } from '../server/sync/titan-bridge';

const OS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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

const entry = (over: Partial<SuppressionEntry>): SuppressionEntry => ({ reason: 'r', suppressed_at: '2026-09-15T00:00:00.000Z', source: 'test', ...over });
const A = entry({ target_number: '001', email: 'a@x.example' });
const B = entry({ target_number: '002', email: 'b@x.example' });

/** A fake transport. It records what it was asked to do; it never leaves the process. */
function fakeTransport(entries: SuppressionEntry[], sha: string, opts: { readThrows?: Error; writeResult?: Awaited<ReturnType<SuppressionTransport['write']>> } = {}) {
  const calls: Array<{ op: 'read' | 'write'; expectedSha?: string; count?: number }> = [];
  const transport: SuppressionTransport = {
    read: async () => {
      calls.push({ op: 'read' });
      if (opts.readThrows) throw opts.readThrows;
      return { entries, sha };
    },
    write: async (next, expectedSha) => {
      calls.push({ op: 'write', expectedSha, count: next.length });
      return opts.writeResult ?? { ok: true, sha: 'new-sha' };
    },
  };
  return { transport, calls };
}

console.log('\n🔗 TITAN BOUNDARY (Phase 1.5D)');

group('1. The bridge is inert until deliberately configured');
{
  const attempt = await planPublish([A], unconfiguredTransport);
  assert(attempt.state === 'PUBLISH_FAILED', 'an unconfigured bridge reports failure, not success');
  assert(attempt.outreachAllowed === false, 'and blocks outreach');
  assert(attempt.reason.includes('not configured'), 'and says the bridge is not configured');
  assert(attempt.auditAction === 'suppression.publish_failed', 'and records an audit action');
  const err = await unconfiguredTransport.read().catch(e => e);
  assert(err instanceof TitanBridgeNotConfiguredError, 'the default transport refuses rather than returning empty data');
  const err2 = await unconfiguredTransport.write([], 'sha').catch(e => e);
  assert(err2 instanceof TitanBridgeNotConfiguredError, 'and refuses writes too');
}

group('2. Planning never writes');
{
  const { transport, calls } = fakeTransport([A], 'sha-1');
  const attempt = await planPublish([A, B], transport);
  assert(calls.every(c => c.op === 'read'), 'planning a publish performs no write', calls);
  assert(attempt.plan.toAppend.length === 1, 'the plan says exactly what would be appended');
  assert(attempt.plan.nextContents.length === 2 && attempt.plan.nextContents[0] === A, 'and keeps what is already published');
  assert(attempt.state === 'NOT_PUBLISHED', 'until the write lands, the state is NOT_PUBLISHED');
  assert(attempt.outreachAllowed === false, 'and outreach stays blocked');
  assert(attempt.plan.expectedBaseSha === 'sha-1', 'the plan carries the SHA the write must be conditional on');
}

group('3. Every failure path fails closed');
{
  const unreadable = await planPublish([A], fakeTransport([], 'sha', { readThrows: new Error('network unreachable') }).transport);
  assert(unreadable.state === 'PUBLISH_FAILED' && !unreadable.outreachAllowed, 'a transport that cannot read blocks outreach');
  assert(!unreadable.reason.includes('undefined'), 'and reports a usable reason');

  const upToDate = await planPublish([A], fakeTransport([A], 'sha-1').transport);
  assert(upToDate.state === 'PUBLISHED_VERIFIED' && upToDate.outreachAllowed, 'an already-current file is the only state that permits outreach');
  assert(upToDate.auditAction === 'suppression.publish_verified', 'and it is audited as verified');

  // The remote holding MORE than canonical is safe (over-suppression), and must not be "corrected" downward.
  const extraRemote = await planPublish([A], fakeTransport([A, B], 'sha-1').transport);
  assert(extraRemote.outreachAllowed === true, 'a remote that suppresses more than canonical still permits outreach');
  assert(extraRemote.plan.nextContents.length >= 2, 'and the extra entry is never removed');
}

group('4. The outreach gate is recomputed, never cached');
{
  assert(titanOutreachGate([A, B], [A]).allowed === false, 'an unpublished suppression blocks outreach');
  assert(titanOutreachGate([A], [A]).allowed === true, 'a fully published list permits it');
  assert(titanOutreachGate([], []).allowed === true, 'an empty list is trivially safe');
  assert(titanOutreachGate([A, B], [A]).reason.includes('opted out'), 'the refusal states the real-world consequence');
  // Look for caching CONSTRUCTS, not the word in prose.
  const src = readFileSync(join(OS, 'server/sync/titan-bridge.ts'), 'utf-8');
  assert(!/unstable_cache|\bcache\(|\bmemoi?ze|revalidate\s*[:=]|new Map\(|let\s+\w*[Cc]ached/.test(src), 'the gate memoises nothing: no cache call, no module-level store, no revalidate window');
}

group('5. Nothing in the app can reach the network or send mail');
{
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(f => {
      const p = join(dir, f);
      if (f === 'node_modules' || f === '.next') return [];
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
    });
  const appSrc = [...walk(join(OS, 'server')), ...walk(join(OS, 'app'))];
  const read = (f: string) => readFileSync(f, 'utf-8');
  const offenders = (re: RegExp) => appSrc.filter(f => re.test(read(f))).map(f => relative(OS, f));

  assert(offenders(/from ['"]nodemailer['"]|from ['"]imapflow['"]/).length === 0, 'no mail library is imported anywhere in the app', offenders(/nodemailer|imapflow/));
  assert(offenders(/send-titan-smtp|create-titan-drafts|cron-dispatch/).length === 0, 'no legacy send script is imported into the app', offenders(/send-titan-smtp|cron-dispatch/));
  const bridge = read(join(OS, 'server/sync/titan-bridge.ts'));
  assert(!/fetch\(|https?:\/\/|octokit|@actions/i.test(bridge), 'the bridge module makes no network call and names no endpoint');
  assert(/one way|ONE-WAY/i.test(bridge) && /Additive only/i.test(bridge), 'the bridge states its one-way, additive invariants in the module itself');
  assert(!/process\.env|TOKEN|SECRET|API_KEY/i.test(bridge), 'the bridge holds no credentials, so it can be reviewed and tested as pure logic');
  assert(/SuppressionTransport/.test(bridge), 'credentials and I/O are pushed into an injected transport that does not exist yet');
}

console.log(`\n${'='.repeat(60)}\nSYNC SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
