/**
 * PHASE B — EVIDENCE, OPERATOR COMMANDS AND CANDIDATE HARDENING.
 *
 * In-memory PostgreSQL (PGlite) with every migration, loaded with the pinned golden dataset. The fetcher runs
 * against a FAKE transport throughout: this suite never opens a socket or resolves a name.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq, sql } from 'drizzle-orm';
import type { KachmoLead } from '@kachmo/core/leads/schema.js';
import { parseTrackerContent } from '@kachmo/core/email-ledger/tracker.js';
import * as schema from '../server/db/schema/index';
import { createRehearsalDatabase } from '../server/db/rehearsal-db';
import { loadCanonicalSource } from '../server/db/migration/source';
import { importCanonicalSource } from '../server/db/migration/import';
import { permissionsFor, ROLES } from '../server/authz/permissions';
import type { Actor } from '../server/authz/authorize';
import { addressRefusal, urlRefusal, fetchSource, robotsAllows, htmlToText, containsVerbatim, type FetchTransport, type RawResponse } from '../server/evidence/fetch';
import { planFetch, runFetch, MAX_ATTEMPTS } from '../server/evidence/fetch-run';
import { evidenceForLead } from '../server/evidence/store';
import { reviewEvidence } from '../server/evidence/review';
import { logCall, transitionWhatsApp, transitionPipeline, recordResearch, recordSuppression } from '../server/leads/commands';
import { createSuppression } from '../server/leads/suppression';
import { goldenWorkspace } from '../../scripts/__tests__/golden/snapshot.js';

const OS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(OS, '..');

let passed = 0;
const failures: string[] = [];
function assert(cond: unknown, name: string, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ❌ ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1500)}` : ''}`);
  }
}
const group = (t: string) => console.log(`\n${t}`);

console.log('\n🔎 KACHMO OUTBOUND OS — PHASE B EVIDENCE & OPERATOR COMMANDS');

// The suites write to in-memory Postgres; the declared target is a loopback database, which the write guard allows.
const POST = { KACHMO_CUTOVER_PHASE: 'POST_CUTOVER', KACHMO_APP_WRITES: 'on', DATABASE_URL: 'postgres://localhost:5432/kachmo_test' };
Object.assign(process.env, POST);

// ── A fake internet ──────────────────────────────────────────────────────────
type Page = { status?: number; type?: string; body?: string; location?: string; truncated?: boolean; throws?: Error };
function fakeInternet(dns: Record<string, string[]>, pages: Record<string, Page>) {
  const calls: Array<{ url: string; address: string }> = [];
  const transport: FetchTransport = {
    async resolve(host) {
      const a = dns[host];
      if (!a) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
      return a;
    },
    async get(url, address) {
      calls.push({ url: url.toString(), address });
      const p = pages[url.toString()] ?? (url.pathname === '/robots.txt' ? { status: 404 } : { status: 404 });
      if (p.throws) throw p.throws;
      const r: RawResponse = { status: p.status ?? 200, headers: { 'content-type': p.type ?? 'text/html; charset=utf-8', ...(p.location ? { location: p.location } : {}) }, body: Buffer.from(p.body ?? ''), truncated: !!p.truncated };
      return r;
    },
  };
  return { transport, calls };
}

// ─────────────────────────────────────────────────────────────────────────────
group('1. The fetcher only ever reaches public, named hosts (SSRF)');
{
  for (const a of ['127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::1']) {
    assert(addressRefusal(a) !== null, `address ${a} is refused`);
  }
  for (const a of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) assert(addressRefusal(a) === null, `public address ${a} is allowed`);
  const refusedUrls = [
    'http://127.0.0.1/',
    'http://2130706433/',
    'http://0177.0.0.1/',
    'http://0x7f000001/',
    'http://[::1]/',
    'http://localhost/',
    'http://printer.local/',
    'http://intranet/',
    'https://user:pw@example.com/',
    'https://example.com:8443/',
    'file:///etc/passwd',
    'ftp://example.com/x',
    'javascript:alert(1)',
    'not a url',
  ];
  for (const u of refusedUrls) assert(urlRefusal(u) !== null, `URL ${u} is refused before any lookup`);
  assert(urlRefusal('https://www.example.com/about?x=1') === null && urlRefusal('http://example.com:80/') === null, 'an ordinary public URL is allowed');
}

// ─────────────────────────────────────────────────────────────────────────────
group('2. A fetch is pinned, bounded, and honest about what happened');
{
  const PUBLIC = ['93.184.216.34'];
  const net = fakeInternet(
    { 'studio.example': PUBLIC, 'evil.example': ['10.0.0.5'], 'mixed.example': ['93.184.216.34', '127.0.0.1'], 'loop.example': PUBLIC, 'robots5.example': PUBLIC, 'blocked.example': PUBLIC },
    {
      'https://studio.example/about': { body: '<html><head><script>steal()</script><style>p{}</style></head><body><h1>About</h1><p>Founded by Jane&nbsp;Roe in 2016.</p><p>Clients: Acme &amp; Co.</p></body></html>' },
      'https://studio.example/old': { status: 301, location: 'https://evil.example/admin' },
      'https://studio.example/team': { status: 302, location: '/people' },
      'https://studio.example/people': { body: '<p>Jane Roe, Founder</p>' },
      'https://studio.example/gone': { status: 404 },
      'https://studio.example/down': { status: 503 },
      'https://studio.example/huge': { truncated: true, body: 'x' },
      'https://studio.example/deck.pdf': { type: 'application/pdf', body: '%PDF' },
      'https://studio.example/tls': { throws: Object.assign(new Error('unable to verify the first certificate'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }) },
      'https://loop.example/1': { status: 302, location: '/2' },
      'https://loop.example/2': { status: 302, location: '/3' },
      'https://loop.example/3': { status: 302, location: '/4' },
      'https://loop.example/4': { status: 302, location: '/5' },
      'https://robots5.example/robots.txt': { status: 500 },
      'https://robots5.example/page': { body: 'hello' },
      'https://blocked.example/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /private\n' },
      'https://blocked.example/private/x': { body: 'secret' },
      'https://blocked.example/public': { body: '<p>fine to read</p>' },
    }
  );
  const t = { transport: net.transport };

  const ok = await fetchSource('https://studio.example/about#team', t);
  assert(ok.outcome === 'OK' && ok.httpStatus === 200, 'an ordinary page is retrieved', ok);
  assert(ok.textContent === 'About\nFounded by Jane Roe in 2016.\nClients: Acme & Co.', 'HTML becomes plain text; scripts and styles are dropped, never run', ok.textContent);
  assert(/^[0-9a-f]{64}$/.test(ok.contentSha256 ?? '') && ok.byteSize! > 0, 'the exact bytes are hashed, so a later re-fetch can prove the page changed');
  assert(net.calls.filter(c => c.url.startsWith('https://studio.example/')).every(c => c.address === '93.184.216.34'), 'every request connects to the address that was checked (pinned), never a fresh lookup');
  assert(!net.calls.some(c => c.url.includes('#')), 'the fragment is never sent');

  assert((await fetchSource('https://evil.example/', t)).outcome === 'BLOCKED_PRIVATE_ADDRESS', 'a name that resolves to a private address is refused');
  assert((await fetchSource('https://mixed.example/', t)).outcome === 'BLOCKED_PRIVATE_ADDRESS', 'a name with ANY private address among its answers is refused (rebinding defence)');
  const redirectedIn = await fetchSource('https://studio.example/old', t);
  assert(redirectedIn.outcome === 'BLOCKED_PRIVATE_ADDRESS' && !net.calls.some(c => c.url.startsWith('https://evil.example/admin')), 'a redirect into a private network is re-validated and refused before any request', redirectedIn);
  const relative = await fetchSource('https://studio.example/team', t);
  assert(relative.outcome === 'OK' && relative.finalUrl === 'https://studio.example/people' && relative.redirectChain.length === 1, 'a relative redirect is followed and recorded');
  assert((await fetchSource('https://loop.example/1', t)).outcome === 'TOO_MANY_REDIRECTS', 'more than three redirects is refused');
  assert((await fetchSource('https://studio.example/gone', t)).outcome === 'HTTP_4XX', 'a 404 is HTTP_4XX — the page is missing, which is NOT a contradiction');
  assert((await fetchSource('https://studio.example/down', t)).outcome === 'HTTP_5XX', 'a 503 is HTTP_5XX');
  assert((await fetchSource('https://studio.example/huge', t)).outcome === 'TOO_LARGE', 'a page over the size cap is refused, not half-read');
  assert((await fetchSource('https://studio.example/deck.pdf', t)).outcome === 'UNSUPPORTED_TYPE', 'a non-text document is not read');
  assert((await fetchSource('https://studio.example/tls', t)).outcome === 'TLS_ERROR', 'a certificate failure is a TLS error — verification is never switched off');
  assert((await fetchSource('https://nowhere.example/', t)).outcome === 'DNS_FAILED', 'an unresolvable name is DNS_FAILED');
  assert((await fetchSource('https://robots5.example/page', t)).outcome === 'ROBOTS_DISALLOWED', 'a robots.txt that errors is treated as "disallow everything"');
  assert((await fetchSource('https://blocked.example/private/x', t)).outcome === 'ROBOTS_DISALLOWED', 'robots.txt Disallow is honoured');
  assert((await fetchSource('https://blocked.example/public', t)).outcome === 'OK', 'and what it allows is fetched');
  assert((await fetchSource('http://127.0.0.1/', t)).outcome === 'BLOCKED_PRIVATE_ADDRESS', 'an IP-literal URL never reaches the transport');
}

// ─────────────────────────────────────────────────────────────────────────────
group('3. robots.txt and text rules');
{
  const r = 'User-agent: *\nDisallow: /admin\nAllow: /admin/public\n\nUser-agent: GoogleBot\nDisallow: /';
  assert(!robotsAllows(r, '/admin/x') && robotsAllows(r, '/admin/public/y') && robotsAllows(r, '/about'), 'longest match wins; Allow wins a tie');
  assert(!robotsAllows('User-agent: kachmooutboundos\nDisallow: /\n\nUser-agent: *\nAllow: /', '/x'), 'a group naming this fetcher takes precedence over *');
  assert(!robotsAllows('User-agent: *\nDisallow: /*.pdf$', '/deck.pdf') && robotsAllows('User-agent: *\nDisallow: /*.pdf$', '/deck.pdf.html'), '* and $ wildcards work');
  assert(robotsAllows('', '/x') && robotsAllows('Sitemap: https://x', '/x'), 'no rules → allowed');
  assert(htmlToText('<p>a</p><p>a</p>') === htmlToText('<p>a</p><p>a</p>'), 'text extraction is deterministic');
  assert(containsVerbatim('Founded by Jane  Roe\nin 2016.', 'Jane Roe in 2016') && !containsVerbatim('Founded by Jane Roe', 'Founded by John'), 'an excerpt must appear in the page (whitespace aside)');
  assert(!containsVerbatim('Founded by Jane Roe', 'Jane'), 'and must be long enough to mean something (8+ characters)');
}

// ── Golden database ──────────────────────────────────────────────────────────
const workspace = goldenWorkspace(REPO);
const database = await createRehearsalDatabase();
(globalThis as unknown as { __kachmoServer?: unknown }).__kachmoServer = { db: database.db, auth: {} };
const db = database.db;
await importCanonicalSource(db, loadCanonicalSource(workspace), 'TEST');
const tracker = parseTrackerContent(readFileSync(join(workspace, 'OUTREACH_TRACKER.md'), 'utf-8'));
const ledger = (tn: string) => tracker.get(tn)?.status ?? null;
const opts = { env: POST, ledger };

const actorWith = (roles: string[], name: string, userId: string): Actor => ({ userId, name, email: `${userId}@kachmo.test`, roles: roles as Actor['roles'], permissions: permissionsFor(roles) });
await db.insert(schema.user).values([
  { id: 'u-owner', name: 'Dev Jaiswal', email: 'u-owner@kachmo.test' },
  { id: 'u-aadi', name: 'Aadi', email: 'u-aadi@kachmo.test' },
  ...ROLES.map(r => ({ id: `u-role-${r.toLowerCase()}`, name: `Test ${r}`, email: `u-role-${r.toLowerCase()}@kachmo.test` })),
]);
await db.insert(schema.userRole).values([{ userId: 'u-owner', role: 'OWNER' }, { userId: 'u-aadi', role: 'OUTREACH' }, ...ROLES.map(r => ({ userId: `u-role-${r.toLowerCase()}`, role: r }))]);
const owner = actorWith(['OWNER'], 'Dev Jaiswal', 'u-owner');
const researcher = actorWith(['RESEARCHER'], 'Test RESEARCHER', 'u-role-researcher');
const intern = actorWith(['INTERN'], 'Test INTERN', 'u-role-intern');
const { bindEngineActor } = await import('../server/leads/actor-binding');
await bindEngineActor(db, { userEmail: 'u-owner@kachmo.test', engineActor: 'DEV', ownerLabel: 'Dev Jaiswal' });
await bindEngineActor(db, { userEmail: 'u-aadi@kachmo.test', engineActor: 'AADI', ownerLabel: 'Dev Jaiswal' });
for (const r of ROLES) await bindEngineActor(db, { userEmail: `u-role-${r.toLowerCase()}@kachmo.test`, engineActor: 'DEV', ownerLabel: 'Dev Jaiswal' });
const leadByTn = async (tn: string) => (await db.select().from(schema.lead).where(eq(schema.lead.targetNumber, tn)))[0];

// ─────────────────────────────────────────────────────────────────────────────
group('4. A source a person cites becomes evidence — and none is invented for legacy leads');
{
  // The 120 migrated leads carry no URL source at all (every legacy source is prose such as "kachmo_targets.csv
  // (legacy research, no source URL)"), so there is nothing to backfill: evidence starts with what people cite.
  const legacy = (await db.select({ record: schema.lead.record }).from(schema.lead)).map(r => r.record as KachmoLead);
  const isUrl = (s: unknown) => typeof s === 'string' && /^https?:\/\/[^\s/]+\.[^\s]+/i.test(s.trim());
  assert(legacy.every(l => ![l.decision_maker_source, l.commercial_signal_source, l.website_friction_source, l.email_source, l.phone_source].some(isUrl) && !(l.research_sources ?? []).some(x => isUrl(x.source_url))), 'no legacy lead carries a URL source — nothing is fabricated to fill the gap');
  assert((await db.select().from(schema.leadEvidence)).length === 0, 'so no evidence exists until someone cites a source');

  const cite = async (tn: string, field: string, value: string, source: string) => {
    const l = await leadByTn(tn);
    return recordResearch(db, owner, { leadId: l.leadId, expectedVersion: l.version, field, value, source, sourceType: 'official_website' }, opts);
  };
  const a = await cite('111', 'commercial-source', 'Works with three national retailers', 'https://studio-111.example/clients');
  const b = await cite('112', 'friction-source', 'Booking flow is a PDF form emailed back', 'https://studio-112.example/book');
  const c = await cite('113', 'commercial-source', 'Featured in a national design annual', 'https://studio-111.example/clients');
  assert(a.ok && b.ok && c.ok, 'three researched claims are recorded with their sources', [a, b, c]);
  const rows = await db.select().from(schema.leadEvidence).orderBy(asc(schema.leadEvidence.recordedAt));
  assert(rows.length === 3 && rows.every(r => r.origin === 'HUMAN_RECORD' && r.validator === 'SYNTAX_CHECK' && r.reviewStatus === 'UNREVIEWED'), 'each becomes an unreviewed, URL-shaped evidence row');

}

// ─────────────────────────────────────────────────────────────────────────────
group('5. Fetch runs: retrieve, link, retry, give up — never review');
{
  const urls = (await db.select({ url: schema.leadEvidence.sourceUrl }).from(schema.leadEvidence)).map(r => r.url!);
  const unique = [...new Set(urls)];
  const [okUrl, missingUrl] = unique;
  const hosts: Record<string, string[]> = {};
  for (const u of unique) hosts[new URL(u).hostname] = ['93.184.216.34'];
  const net = fakeInternet(hosts, { [okUrl]: { body: '<p>Studio principal Jane Roe leads a team of 12 designers.</p>' } });
  const fetchOptions = { transport: net.transport };
  const plan = await planFetch(db, { limit: 2 });
  assert(plan.toFetch.length === 2 && plan.toFetch[0].url === okUrl && plan.toFetch[1].url === missingUrl, 'a run fetches at most --limit URLs, one per URL however many claims cite it');

  const noSleep: number[] = [];
  const run1 = await runFetch(db, { actor: 'Dev Jaiswal', limit: 2, fetchOptions, sleep: async ms => void noSleep.push(ms) });
  assert(run1.byOutcome.OK === 1 && run1.byOutcome.HTTP_4XX === 1, 'one page retrieved, one missing', run1.byOutcome);
  const retrievals = await db.select().from(schema.evidenceRetrieval);
  assert(retrievals.length === 2 && retrievals.every(r => r.fetchedByLabel === 'Dev Jaiswal' && r.runId === run1.runId), 'every attempt is recorded, attributed to the person who ran it');
  const linked = await db.select().from(schema.leadEvidence).where(eq(schema.leadEvidence.sourceUrl, okUrl));
  assert(linked.every(e => e.retrievalId && e.validator === 'FETCHER' && e.reviewStatus === 'UNREVIEWED'), 'the retrieved page is linked to every claim citing it — still unreviewed');
  const [someLead] = linked;
  const view = await evidenceForLead(db, someLead.leadId);
  const v = view.find(x => x.id === someLead.id)!;
  assert(v.level === 'RETRIEVED', 'its derived level is RETRIEVED — never SUPPORTED without a person', v.level);
  const missing = view.find(x => x.sourceUrl === missingUrl) ?? (await evidenceForLead(db, (await db.select().from(schema.leadEvidence).where(eq(schema.leadEvidence.sourceUrl, missingUrl)))[0].leadId)).find(x => x.sourceUrl === missingUrl)!;
  assert(missing.level === 'URL_SHAPED' && missing.failedAttempts === 1, 'a failed fetch leaves the claim URL_SHAPED, with the attempt visible');

  const audit = await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'evidence.fetch_run'));
  assert(audit.length === 1 && !JSON.stringify(audit[0].metadata).includes(new URL(okUrl).pathname.length > 1 ? new URL(okUrl).pathname : '§'), 'the run is audited once, with hosts but not paths');

  const cool = await planFetch(db, { limit: 50 });
  assert(cool.candidates.find(c => c.url === missingUrl)?.skip === 'COOLDOWN', 'the failed URL cools down instead of being hammered');
  // Two more failures, an hour and a day apart, and it is left for a human.
  const past = (h: number) => new Date(Date.now() - h * 3600_000);
  for (const h of [30, 2]) {
    await db.insert(schema.evidenceRetrieval).values({ runId: 'old', requestedUrl: missingUrl, outcome: 'HTTP_4XX', httpStatus: 404, userAgent: 'x', fetchedByLabel: 'Dev Jaiswal', fetchedAt: past(h) });
  }
  const give = await planFetch(db, { limit: 50 });
  assert(give.candidates.find(c => c.url === missingUrl)?.skip === 'NEEDS_HUMAN' && MAX_ATTEMPTS === 3, 'after three failures a URL is never retried automatically (NEEDS_HUMAN)');

  // A second claim citing an already-retrieved URL is linked without a second request.
  const [target] = await db.select().from(schema.lead).where(eq(schema.lead.targetNumber, '050'));
  await db.insert(schema.leadEvidence).values({ leadId: target.leadId, field: 'observable_friction', sourceUrl: okUrl, sourceType: 'other', origin: 'HUMAN_RECORD', validator: 'SYNTAX_CHECK', recordedByLabel: 'Dev Jaiswal' });
  const before = net.calls.length;
  await runFetch(db, { actor: 'Dev Jaiswal', limit: 1, fetchOptions: { transport: fakeInternet(hosts, {}).transport }, sleep: async () => {} });
  const reused = (await db.select().from(schema.leadEvidence).where(eq(schema.leadEvidence.leadId, target.leadId))).find(e => e.sourceUrl === okUrl)!;
  assert(!!reused.retrievalId && net.calls.length === before, 'a URL already retrieved is linked, not fetched again');

  let bot = '';
  try {
    await runFetch(db, { actor: 'claude', fetchOptions, sleep: async () => {} });
  } catch (e) {
    bot = (e as Error).message;
  }
  assert(/not a named person/.test(bot), 'a fetch run must be started by a named person');
  const tryDb = async (q: ReturnType<typeof sql>) => {
    try {
      await db.execute(q);
      return 'allowed';
    } catch (e) {
      return `${(e as Error).message} ${(e as { cause?: Error }).cause?.message ?? ''}`;
    }
  };
  assert(/append-only/.test(await tryDb(sql`update evidence_retrieval set outcome = 'OK'`)), 'retrievals can never be rewritten');
  assert(/append-only/.test(await tryDb(sql`delete from evidence_retrieval`)), 'nor deleted');
}

// ─────────────────────────────────────────────────────────────────────────────
group('6. Only a person, quoting the page, makes a claim SUPPORTED or CONTRADICTED');
{
  const [row] = await db.select().from(schema.leadEvidence).where(sql`${schema.leadEvidence.retrievalId} is not null and ${schema.leadEvidence.reviewStatus} = 'UNREVIEWED'`).limit(1);
  const [leadBefore] = await db.select().from(schema.lead).where(eq(schema.lead.leadId, row.leadId));
  const [unfetched] = await db.select().from(schema.leadEvidence).where(sql`${schema.leadEvidence.retrievalId} is null`).limit(1);

  assert(!(await reviewEvidence(db, intern, { evidenceId: row.id, verdict: 'SUPPORTS', excerpt: 'Jane Roe leads a team' })).ok, 'an intern cannot review evidence');
  const viewer = actorWith(['VIEWER'], 'V', 'u-role-viewer');
  assert(!(await reviewEvidence(db, viewer, { evidenceId: row.id, verdict: 'SUPPORTS', excerpt: 'Jane Roe leads a team' })).ok, 'nor can a viewer');
  const off = await reviewEvidence(db, researcher, { evidenceId: row.id, verdict: 'SUPPORTS', excerpt: 'Jane Roe leads a team' }, { KACHMO_CUTOVER_PHASE: 'POST_CUTOVER' });
  assert(!off.ok && /KACHMO_APP_WRITES/.test(off.error), 'with writes switched off, nothing is recorded');
  const notFetched = await reviewEvidence(db, researcher, { evidenceId: unfetched.id, verdict: 'SUPPORTS', excerpt: 'anything at all here' });
  assert(!notFetched.ok && /not been retrieved/.test(notFetched.error), 'a source nobody retrieved cannot be quoted');
  const invented = await reviewEvidence(db, researcher, { evidenceId: row.id, verdict: 'SUPPORTS', excerpt: 'Jane Roe is the CEO of a Fortune 500 company' });
  assert(!invented.ok && /does not appear/.test(invented.error), 'an excerpt that is not in the page is refused — a reviewer quotes, never composes');
  const noNote = await reviewEvidence(db, researcher, { evidenceId: row.id, verdict: 'NOT_SUPPORTED' });
  assert(!noNote.ok, '"not supported" needs a reason');

  const ok = await reviewEvidence(db, researcher, { evidenceId: row.id, verdict: 'SUPPORTS', excerpt: 'Studio principal Jane Roe   leads a team of 12 designers.' });
  assert(ok.ok, 'a verbatim quote from the retrieved page is accepted', ok);
  const v = (await evidenceForLead(db, row.leadId)).find(x => x.id === row.id)!;
  assert(v.level === 'SUPPORTED' && v.reviewedBy === 'Test RESEARCHER' && v.supportingExcerpt === 'Studio principal Jane Roe leads a team of 12 designers.', 'the claim is now SUPPORTED, attributed to its reviewer, with the quote', v);
  const [leadAfter] = await db.select().from(schema.lead).where(eq(schema.lead.leadId, row.leadId));
  assert(leadAfter.version === leadBefore.version && leadAfter.recordSha256 === leadBefore.recordSha256, 'the lead did not change: evidence never writes a lead or a gate');
  const twice = await reviewEvidence(db, owner, { evidenceId: row.id, verdict: 'NOT_SUPPORTED', note: 'changed my mind' });
  assert(!twice.ok && /Already reviewed/.test(twice.error), 'a reviewed claim is final');
  let guard = '';
  try {
    await db.update(schema.leadEvidence).set({ reviewNote: 'edited' }).where(eq(schema.leadEvidence.id, row.id));
  } catch (e) {
    guard = `${(e as Error).message} ${(e as { cause?: Error }).cause?.message ?? ''}`;
  }
  assert(/final/.test(guard), 'and the database refuses to edit it');

  // Contradiction: a second retrieved claim on the same page.
  const [okRetrieval] = await db.select().from(schema.evidenceRetrieval).where(eq(schema.evidenceRetrieval.outcome, 'OK')).limit(1);
  const [lead2] = await db.select().from(schema.lead).where(eq(schema.lead.targetNumber, '077'));
  const [c] = await db.insert(schema.leadEvidence).values({ leadId: lead2.leadId, field: 'commercial_validation_signal', claimValue: 'team of 200 designers', sourceUrl: okRetrieval.requestedUrl, sourceType: 'other', origin: 'EXTERNAL_RESEARCH', validator: 'FETCHER', retrievalId: okRetrieval.id, recordedByLabel: 'Dev Jaiswal' }).returning();
  const con = await reviewEvidence(db, owner, { evidenceId: c.id, verdict: 'CONTRADICTS', excerpt: 'leads a team of 12 designers', note: 'the page says 12, not 200' });
  assert(con.ok, 'a contradiction is recorded with the quote that contradicts', con);
  const views = await evidenceForLead(db, lead2.leadId);
  const original = views.find(x => x.id === c.id)!;
  const contradiction = views.find(x => x.contradictsEvidenceId === c.id)!;
  assert(!!contradiction && contradiction.level === 'CONTRADICTED' && original.contradictedBy.includes(contradiction.id), 'as a NEW human row pointing at the claim, derived CONTRADICTED', { original, contradiction });
  assert(original.reviewStatus === 'REJECTED' && original.level === 'RETRIEVED', 'and the original is closed as not supported');

  const notSup = await db.insert(schema.leadEvidence).values({ leadId: lead2.leadId, field: 'observable_friction', claimValue: 'slow site', sourceUrl: okRetrieval.requestedUrl, sourceType: 'other', origin: 'EXTERNAL_RESEARCH', validator: 'FETCHER', retrievalId: okRetrieval.id, recordedByLabel: 'Dev Jaiswal' }).returning();
  assert((await reviewEvidence(db, owner, { evidenceId: notSup[0].id, verdict: 'NOT_SUPPORTED', note: 'the page says nothing about speed' })).ok, 'a page that simply does not say it is recorded as not supported');
  assert((await evidenceForLead(db, lead2.leadId)).find(x => x.id === notSup[0].id)!.level === 'RETRIEVED', 'which leaves the claim RETRIEVED, with the reason');

  const reviewAudits = await db.select().from(schema.auditEvent).where(sql`${schema.auditEvent.action} in ('evidence.reviewed', 'evidence.contradiction_recorded')`);
  assert(reviewAudits.length === 3 && !JSON.stringify(reviewAudits.map(a => a.metadata)).includes('designers'), 'every review is audited — without the quoted text, which may carry contact details');
}

// ─────────────────────────────────────────────────────────────────────────────
group('7. Operator commands: permission, binding, validation — then core');
{
  const matrix: Array<[string, (a: Actor) => Promise<{ ok: boolean }>, string[]]> = [];
  const l111 = await leadByTn('111');
  const v = () => l111.version;
  matrix.push(['log a call', a => logCall(db, a, { leadId: l111.leadId, expectedVersion: v(), outcome: 'NO_ANSWER' }, opts), ['OWNER', 'ADMIN', 'OUTREACH']]);
  matrix.push(['transition WhatsApp', a => transitionWhatsApp(db, a, { leadId: l111.leadId, expectedVersion: v(), status: 'APPROVED' }, opts), ['OWNER', 'ADMIN', 'OUTREACH']]);
  matrix.push(['move the pipeline', a => transitionPipeline(db, a, { leadId: l111.leadId, expectedVersion: v(), stage: 'MEETING_BOOKED', channel: 'CALL' }, opts), ['OWNER', 'ADMIN', 'OUTREACH']]);
  matrix.push(['record research', a => recordResearch(db, a, { leadId: l111.leadId, expectedVersion: v(), field: 'tech', value: 'Webflow' }, opts), ['OWNER', 'ADMIN', 'RESEARCHER']]);
  matrix.push(['record a suppression', a => recordSuppression(db, a, { domain: 'rbac-probe.example', reason: 'probe' }, opts), ['OWNER', 'ADMIN', 'OUTREACH']]);
  for (const [name, run, allowed] of matrix) {
    for (const role of ROLES) {
      const a = actorWith([role], `Test ${role}`, `u-role-${role.toLowerCase()}`);
      const r = await run(a);
      const permitted = !('error' in r) || !/Not permitted/.test((r as { error: string }).error);
      assert(permitted === allowed.includes(role), `${role} ${allowed.includes(role) ? 'may' : 'may not'} ${name}`, r);
    }
  }

  const unbound = actorWith(['OWNER'], 'Unbound Owner', 'u-unbound');
  await db.insert(schema.user).values({ id: 'u-unbound', name: 'Unbound Owner', email: 'u-unbound@kachmo.test' });
  const nb = await logCall(db, unbound, { leadId: l111.leadId, expectedVersion: l111.version, outcome: 'NO_ANSWER' }, opts);
  assert(!nb.ok && /not bound/.test((nb as { error: string }).error), 'even an owner cannot write a lead without an engine-actor binding');

  const fresh = await leadByTn('111');
  const fu = await transitionPipeline(db, owner, { leadId: fresh.leadId, expectedVersion: fresh.version, stage: 'FOLLOW_UP_SENT' }, opts);
  assert(!fu.ok && /Titan/.test((fu as { error: string }).error), 'an email follow-up is refused in operator language: Titan records it');
  const badOutcome = await logCall(db, owner, { leadId: fresh.leadId, expectedVersion: fresh.version, outcome: 'SENT_A_FAX' }, opts);
  assert(!badOutcome.ok, 'an unknown call outcome is refused at the boundary');
  const noVersion = await logCall(db, owner, { leadId: fresh.leadId, expectedVersion: null, outcome: 'NO_ANSWER' }, opts);
  assert(!noVersion.ok && /version/.test((noVersion as { error: string }).error), 'the app never writes blind: the version the operator saw is required');
  const researcherFit = await recordResearch(db, researcher, { leadId: fresh.leadId, expectedVersion: fresh.version, field: 'fit', value: 'CONFIRMED', basis: 'strong fit' }, opts);
  assert(!researcherFit.ok && /lead\.approve/.test((researcherFit as { error: string }).error), 'Kachmo fit (gate 8) is a judgement only an approver may record');
  const internPhone = await recordResearch(db, actorWith(['INTERN'], 'I', 'u-role-intern'), { leadId: fresh.leadId, expectedVersion: fresh.version, field: 'phone', status: 'VERIFIED', basis: 'x' }, opts);
  assert(!internPhone.ok, 'nobody records a contact value they are not allowed to see');

  const rec = await recordResearch(db, researcher, { leadId: fresh.leadId, expectedVersion: fresh.version, field: 'friction-source', value: 'Portfolio pages take 9 seconds to load on mobile', source: 'https://example.com/111/work', sourceType: 'official_website' }, opts);
  assert(rec.ok, 'a researcher records a sourced friction claim', rec);
  const ev = (await db.select().from(schema.leadEvidence).where(eq(schema.leadEvidence.leadId, fresh.leadId))).find(e => e.origin === 'HUMAN_RECORD' && e.field === 'observable_friction');
  assert(!!ev && ev.sourceUrl === 'https://example.com/111/work' && ev.recordedByLabel === 'Test RESEARCHER' && ev.claimValue === 'Portfolio pages take 9 seconds to load on mobile', 'the cited source becomes claim-level evidence in the same transaction', ev);
  const after = await leadByTn('111');
  assert((after.record as KachmoLead).observable_friction === 'Portfolio pages take 9 seconds to load on mobile' && after.version === fresh.version + 1, 'and the lead carries the claim, one version later');
}

// ─────────────────────────────────────────────────────────────────────────────
group('8. Candidate approval re-decides inside the transaction (ADR-017, ADR-026)');
{
  const { reviewCandidate } = await import('../server/research/service');
  const [report] = await db
    .insert(schema.researchReport)
    .values({ sourceReportId: 'report-phase-b', provider: 'HUMAN', operatorLabel: 'Dev Jaiswal', originalFilename: 'r.md', byteSize: 1, format: 'markdown', contentSha256: 'b'.repeat(64), rawContent: 'x', stage: 'AWAITING_REVIEW', extractionStatus: 'OK' })
    .returning({ id: schema.researchReport.id });
  const claim = (field: string, value: string, url = 'https://northwind-studio.example/about') => ({
    field, value, statedConfidence: 'HIGH', reportLocation: null,
    evidence: [{ field, claim: value, sourceUrl: url, sourceDomain: 'northwind-studio.example', sourceType: 'official_website', retrievedAt: null, retrievedContentSha256: null, supportingExcerpt: null, level: 'URL_SHAPED', validator: 'LLM_EXTRACTION', validatedAt: null, contradictsEvidenceId: null, notes: null }],
  });
  const make = async (id: string, domain: string, company: string) => {
    const [r] = await db
      .insert(schema.researchCandidate)
      .values({ candidateId: id, reportId: report.id, status: 'AWAITING_REVIEW', companyName: company, websiteDomain: domain, archetypeId: '1', locationCountry: 'United Kingdom', claims: [claim('company_name', company), claim('website_url', `https://${domain}`), claim('location_country', 'United Kingdom'), claim('archetype_id', '1'), claim('decision_maker_name', 'Ada Lovelace')] })
      .returning({ id: schema.researchCandidate.id });
    return r.id;
  };
  const leads = (await db.select().from(schema.lead)).map(r => r.record as KachmoLead);
  const staleSnapshot = { phase: 'POST_CUTOVER' as const, source: 'POSTGRES' as const, leads, suppression: [], events: [], tracker: new Map(), scheduled: [], warnings: [], versions: new Map<string, number>() };

  const cand = await make('c-northwind', 'northwind-studio.example', 'Northwind Studio');
  // An opt-out lands AFTER the reviewer's page loaded — the snapshot they approve against does not contain it.
  const sup = await createSuppression(db, { userId: 'u-aadi', label: 'Aadi', engineActor: 'AADI' }, { reason: 'asked by email not to be contacted', domain: 'northwind-studio.example' }, opts);
  assert(sup.outcome === 'APPLIED', 'a domain suppression is recorded');
  let refused = '';
  try {
    await reviewCandidate(owner, { candidateId: cand, decision: 'ACCEPT', note: null }, staleSnapshot);
  } catch (e) {
    refused = (e as Error).message;
  }
  assert(/suppress/i.test(refused), 'approving against a stale view is still refused: suppression is re-read inside the transaction', refused);
  const [c] = await db.select().from(schema.researchCandidate).where(eq(schema.researchCandidate.id, cand));
  assert(c.status === 'AWAITING_REVIEW' && c.resolvedLeadId === null, 'and nothing was recorded against the candidate');
  assert(!(await db.select().from(schema.lead)).some(l => (l.record as KachmoLead).website_url.includes('northwind')), 'no lead was created for the suppressed company');

  // MERGE carries research to an existing lead as evidence — never as field writes.
  const existing = await leadByTn('020');
  const existingDomain = new URL((existing.record as KachmoLead).website_url).hostname.replace(/^www\./, '');
  const dup = await make('c-dup', existingDomain, (existing.record as KachmoLead).company_name);
  const merged = await reviewCandidate(owner, { candidateId: dup, decision: 'MERGE', note: 'same studio', mergeIntoLeadId: existing.leadId }, staleSnapshot);
  const [afterMerge] = await db.select().from(schema.lead).where(eq(schema.lead.leadId, existing.leadId));
  assert(merged.status === 'MERGED' && afterMerge.version === existing.version && afterMerge.recordSha256 === existing.recordSha256, 'a MERGE changes no field of the existing lead', merged);
  const attached = await db.select().from(schema.leadEvidence).where(eq(schema.leadEvidence.candidateId, dup));
  assert(attached.length === 5 && attached.every(e => e.leadId === existing.leadId && e.origin === 'EXTERNAL_RESEARCH'), 'it attaches the candidate\'s claims to that lead as evidence to review');
  const [mc] = await db.select().from(schema.researchCandidate).where(eq(schema.researchCandidate.id, dup));
  assert(mc.resolvedLeadId === existing.leadId && mc.reviewedByLabel === 'Dev Jaiswal', 'the candidate records which lead it was merged into, and who decided');
}

// ─────────────────────────────────────────────────────────────────────────────
group('9. Boundaries hold by construction');
{
  const walk = (d: string): string[] => readdirSync(d).flatMap(f => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  const server = walk(join(OS, 'server')).filter(f => f.endsWith('.ts') && !f.includes(`${join('db', 'migration')}`));
  const read = (f: string) => readFileSync(f, 'utf-8');
  const rel = (f: string) => relative(OS, f);
  const leadWriters = server.filter(f => /\.(insert|update)\(schema\.lead\)/.test(read(f))).map(rel).sort();
  assert(JSON.stringify(leadWriters) === JSON.stringify(['server/leads/mutate.ts', 'server/research/service.ts']), 'only the applier and the candidate import write the lead table', leadWriters);
  const supWriters = server.filter(f => /\.insert\(schema\.suppressionEntry\)/.test(read(f))).map(rel);
  assert(JSON.stringify(supWriters) === JSON.stringify(['server/leads/mutate.ts']), 'exactly one function inserts suppression entries', supWriters);
  const revisionWriters = server.filter(f => /\.insert\(schema\.leadRevision\)/.test(read(f))).map(rel);
  assert(JSON.stringify(revisionWriters) === JSON.stringify(['server/leads/mutate.ts']), 'exactly one module writes lead revisions', revisionWriters);
  const phaseB = server.filter(f => /server[\\/](leads|evidence)[\\/]/.test(f));
  assert(!phaseB.some(f => /nodemailer|imapflow|smtp|send-titan|cron-dispatch|create-titan-drafts/i.test(read(f))), 'no Phase B module touches mail, SMTP or the Titan dispatcher');
  assert(!phaseB.some(f => /writeFileSync|appendFileSync|createWriteStream|renameSync/.test(read(f))), 'no Phase B module writes a file — Postgres only');
  const fsUsers = phaseB.filter(f => /from 'node:fs'|from 'fs'/.test(read(f))).map(rel);
  assert(JSON.stringify(fsUsers) === JSON.stringify(['server/leads/reevaluate.ts']), 'only the engine-revision reader touches the filesystem; Titan state arrives through the read-only ledger reader', fsUsers);
  const fetchSrc = read(join(OS, 'server/evidence/fetch.ts'));
  assert(!/rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/.test(fetchSrc), 'TLS verification is never disabled in the fetcher');
}

// ─────────────────────────────────────────────────────────────────────────────
group('10. Operator views carry what a safe write needs (B.3)');
{
  const { loadCanonical } = await import('../server/repo/canonical');
  const { getCallQueue, getWhatsAppQueue } = await import('../server/services/operations');
  const { getLeadDetail } = await import('../server/services/leads');
  const snap = await loadCanonical({ KACHMO_CUTOVER_PHASE: 'POST_CUTOVER' });
  assert(snap.source === 'POSTGRES' && snap.versions.size === snap.leads.length, 'after cutover the snapshot carries every lead\'s stored version');
  const calls = await getCallQueue(owner, snap);
  const wa = await getWhatsAppQueue(owner, snap);
  assert(calls.source === 'POSTGRES' && calls.cards.every(c => !!c.leadId && typeof c.version === 'number'), 'every call card carries the lead id and the version it was rendered from', calls.cards.length);
  assert(wa.items.every(i => !!i.leadId && typeof i.version === 'number'), 'and so does every WhatsApp item');

  // Drift: the 120 migrated leads were last refreshed by the CLI; a lead the engine would now evaluate differently says so.
  const drifting: string[] = [];
  for (const l of snap.leads.slice(0, 120)) {
    const d = await getLeadDetail(l.target_number, owner, snap);
    if (d?.drift.length) drifting.push(l.target_number);
  }
  const { planReevaluation, runReevaluation } = await import('../server/leads/reevaluate-run');
  const plan = await planReevaluation(db, { ledger });
  const stale = plan.items.filter(i => i.changedFields.some(f => ['qualification_gates', 'research_state', 'research_completeness_score'].includes(f))).map(i => i.targetNumber);
  assert(JSON.stringify(drifting.sort()) === JSON.stringify(stale.sort()), 'the detail page flags drift on exactly the leads whose stored qualification a re-evaluation would change', { drifting, stale });
  await runReevaluation(db, { apply: true, confirm: plan.digest, actor: 'Dev Jaiswal', env: POST, ledger });
  const after = await loadCanonical({ KACHMO_CUTOVER_PHASE: 'POST_CUTOVER' });
  const stillDrifting: string[] = [];
  for (const l of after.leads) {
    const d = await getLeadDetail(l.target_number, owner, after);
    if (d?.drift.length) stillDrifting.push(l.target_number);
  }
  assert(stillDrifting.length === 0, 'after a re-evaluation no lead shows drift', stillDrifting);
}

await database.close();
console.log(`\n${'='.repeat(60)}`);
console.log(`EVIDENCE SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.error(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
