/**
 * Titan direct-send safety tests (npm run send:titan). NOTHING HERE CAN SEND EMAIL:
 *  - guard and ledger logic is exercised in-process with synthetic data;
 *  - the sender itself is only spawned with --dry-run, a fake password and an unreachable SMTP/IMAP host (127.0.0.1:9),
 *    inside a temp workspace with no .env;
 *  - the send-window / TLS configuration is imported from a temp working directory so no real .env is loaded.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import type { KachmoLead, SuppressionEntry } from '../lib/schema.js';
import { evaluateSendGuard, outboundEmailKind } from '../../core/email-ledger/send-guard.js';
import { applyLedgerSendUpdate } from '../../core/email-ledger/ledger-update.js';
import { parseTrackerContent } from '../../core/email-ledger/tracker.js';

const REPO = process.cwd();
if (!existsSync(join(REPO, 'scripts/__tests__/titan-guard.ts'))) {
  console.error('Run from Clients/mails (npm run test:titan).');
  process.exit(1);
}

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
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const tempDirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'kachmo-titan-test-'));
  tempDirs.push(d);
  return d;
};

const TRACKER = [
  '# Tracker (synthetic test fixture)',
  '',
  '## 3. Active Outreach Ledger',
  '',
  '### Batch 9: Synthetic',
  '',
  '| # | Target Name | Recipient Contact | Archetype | Sent Date | Follow-up Due | Current Status | Thread Notes |',
  '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
  '| **901** | **Alpha** | `a@alpha.example` | Arch-1 | — | — | **DRAFTED** | draft |',
  '| **902** | **Beta** | `b@beta.example` | Arch-1 | — | — | **SCHEDULED** | queued |',
  '| **903** | **Gamma** | `c@gamma.example` | Arch-1 | 2026-09-11 | 2026-09-14 | **SENT** | sent |',
  '| **904** | **Delta** | `d@delta.example` | Arch-1 | 2026-09-11 | 2026-09-14 | **FOLLOWED_UP** | bumped |',
  '| **905** | **Epsilon** | `e@eps.example` | Arch-1 | 2026-09-11 | 2026-09-14 | **REPLIED_NO** | no |',
  '| **906** | **Zeta** | `f@zeta.example` | Arch-1 | — | — | **DRAFTED** | draft |',
  '| **907** | **Eta** | `g@eta.example` | Arch-1 | — | — | **DISQUALIFIED** | ❌ Gate 2 |',
  '',
  '### Batch 10: Drafts only (no date columns)',
  '',
  '| # | Company Name | Email Address | Archetype | Current Status | Primary Solution Angle |',
  '| :--- | :--- | :--- | :--- | :--- | :--- |',
  '| **908** | **Theta** | `h@theta.example` | Arch-1 | **DRAFTED** | angle |',
  '',
  '## 4. Metrics',
  '',
].join('\n');

const email = (targetNumber: string, to: string, subject = 'a first note') => ({
  to, subject, targetNumber, companyName: `Test ${targetNumber}`, plainText: 't', htmlContent: '<p>t</p>',
  locationCity: 'London', locationCountry: 'United Kingdom', confidence: 'HIGH' as const,
});
const entry = (e: Partial<SuppressionEntry>): SuppressionEntry => ({ reason: 'test', suppressed_at: '2026-09-15', source: 'test', ...e });
const ledger = parseTrackerContent(TRACKER);
const base = { suppression: [] as SuppressionEntry[], leads: [] as KachmoLead[], ledger, scheduledQueue: [] as Array<{ targetNumber: string; to: string; companyName: string }> };
const codeOf = (payload: ReturnType<typeof email>, input = base): string => {
  const r = evaluateSendGuard([payload], input);
  return r.blocked.length ? r.blocked[0].code : 'ALLOWED';
};
const minimalLead = (tn: string, patch: Partial<KachmoLead> = {}): KachmoLead =>
  ({ lead_id: `lead-${tn}`, target_number: tn, company_name: `Test ${tn}`, website_url: `https://t${tn}.example`, decision_maker_email: null, decision_maker_phone: null, whatsapp_number: null, decision_maker_whatsapp: null, lead_state: 'DISCOVERED', call_status: null, whatsapp_outreach_status: null, email_outreach_status: null, response_status: null, do_not_contact: false, ...patch }) as unknown as KachmoLead;

console.log('\n📮 TITAN DIRECT-SEND SAFETY (send:titan) — no email can be sent by this suite');

// ─────────────────────────────────────────────────────────────────────────────
group('1. Suppression (checked before anything else)');
assert(codeOf(email('901', 'a@alpha.example')) === 'ALLOWED', 'a DRAFTED first-touch with no suppression is allowed');
assert(codeOf(email('901', 'a@alpha.example'), { ...base, suppression: [entry({ email: 'A@Alpha.EXAMPLE' })] }) === 'SUPPRESSED_RECIPIENT', 'suppressed recipient (any case) is blocked');
assert(codeOf(email('901', 'a@alpha.example'), { ...base, suppression: [entry({ domain: 'https://www.Alpha.example/contact' })] }) === 'SUPPRESSED_DOMAIN', 'suppressed domain (https/www/path/case variants) is blocked');
assert(codeOf(email('901', 'a@alpha.example'), { ...base, suppression: [entry({ target_number: '901' })] }) === 'SUPPRESSED_TARGET', 'suppressed target number is blocked');
assert(codeOf(email('903', 'c@gamma.example', 'Re: a first note'), { ...base, suppression: [entry({ email: 'c@gamma.example' })] }) === 'SUPPRESSED_RECIPIENT', 'suppression also blocks follow-ups');
assert(codeOf(email('901', 'a@alpha.example'), { ...base, leads: [minimalLead('901', { do_not_contact: true, suppression_reason: 'asked on a call' } as Partial<KachmoLead>)] }) === 'LEAD_BLOCKED', 'a lead flagged do_not_contact in the lead database is blocked');
assert(codeOf(email('901', 'a@alpha.example'), { ...base, leads: [minimalLead('901')], suppression: [entry({ lead_id: 'lead-901' })] }) === 'LEAD_BLOCKED', 'a lead_id-only suppression entry is honoured through the lead database');

// ─────────────────────────────────────────────────────────────────────────────
group('2. Duplicate-send protection (email ledger = OUTREACH_TRACKER.md)');
assert(codeOf(email('903', 'c@gamma.example')) === 'ALREADY_SENT', 'a first-touch to a target already SENT is blocked');
assert(codeOf(email('905', 'e@eps.example')) === 'ALREADY_SENT', 'a first-touch to a target that replied no is blocked');
assert(codeOf(email('907', 'g@eta.example')) === 'LEDGER_STATE_NOT_SENDABLE', 'a DISQUALIFIED ledger row cannot be sent');
assert(codeOf(email('999', 'new@new.example')) === 'NOT_IN_LEDGER', 'a target with no ledger row is refused (record it first)');
assert(codeOf(email('901', 'c@gamma.example')) === 'RECIPIENT_ALREADY_EMAILED', 'the same recipient already emailed under another target is blocked');
assert(codeOf(email('902', 'b@beta.example'), { ...base, scheduledQueue: [{ targetNumber: '902', to: 'b@beta.example', companyName: 'Beta' }] }) === 'IN_CRON_QUEUE', 'a target still held in scheduled-queue.json for the cron is blocked');
{
  const r = evaluateSendGuard([email('901', 'a@alpha.example'), email('901', 'a@alpha.example'), email('906', 'A@alpha.example')], base);
  assert(r.allowed.length === 1 && r.blocked.length === 2 && r.blocked.every(b => b.code === 'DUPLICATE_IN_BATCH'), 'duplicates within one batch (same target or same recipient) are sent at most once', r.blocked.map(b => b.code));
}
assert(codeOf(email('901', 'not-an-email')) === 'INVALID_RECIPIENT', 'an invalid recipient is blocked');

// ─────────────────────────────────────────────────────────────────────────────
group('3. Follow-up bump (single-bump protocol, /mail-followup)');
assert(outboundEmailKind('Re: dev overflow for Spin?') === 'FOLLOW_UP' && outboundEmailKind('dev overflow for Spin?') === 'FIRST_TOUCH', 'a "Re:" subject is the follow-up marker');
assert(codeOf(email('903', 'c@gamma.example', 'Re: a first note')) === 'ALLOWED', 'one follow-up to a SENT target is allowed');
assert(codeOf(email('904', 'd@delta.example', 'Re: a first note')) === 'FOLLOW_UP_ALREADY_SENT', 'a second follow-up (ledger FOLLOWED_UP) is blocked');
assert(codeOf(email('903', 'c@gamma.example', 'Re: a first note'), { ...base, leads: [minimalLead('903', { email_follow_up_sent_at: '2026-09-15' } as Partial<KachmoLead>)] }) === 'FOLLOW_UP_ALREADY_SENT', 'a follow-up already logged via pipeline:log is blocked');
assert(codeOf(email('905', 'e@eps.example', 'Re: a first note')) === 'LEDGER_STATE_NOT_SENDABLE', 'no follow-up after a reply');
assert(codeOf(email('901', 'a@alpha.example', 'Re: a first note')) === 'LEDGER_STATE_NOT_SENDABLE', 'no "follow-up" to a target that was never sent');

// ─────────────────────────────────────────────────────────────────────────────
group('4. Ledger update after a successful send (prevents re-sending on the next run)');
{
  const first = applyLedgerSendUpdate(TRACKER, '901', 'FIRST_TOUCH', '2026-09-15');
  const row = first.content.split('\n').find(l => l.startsWith('| **901**'))!;
  assert(first.updated === 1 && /\| 2026-09-15 \| 2026-09-18 \| \*\*SENT\*\* \|/.test(row), 'DRAFTED → SENT with sent date and +3-day follow-up due', row);
  assert(codeOf(email('901', 'a@alpha.example'), { ...base, ledger: parseTrackerContent(first.content) }) === 'ALREADY_SENT', 're-running the same send after the ledger update is blocked');
  const others = (c: string) => c.split('\n').filter(l => !l.startsWith('| **901**'));
  assert(JSON.stringify(others(first.content)) === JSON.stringify(others(TRACKER)), 'no other line of the ledger changes');

  const bump = applyLedgerSendUpdate(TRACKER, '903', 'FOLLOW_UP', '2026-09-15');
  const bumped = bump.content.split('\n').find(l => l.startsWith('| **903**'))!;
  assert(bump.updated === 1 && bumped.includes('**FOLLOWED_UP**') && bumped.includes('| 2026-09-11 | 2026-09-14 |'), 'SENT → FOLLOWED_UP, original dates kept', bumped);
  assert(codeOf(email('903', 'c@gamma.example', 'Re: a first note'), { ...base, ledger: parseTrackerContent(bump.content) }) === 'FOLLOW_UP_ALREADY_SENT', 'a second bump after the ledger update is blocked');

  const noDates = applyLedgerSendUpdate(TRACKER, '908', 'FIRST_TOUCH', '2026-09-15');
  assert(noDates.updated === 1 && noDates.content.includes('| **908** | **Theta** | `h@theta.example` | Arch-1 | **SENT** | angle |'), 'a table without date columns only changes the status cell');
  for (const [tn, kind] of [['904', 'FIRST_TOUCH'], ['905', 'FOLLOW_UP'], ['907', 'FIRST_TOUCH'], ['999', 'FIRST_TOUCH']] as const) {
    const r = applyLedgerSendUpdate(TRACKER, tn, kind, '2026-09-15');
    assert(r.updated === 0 && r.content === TRACKER, `rows not in a sendable state are never rewritten (${tn} ${kind})`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
group('5. No bypass');
{
  const guardSrc = readFileSync(join(REPO, 'core/email-ledger/send-guard.ts'), 'utf-8');
  const senderSrc = readFileSync(join(REPO, 'scripts/send-titan-smtp.ts'), 'utf-8');
  assert(evaluateSendGuard.length === 2 && !/\bforce\b|override|skip(Guard|Suppression)/i.test(guardSrc.replace(/deliberately no override flag|nothing here can be forced/gi, '')), 'the guard takes no override / force option');
  assert(!/--force|--skip|--no-guard|--unsafe/.test(senderSrc), 'send:titan accepts no force / skip flag');
  const guardAt = senderSrc.indexOf('evaluateSendGuard(payloads');
  assert(guardAt > 0 && guardAt < senderSrc.indexOf('const highConfidence') && guardAt < senderSrc.indexOf('saveToDraft(payload)'), 'the guard runs before confidence routing, sending and drafting');
}

// ─────────────────────────────────────────────────────────────────────────────
group('6. Fail closed: the sender refuses to run without trustworthy safety data (spawned, --dry-run only)');
{
  const W = tempDir();
  mkdirSync(join(W, 'database'), { recursive: true });
  writeFileSync(join(W, 'OUTREACH_TRACKER.md'), TRACKER);
  writeFileSync(join(W, 'database/kachmo_leads.json'), '[]');
  writeFileSync(join(W, 'scheduled-queue.json'), '[]');
  writeFileSync(join(W, 'batch.json'), JSON.stringify([
    email('901', 'a@alpha.example'),
    email('906', 'f@zeta.example'),
    email('903', 'c@gamma.example'),
    email('902', 'b@beta.example'),
  ]));
  const goodSup = JSON.stringify([entry({ target_number: '906' }), entry({ domain: 'beta.example' })]);

  const run = (suppression: string | null, args: string[]) => {
    if (!args.includes('--dry-run')) throw new Error('The test suite never runs the sender without --dry-run.');
    const supPath = join(W, 'database/suppression.json');
    if (suppression === null) rmSync(supPath, { force: true });
    else writeFileSync(supPath, suppression);
    const trackerBefore = sha(readFileSync(join(W, 'OUTREACH_TRACKER.md'), 'utf-8'));
    const r = spawnSync(process.execPath, [join(REPO, 'node_modules/tsx/dist/cli.mjs'), join(REPO, 'scripts/send-titan-smtp.ts'), ...args], {
      cwd: W,
      encoding: 'utf-8',
      timeout: 60000,
      env: { PATH: process.env.PATH, HOME: W, TITAN_PASSWORD: 'test-not-a-real-password', TITAN_EMAIL: 'nobody@invalid.example', TITAN_SMTP_HOST: '127.0.0.1', TITAN_SMTP_PORT: '9', TITAN_IMAP_HOST: '127.0.0.1', TITAN_IMAP_PORT: '9' },
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}`, trackerUnchanged: sha(readFileSync(join(W, 'OUTREACH_TRACKER.md'), 'utf-8')) === trackerBefore };
  };

  const ok = run(goodSup, ['--file=batch.json', '--dry-run']);
  assert(ok.code === 0, 'dry run with valid safety data exits cleanly', ok.out.slice(-600));
  assert(/⛔ #906 .*SUPPRESSED_TARGET/.test(ok.out) && /⛔ #902 .*SUPPRESSED_DOMAIN/.test(ok.out) && /⛔ #903 .*ALREADY_SENT/.test(ok.out), 'suppressed and already-sent payloads are reported as blocked', ok.out.slice(-900));
  assert(!/⛔ #901 /.test(ok.out) && !/Sent!|📨 Sending|SMTP connection verified/.test(ok.out), 'the eligible payload is not blocked, and no SMTP send or connection is attempted in a dry run');
  assert(ok.trackerUnchanged, 'a dry run never writes the ledger');

  const missing = run(null, ['--file=batch.json', '--dry-run']);
  assert(missing.code !== 0 && /Send guard could not load/.test(missing.out) && /Suppression list missing/.test(missing.out) && !/Timezone Analysis|DRY RUN/.test(missing.out), 'missing suppression list → exits non-zero before any payload is processed', missing.out.slice(-400));
  for (const [name, content, re] of [
    ['invalid JSON', '{bad', /not valid JSON/],
    ['empty file', '', /not valid JSON/],
    ['not an array', '{}', /not a JSON array/],
    ['bare string entry', '["a@alpha.example"]', /malformed/],
    ['entry without identifier', '[{"reason":"x"}]', /malformed/],
  ] as const) {
    const r = run(content, ['--file=batch.json', '--dry-run']);
    assert(r.code !== 0 && re.test(r.out) && !/Timezone Analysis|DRY RUN/.test(r.out), `malformed suppression list (${name}) → fails closed`, r.out.slice(-300));
  }

  writeFileSync(join(W, 'database/suppression.json'), goodSup);
  rmSync(join(W, 'OUTREACH_TRACKER.md'));
  const noLedger = spawnSync(process.execPath, [join(REPO, 'node_modules/tsx/dist/cli.mjs'), join(REPO, 'scripts/send-titan-smtp.ts'), '--file=batch.json', '--dry-run'], { cwd: W, encoding: 'utf-8', timeout: 60000, env: { PATH: process.env.PATH, HOME: W, TITAN_PASSWORD: 'test-not-a-real-password', TITAN_SMTP_HOST: '127.0.0.1', TITAN_SMTP_PORT: '9' } });
  assert(noLedger.status !== 0 && /Email ledger missing/.test(`${noLedger.stdout}${noLedger.stderr}`), 'missing OUTREACH_TRACKER.md → fails closed');
  writeFileSync(join(W, 'OUTREACH_TRACKER.md'), TRACKER);
  writeFileSync(join(W, 'database/kachmo_leads.json'), '{bad');
  const badLeads = run(goodSup, ['--file=batch.json', '--dry-run']);
  assert(badLeads.code !== 0 && /Send guard could not load/.test(badLeads.out), 'unreadable lead database → fails closed');
  writeFileSync(join(W, 'database/kachmo_leads.json'), '[]');
  writeFileSync(join(W, 'scheduled-queue.json'), '{"not":"an array"}');
  const badQueue = run(goodSup, ['--file=batch.json', '--dry-run']);
  assert(badQueue.code !== 0 && /not a JSON array/.test(badQueue.out), 'malformed scheduled-queue.json → fails closed');
}

// ─────────────────────────────────────────────────────────────────────────────
group('7. Send window (the dayOfWeek crash) and TLS configuration');
{
  const prev = process.cwd();
  process.chdir(tempDir()); // no .env here, so importing the sender loads no credentials
  const titan = await import('../send-titan-smtp.js');
  process.chdir(prev);
  const at = (iso: string, tz: string) => {
    try {
      return titan.calculateSendWindow(tz, new Date(iso));
    } catch (e) {
      return { error: (e as Error).message };
    }
  };
  const sat = at('2026-09-19T12:00:00Z', 'Europe/London') as any;
  assert(!sat.error && sat.sendNow === false && sat.scheduledLocalTime === 'Mon ~9:00 AM', 'Saturday → next business morning Monday (previously threw ReferenceError: dayOfWeek)', sat);
  const friLate = at('2026-09-18T15:00:00Z', 'Europe/London') as any;
  assert(!friLate.error && friLate.sendNow === false && friLate.scheduledLocalTime === 'Mon ~9:00 AM', 'Friday afternoon → Monday', friLate);
  const tueLate = at('2026-09-15T15:00:00Z', 'Europe/London') as any;
  assert(!tueLate.error && tueLate.sendNow === false && tueLate.scheduledLocalTime === 'Wed ~9:00 AM', 'Tuesday afternoon → Wednesday', tueLate);
  const sunIndia = at('2026-09-20T06:00:00Z', 'Asia/Kolkata') as any;
  assert(!sunIndia.error && sunIndia.scheduledLocalTime === 'Mon ~9:00 AM', 'Sunday in another timezone → Monday', sunIndia);
  const inWindow = at('2026-09-16T08:30:00Z', 'Europe/London') as any;
  assert(!inWindow.error && inWindow.sendNow === true, 'a weekday 09:30 local is inside the window');
  const early = at('2026-09-16T05:00:00Z', 'Europe/London') as any;
  assert(!early.error && early.sendNow === false && /^~9:\d\d AM$/.test(early.scheduledLocalTime), 'a weekday before the window waits for 9 AM the same day');

  assert(titan.smtpTransportOptions().tls.rejectUnauthorized === true, 'send:titan verifies the SMTP server certificate');
  const offenders = ['send-titan-smtp.ts', 'cron-dispatch.ts', 'create-titan-drafts.ts'].filter(f => /rejectUnauthorized:\s*false/.test(readFileSync(join(REPO, 'scripts', f), 'utf-8')));
  assert(offenders.length === 0, 'no Titan script disables certificate verification (send, cron dispatch, drafts)', offenders);
  assert(/rejectUnauthorized:\s*true/.test(readFileSync(join(REPO, 'scripts/cron-dispatch.ts'), 'utf-8')), 'the GitHub cron dispatcher verifies the SMTP server certificate');
}

// ─────────────────────────────────────────────────────────────────────────────
group('Automated dispatch is paused (POST_CUTOVER suppression gap)');
{
  const WORKFLOW = join(REPO, '.github/workflows/outreach-dispatch.yml');
  const workflow = readFileSync(WORKFLOW, 'utf-8');
  const marker = JSON.parse(readFileSync(join(REPO, 'OUTREACH_PAUSE.json'), 'utf-8')) as {
    paused: boolean;
    reason: string;
    unblockedBy: string;
    note: string;
    scheduledQueueEntriesHeld: number;
  };

  assert(marker.paused === true, 'OUTREACH_PAUSE.json records the pause');
  assert(/POST_CUTOVER/.test(marker.reason), 'the recorded reason names the cutover as the cause', marker.reason);
  assert(/NOT AN OPERATIONAL FAILURE/i.test(marker.note), 'the marker says this is an intentional pause, not a failure');
  assert(/DOES NOT exist/i.test(marker.note), 'the marker states plainly that suppression sync does not exist');

  // While the marker says paused, the workflow must carry no ACTIVE schedule trigger. Commented-out cron lines
  // are how the pause is expressed and are expected; an uncommented one would let GitHub fire the dispatcher.
  const activeCron = workflow
    .split('\n')
    .filter(l => /^\s*-\s*cron:/.test(l) && !/^\s*#/.test(l));
  assert(!marker.paused || activeCron.length === 0, 'no active cron schedule while dispatch is paused', activeCron);
  assert(/^\s*#\s*schedule:/m.test(workflow), 'the schedule block is present but commented out, so resuming is a one-line change');
  assert(/AUTOMATED DISPATCH IS PAUSED/.test(workflow), 'the workflow states the pause at the top of its triggers');

  // The gate must run BEFORE anything can dispatch, or it protects nothing.
  const gateAt = workflow.indexOf('Outreach pause gate');
  const dispatchAt = workflow.indexOf('Run Timezone Outreach Dispatcher');
  assert(gateAt > 0, 'the workflow has an outreach pause gate step');
  assert(gateAt < dispatchAt, 'the pause gate runs before the dispatcher step');
  assert(workflow.indexOf('Install dependencies') > gateAt, 'the pause gate fails fast, before dependencies are installed');

  // Execute the gate exactly as the workflow would. A scheduled run supplies no inputs, so both are empty.
  const gateScript = workflow.split("run: |\n          node -e '")[1]?.split("\n          '")[0];
  assert(!!gateScript, 'the gate script can be extracted from the workflow');
  const runGate = (env: Record<string, string>) =>
    spawnSync('node', ['-e', gateScript!], { cwd: REPO, encoding: 'utf-8', env: { ...process.env, DRY_RUN: '', ACK: '', ...env } });

  const scheduled = runGate({});
  assert(scheduled.status === 1, 'the gate REFUSES a run with no inputs (what a schedule trigger supplies)', scheduled.status);
  assert(/Refusing to dispatch/.test(scheduled.stderr), 'the refusal says it is refusing to dispatch');
  assert(/INTENTIONAL SAFETY PAUSE/.test(scheduled.stdout), 'the refusal identifies itself as an intentional pause');
  assert(/Blocked until/.test(scheduled.stdout), 'the refusal names what would unblock it');

  assert(runGate({ DRY_RUN: 'true' }).status === 0, 'a dry run is still allowed (it cannot send)');
  assert(runGate({ ACK: 'true' }).status === 0, 'an explicit operator acknowledgement is allowed');
  assert(/acknowledge_stale_suppression/.test(workflow), 'the acknowledgement is an explicit, named workflow input');

  // Nothing about the pause may touch Titan send state, the ledger, or the queue.
  const queue = JSON.parse(readFileSync(join(REPO, 'scheduled-queue.json'), 'utf-8')) as unknown[];
  assert(Array.isArray(queue) && queue.length === 5, 'the scheduled queue still holds its 5 entries (nothing deleted)', queue.length);
  assert(existsSync(join(REPO, 'OUTREACH_TRACKER.md')), 'the Titan email ledger is still present');
  assert(marker.scheduledQueueEntriesHeld === queue.length, 'the marker records how many entries are being held', marker.scheduledQueueEntriesHeld);

  // The pause is a workflow-level change: Titan's send logic is untouched.
  const dispatcher = readFileSync(join(REPO, 'scripts/cron-dispatch.ts'), 'utf-8');
  assert(!/OUTREACH_PAUSE/.test(dispatcher), 'the pause did not modify the dispatcher itself');
  assert(!/OUTREACH_PAUSE/.test(readFileSync(join(REPO, 'scripts/send-titan-smtp.ts'), 'utf-8')), 'the pause did not modify send:titan');
  assert(/refusing to send/i.test(dispatcher), "the dispatcher's own fail-closed suppression check is still in place");
}

for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
console.log(`\n${'='.repeat(60)}\nTITAN SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
