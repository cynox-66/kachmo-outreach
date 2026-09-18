/**
 * HISTORICAL SEND RECONCILIATION TESTS. `npm run test:historical-sends`
 *
 * Throwaway PGlite + a temp workspace. The allowlist used for mutation is the real one's SHAPE (same 19 target
 * numbers, statuses, minutes and UIDs) with synthetic `.invalid` recipients, so no production data is a fixture.
 * Nothing here opens SMTP or IMAP.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KachmoLead } from '@kachmo/core/leads/schema.js';
import { parseTrackerContent } from '@kachmo/core/email-ledger/tracker.js';
import { leadFromCandidate } from '@kachmo/core/research/promotion.js';
import { createRehearsalDatabase } from '../server/db/rehearsal-db';
import * as schema from '../server/db/schema/index';
import { leadRow } from '../server/db/migration/transform';
import { evaluateDispatchPreflight } from '../server/sync/dispatch-preflight';
import {
  HISTORICAL_SENDS, RECONCILIATION_ID, ACTION_SENT, ACTION_EXTERNAL, runReconciliation, reconcileTrackerContent, type HistoricalSend,
} from '../server/sync/historical-sends';

let passed = 0;
const failures: string[] = [];
function assert(cond: unknown, name: string, detail?: unknown): void {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failures.push(name); console.error(`  ❌ ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
}
const group = (t: string) => console.log(`\n${t}`);
const OS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

console.log('\n🧾 HISTORICAL SEND RECONCILIATION');

group('The real allowlist is exactly the verified evidence');
{
  const drafted = HISTORICAL_SENDS.filter(s => s.expectedStatus === 'DRAFTED').map(s => s.targetNumber).sort();
  assert(HISTORICAL_SENDS.length === 19, '19 entries', HISTORICAL_SENDS.length);
  assert(JSON.stringify(drafted) === JSON.stringify(['016', '017', '018', '020', '021', '022', '030', '033', '035', '049', '052', '061', '073', '074', '078', '079', '080', '083']), 'the 18 DRAFTED targets are exactly the verified list', drafted);
  const dq = HISTORICAL_SENDS.filter(s => s.expectedStatus === 'DISQUALIFIED');
  assert(dq.length === 1 && dq[0].targetNumber === '042', '042 is the only DISQUALIFIED entry');
  assert(new Set(HISTORICAL_SENDS.map(s => s.sentFolderUid)).size === 19 && new Set(HISTORICAL_SENDS.map(s => s.recipient)).size === 19, 'every UID and recipient is distinct');
  assert(HISTORICAL_SENDS.every(s => /^2026-09-12T14:3[23]Z$/.test(s.sentAtUtc)), 'every send is 2026-09-12 14:32–14:33 UTC, minute precision (no invented seconds)');
}

// ── Fixture ─────────────────────────────────────────────────────────────────
const SENDS: HistoricalSend[] = HISTORICAL_SENDS.map(s => ({ ...s, recipient: `t${s.targetNumber}@synthetic.invalid` }));
const row = (s: HistoricalSend) =>
  s.expectedStatus === 'DRAFTED'
    ? `| **${s.targetNumber}** | **Synthetic ${s.targetNumber}** | \`${s.recipient}\` | Arch-1 | **DRAFTED** | Angle ${s.targetNumber} |`
    : `| **${s.targetNumber}** | **Synthetic ${s.targetNumber}** | \`${s.recipient}\` | Arch-2 | **DISQUALIFIED** | ❌ Gate 2 violation: \`support@\` inbox. Remove from Titan Drafts. |`;
const TRACKER = [
  '# Ledger', '', '## 3. Daily Conversion Ledger', '',
  '### Batch 3: Drafted in Titan Mail on 2026-09-12', '',
  '| # | Company Name | Email Address | Archetype | Current Status | Primary Solution Angle |',
  '| :--- | :--- | :--- | :--- | :--- | :--- |',
  ...SENDS.map(row),
  '| **069** | **Synthetic 069** | `care@synthetic069.invalid` | Arch-3 | **DISQUALIFIED** | ❌ Gate 2 violation: `care@` inbox. Remove from Titan Drafts. |',
  '', '---', '',
  '### Batch 5: Scheduled', '',
  '| # | Target Name | Recipient Contact | Archetype | Sent Date | Follow-up Due | Current Status | Thread Notes & Conversion Outcome |',
  '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
  '| **901** | **Queued 901** | `q901@synthetic.invalid` | Arch-1 | 2026-09-15 | 2026-09-18 | **SCHEDULED** | queued |',
  '', '## 4. Metrics', '',
].join('\n');
const QUEUE = JSON.stringify([{ targetNumber: '901', to: 'q901@synthetic.invalid', companyName: 'Queued 901', subject: 's', plainText: 't', htmlContent: 'h' }], null, 2);
const SUPPRESSION = '[]\n';

const ev = (field: string, value: string) => ({
  field, value, statedConfidence: 'HIGH' as const, reportLocation: 'p1',
  evidence: [{ field, claim: value, sourceUrl: 'https://source.example/about', sourceDomain: 'source.example', sourceType: 'official_website' as const,
    retrievedAt: '2026-09-16T00:00:00.000Z', retrievedContentSha256: 'abc', supportingExcerpt: 'x', level: 'SUPPORTED' as const,
    validator: 'HUMAN' as const, validatedAt: '2026-09-16T00:00:00.000Z', contradictsEvidenceId: null, notes: null }],
});
const mkLead = (tn: string, email: string): KachmoLead => leadFromCandidate({
  candidate: {
    candidateId: `c${tn}`, sourceReportId: 'r', extractedAt: '2026-09-16T00:00:00.000Z', status: 'ACCEPTED' as const,
    claims: [ev('company_name', `Synthetic ${tn}`), ev('website_url', `https://s${tn}.invalid`), ev('location_country', 'United Kingdom'), ev('archetype_id', '1'), ev('decision_maker_name', 'A Person'), ev('decision_maker_email', email)],
    duplicateMatches: [], suppressionMatches: 0, missingFields: [], reviewedBy: 'R', reviewedAt: '2026-09-16T00:00:00.000Z', reviewNote: null, resolvedLeadId: null,
  },
  targetNumber: tn, leadId: `00000000-0000-4000-8000-000000000${tn}`, approvedBy: 'R', now: '2026-09-17T00:00:00.000Z',
});

const tempDirs: string[] = [];
async function workspace(opts: { tracker?: string; leadEmail?: (s: HistoricalSend) => string | null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kachmo-hist-'));
  tempDirs.push(root);
  mkdirSync(join(root, 'database'), { recursive: true });
  writeFileSync(join(root, 'OUTREACH_TRACKER.md'), opts.tracker ?? TRACKER);
  writeFileSync(join(root, 'scheduled-queue.json'), QUEUE);
  writeFileSync(join(root, 'database/suppression.json'), SUPPRESSION);
  const pg = await createRehearsalDatabase();
  for (const s of SENDS) {
    const email = opts.leadEmail ? opts.leadEmail(s) : s.recipient;
    if (email !== null) await pg.db.insert(schema.lead).values(leadRow(mkLead(s.targetNumber, email)));
  }
  await pg.db.insert(schema.lead).values(leadRow(mkLead('901', 'q901@synthetic.invalid')));
  return { root, ...pg };
}
const DAY = '2026-09-18';
const ACTOR = 'Test Operator';
const tracker = (root: string) => readFileSync(join(root, 'OUTREACH_TRACKER.md'), 'utf-8');
type AnyDb = Parameters<typeof runReconciliation>[0];
const run = (w: { root: string; db: unknown }, extra: Partial<Parameters<typeof runReconciliation>[1]> = {}) =>
  runReconciliation(w.db as AnyDb, { root: w.root, actor: ACTOR, apply: false, reconciledOn: DAY, sends: SENDS, ...extra });
const audits = async (w: { db: unknown }) => (w.db as AnyDb).select().from(schema.auditEvent);
const leadShas = async (w: { db: unknown }) => (await (w.db as AnyDb).select().from(schema.lead)).map(r => `${r.targetNumber}:${r.recordSha256}:${r.version}`).sort().join(',');

// ─────────────────────────────────────────────────────────────────────────────
group('Dry run is the default and writes nothing');
const main = await workspace();
{
  const r = await run(main);
  assert(r.plan.outcome === 'READY' && !r.applied, 'a dry run plans but does not apply', r.plan.problems);
  assert(r.plan.counts.draftedToSent === 18 && r.plan.counts.externalAnnotations === 1 && r.plan.counts.auditEvents === 19, 'plan: 18 DRAFTED → SENT, 1 external annotation, 19 audit events', r.plan.counts);
  assert(/^[0-9a-f]{16}$/.test(r.plan.digest), 'the dry run prints a plan digest for confirmation');
  assert(tracker(main.root) === TRACKER && (await audits(main)).length === 0, 'nothing was written');
  const noConfirm = await run(main, { apply: true });
  assert(noConfirm.plan.outcome === 'REFUSED' && !noConfirm.applied, '--apply without --confirm is refused');
  const wrong = await run(main, { apply: true, confirm: '0000000000000000' });
  assert(wrong.plan.outcome === 'REFUSED' && tracker(main.root) === TRACKER && (await audits(main)).length === 0, 'a wrong digest is refused and writes nothing');
  const noActor = await run(main, { actor: '' });
  assert(noActor.plan.outcome === 'REFUSED', 'a reconciliation without a named human actor is refused');
}

group('Apply: 18 DRAFTED → SENT (WEBMAIL/MANUAL), 042 stays DISQUALIFIED with a separate note');
{
  const shasBefore = await leadShas(main);
  const { plan } = await run(main);
  const r = await run(main, { apply: true, confirm: plan.digest });
  assert(r.applied, 'applied with the reviewed digest', r.message);
  const after = tracker(main.root);
  const ledger = parseTrackerContent(after);
  const drafted = SENDS.filter(s => s.expectedStatus === 'DRAFTED');
  assert(drafted.every(s => ledger.get(s.targetNumber)?.status === 'SENT'), 'all 18 now read as SENT through the real ledger parser');
  const lineOf = (tn: string) => after.split('\n').find(l => l.includes(`| **${tn}** |`))!;
  assert(drafted.every(s => /via WEBMAIL\/MANUAL, not dispatched by Titan/.test(lineOf(s.targetNumber)) && lineOf(s.targetNumber).includes(`IMAP UID ${s.sentFolderUid}`) && lineOf(s.targetNumber).includes(`reconciled ${DAY} by ${ACTOR}`)), 'each SENT row states channel WEBMAIL/MANUAL, not Titan, its evidence UID and who reconciled it');
  assert(drafted.every(s => lineOf(s.targetNumber).includes(`Angle ${s.targetNumber}`)), 'the original notes are preserved');
  assert(drafted.every(s => lineOf(s.targetNumber).includes(`2026-09-12 ${s.sentAtUtc.slice(11, 16)} UTC`)), 'each row records the minute the evidence supports');
  const dome = lineOf('042');
  assert(ledger.get('042')?.status === 'DISQUALIFIED' && /\*\*DISQUALIFIED\*\*/.test(dome), '042 remains DISQUALIFIED');
  assert(/❌ Gate 2 violation/.test(dome) && /Remove from Titan Drafts/.test(dome), '042 keeps its Gate 2 failure and "Remove from Titan Drafts"');
  assert(/EXTERNAL MANUAL SEND/.test(dome) && /outside the approved Titan path/.test(dome) && /never approved or dispatched by Titan/.test(dome), '042 gains a separate external-send note that disclaims approval and dispatch');
  assert(!/\*\*SENT\*\*/.test(dome), "042's row never contains a **SENT** status");
  const untouched = TRACKER.split('\n').filter(l => !SENDS.some(s => l.includes(`| **${s.targetNumber}** |`)));
  assert(untouched.every(l => after.split('\n').includes(l)) && after.split('\n').length === TRACKER.split('\n').length, 'every other line (069, the queued 901, headings) is byte-identical');

  const rows = await audits(main);
  const sent = rows.filter(a => a.action === ACTION_SENT);
  const ext = rows.filter(a => a.action === ACTION_EXTERNAL);
  assert(rows.length === 19 && sent.length === 18 && ext.length === 1, '19 audit events: 18 historical_send_reconciled + 1 external_send_recorded', rows.map(a => a.action));
  const m = (a: (typeof rows)[number]) => a.metadata as Record<string, unknown>;
  assert(rows.every(a => m(a).channel === 'WEBMAIL_MANUAL' && m(a).titan_dispatch === false && m(a).actual_outcome === 'SENT' && m(a).reconciliation_id === RECONCILIATION_ID), 'every audit: actual outcome SENT, channel WEBMAIL_MANUAL, titan_dispatch false');
  assert(rows.every(a => /^2026-09-12T14:3[23]Z$/.test(String(m(a).sent_at_utc)) && m(a).sent_at_precision === 'minute'), 'the send minute survives audit redaction intact', rows.map(a => m(a).sent_at_utc));
  assert(m(ext[0]).ledger_status_after === 'DISQUALIFIED' && m(ext[0]).approved_for_titan === false && ext[0].targetId === '00000000-0000-4000-8000-000000000042', "042's audit records it stays DISQUALIFIED and was not approved");
  assert(rows.every(a => a.actorLabel === ACTOR && a.actorUserId === null), 'the human reconciler is the recorded actor');
  const serialized = JSON.stringify(rows);
  assert(!/message[_-]?id|run[_-]?id|smtp/i.test(serialized), 'no Message-ID, Titan run id or SMTP metadata is fabricated');
  assert(!/@synthetic\.invalid/.test(serialized), 'no recipient address is written into audit rows');

  const backups = readdirSync(join(main.root, 'backups/ledger-reconciliation'));
  assert(backups.length === 1 && readFileSync(join(main.root, 'backups/ledger-reconciliation', backups[0]), 'utf-8') === TRACKER, 'a byte-exact backup of the previous ledger exists');
  assert(readFileSync(join(main.root, 'scheduled-queue.json'), 'utf-8') === QUEUE, 'scheduled-queue.json is unchanged');
  assert(readFileSync(join(main.root, 'database/suppression.json'), 'utf-8') === SUPPRESSION, 'suppression.json is unchanged');
  assert((await (main.db as AnyDb).select().from(schema.suppressionEntry)).length === 0, 'no suppression row was created');
  assert(await leadShas(main) === shasBefore, 'no lead record, version or business field changed');

  // The point of the exercise: every guard now sees these targets as already emailed.
  const preflight = evaluateDispatchPreflight({
    queueRaw: JSON.stringify([{ targetNumber: '016', to: 't016@synthetic.invalid', companyName: 'x' }]), trackerRaw: after,
    leads: (await (main.db as AnyDb).select().from(schema.lead)).map(l => l.record as KachmoLead), activeSuppression: [],
  });
  assert(!preflight.ok && preflight.findings.some(f => f.kind === 'ALREADY_SENT' && f.target_number === '016'), 'the dispatch preflight now refuses a re-queued reconciled target as ALREADY_SENT', preflight.findings);
  assert(/\*\*(SENT|FOLLOWED_UP|REPLIED_\w+)\*\*/.test(lineOf('016')), "the dispatcher's own already-sent matcher sees the row");
}

group('Idempotent: a second run reports ALREADY_RECONCILED and writes nothing');
{
  const before = tracker(main.root);
  const again = await run(main);
  assert(again.plan.outcome === 'ALREADY_RECONCILED', 'dry run reports already reconciled', again.plan.outcome);
  const applyAgain = await run(main, { apply: true, confirm: 'anything' });
  assert(applyAgain.plan.outcome === 'ALREADY_RECONCILED' && !applyAgain.applied, '--apply on a reconciled state writes nothing');
  assert(tracker(main.root) === before && (await audits(main)).length === 19, 'no second annotation and no second audit event');
}

group('Refusals: wrong state, wrong recipient, missing or duplicated targets, mixed state');
{
  const refuses = async (name: string, w: Awaited<ReturnType<typeof workspace>>) => {
    const r = await run(w);
    assert(r.plan.outcome === 'REFUSED', `refused: ${name}`, r.plan.problems);
    const forced = await run(w, { apply: true, confirm: r.plan.digest || 'x' });
    assert(!forced.applied && (await audits(w)).length === 0, `and --apply writes nothing (${name})`);
    await w.close();
  };
  await refuses('a target already in another state', await workspace({ tracker: TRACKER.replace('| **016** | **Synthetic 016** | `t016@synthetic.invalid` | Arch-1 | **DRAFTED** |', '| **016** | **Synthetic 016** | `t016@synthetic.invalid` | Arch-1 | **REPLIED_WARM** |') }));
  await refuses('042 no longer DISQUALIFIED', await workspace({ tracker: TRACKER.replace('Arch-2 | **DISQUALIFIED**', 'Arch-2 | **DRAFTED**') }));
  await refuses('ledger recipient differs from the evidence', await workspace({ tracker: TRACKER.replace('`t017@synthetic.invalid`', '`someone@else.invalid`') }));
  await refuses('Postgres lead email differs from the evidence', await workspace({ leadEmail: s => (s.targetNumber === '018' ? 'other@synthetic.invalid' : s.recipient) }));
  await refuses('ledger row missing', await workspace({ tracker: TRACKER.split('\n').filter(l => !l.includes('| **020** |')).join('\n') }));
  await refuses('Postgres lead missing', await workspace({ leadEmail: s => (s.targetNumber === '021' ? null : s.recipient) }));
  await refuses('duplicated ledger row', await workspace({ tracker: TRACKER.replace('## 4. Metrics', '| **022** | dup |\n\n## 4. Metrics') }));
  const oneDone = reconcileTrackerContent(TRACKER, SENDS.filter(s => s.targetNumber === '030'), DAY, ACTOR);
  await refuses('one row reconciled by hand, the rest not', await workspace({ tracker: oneDone }));
}

group('All-or-nothing: a failure leaves neither store half-reconciled');
{
  const w = await workspace();
  const { plan } = await run(w);
  let threw = false;
  try { await run(w, { apply: true, confirm: plan.digest, writeTracker: () => { throw new Error('disk full'); } }); } catch { threw = true; }
  assert(threw && tracker(w.root) === TRACKER && (await audits(w)).length === 0, 'tracker write fails → audit rows roll back, tracker untouched');

  threw = false;
  const replaceThenFail = (p: string, c: string) => { writeFileSync(`${p}.x`, c); renameSync(`${p}.x`, p); throw new Error('commit lost'); };
  try { await run(w, { apply: true, confirm: plan.digest, writeTracker: replaceThenFail }); } catch { threw = true; }
  assert(threw && tracker(w.root) === TRACKER && (await audits(w)).length === 0, 'failure after the tracker was replaced → tracker restored from backup, audit rows rolled back');

  const ok = await run(w, { apply: true, confirm: plan.digest });
  assert(ok.applied, 'after the failures, the same reviewed plan still applies cleanly');
  await w.close();
}

group('Crash recovery: each store can be completed from the other');
{
  // Crash after the tracker was renamed but before the transaction committed.
  const w = await workspace({ tracker: reconcileTrackerContent(TRACKER, SENDS, DAY, ACTOR) });
  const { plan } = await run(w);
  assert(plan.outcome === 'READY' && plan.trackerState === 'AFTER' && plan.auditState === 'ABSENT' && plan.nextTracker === null, 'tracker done + audits missing → plan inserts the audits only', plan);
  const before = tracker(w.root);
  const r = await run(w, { apply: true, confirm: plan.digest });
  assert(r.applied && tracker(w.root) === before && (await audits(w)).length === 19, 'audits completed, tracker left as it was');
  await w.close();
}

group('Nothing here can send, touch the queue, suppression, or the mailbox');
{
  // Code only: the header comment deliberately names what the module never touches.
  const src = readFileSync(join(OS_ROOT, 'server/sync/historical-sends.ts'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert(!/nodemailer|imapflow|createTransport|sendMail/.test(src), 'no mail library, transport or send call');
  const raw = readFileSync(join(OS_ROOT, 'server/sync/historical-sends.ts'), 'utf-8');
  assert(raw.includes('/server[\\\\/]sync[\\\\/]historical-sends\\.ts$/'), 'the CLI entry point matches only server/sync/historical-sends.ts, never a same-named test file');
  assert(!/scheduled-queue|suppressionEntry\)|suppression\.json|\.insert\(schema\.lead|\.update\(schema\.lead/.test(src), 'no reference to the queue, suppression writes, or lead writes');
}

await main.close();
for (const d of tempDirs) if (existsSync(d)) rmSync(d, { recursive: true, force: true });
console.log(`\n${'='.repeat(60)}\nHISTORICAL SENDS SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) { console.log(failures.map(f => `  - ${f}`).join('\n')); process.exit(1); }
