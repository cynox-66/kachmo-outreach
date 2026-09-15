/**
 * Kachmo Outbound Engine V2 test suite.
 *
 * Everything that writes runs inside a throwaway workspace (a temp directory holding COPIES of the CSV,
 * tracker and scheduled queue). The real repository is only ever read: protected-file hashes and a
 * read-only health check of the real lead database and queues.
 */
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, renameSync, readdirSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { safeWriteJson, safeReadJson, readJsonl, pruneBackups } from '../lib/safe-io.js';
import type { KachmoLead } from '../lib/schema.js';
import { loadLeads, saveLeads, loadSuppression, paths } from '../lib/store.js';
import { phoneEligibility, whatsappEligibility, checkSuppression, outreachBlock, emailRoute } from '../lib/contact.js';
import { evaluateOpportunities } from '../leads-opportunity.js';
import { checkEmailQueue } from '../email-queue-check.js';
import { latestBaselineFile } from '../audit-baseline.js';
import { resolveTimezone } from '../lib/geo.js';
import { parseTracker } from '../lib/email-state.js';
import { findInvariantViolations } from '../lib/invariants.js';
import { runMigration, parseCsv } from '../migrate-csv-to-leads.js';
import { evaluateLeadGates, qualifyLeads } from '../leads-qualify.js';
import { calculateLeadScores, scoreLeads } from '../leads-score.js';
import { refreshLeads } from '../leads-refresh.js';
import { generateResearchQueue } from '../leads-research-queue.js';
import { generateCallingQueue, buildCallCard, callEligibility } from '../queue-calls.js';
import { generateWhatsAppQueue, buildWhatsAppDraft } from '../queue-whatsapp.js';
import { logCallOutcome } from '../call-log.js';
import { logWhatsApp } from '../whatsapp-log.js';
import { logPipeline } from '../pipeline-log.js';
import { recordResearch } from '../leads-record.js';
import { suppressContact } from '../suppress-add.js';
import { runWarRoom } from '../war-room.js';
import { generateWeeklyReport } from '../analytics-weekly.js';
import { findDuplicates, deduplicateLeads } from '../leads-dedupe.js';
import { exportLeadsToCsv } from '../leads-export-csv.js';

const REPO = process.cwd();
if (!existsSync(join(REPO, 'scripts/__tests__/run-tests.ts'))) {
  console.error('Run from Clients/mails (npm test).');
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
function quiet<T>(fn: () => T): T {
  const [log, warn] = [console.log, console.warn];
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
}
function errorOf(fn: () => unknown): string | null {
  try {
    quiet(fn);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
function warnings(fn: () => unknown): string {
  const out: string[] = [];
  const [log, warn] = [console.log, console.warn];
  console.log = () => {};
  console.warn = (...a: unknown[]) => void out.push(a.join(' '));
  try {
    fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
  return out.join('\n');
}
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
const tempDirs: string[] = [];
function newWorkspace(files = ['kachmo_targets.csv', 'OUTREACH_TRACKER.md', 'scheduled-queue.json']): string {
  const dir = mkdtempSync(join(tmpdir(), 'kachmo-v2-test-'));
  tempDirs.push(dir);
  for (const f of files) copyFileSync(join(REPO, f), join(dir, f));
  mkdirSync(join(dir, 'database'), { recursive: true });
  writeFileSync(join(dir, 'database/suppression.json'), '[]');
  return dir;
}
const lead = (tn: string) => loadLeads().find(l => l.target_number === tn)!;
const clone = (tn: string): KachmoLead => JSON.parse(JSON.stringify(lead(tn)));
const listTs = (dir: string): string[] =>
  readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? listTs(p) : p.endsWith('.ts') ? [p] : [];
  });

console.log('\n🧪 KACHMO OUTBOUND ENGINE V2 — TEST SUITE');

// ─────────────────────────────────────────────────────────────────────────────
group(`0. Protected production files (byte-for-byte vs ${latestBaselineFile(REPO).split('/audit/')[1]})`);
const baseline = readFileSync(latestBaselineFile(REPO), 'utf-8')
  .trim()
  .split('\n')
  .map(l => l.split(/\s{2,}/))
  .map(([hash, , , file]) => ({ hash, file }));
assert(baseline.length === 11, 'baseline lists all 11 protected files', baseline.length);
for (const b of baseline) assert(sha(join(REPO, b.file)) === b.hash, `unchanged: ${b.file}`);

// ─────────────────────────────────────────────────────────────────────────────
group('1. Migration integrity (no data loss)');
const W = newWorkspace();
process.chdir(W);
const csvRows = parseCsv(readFileSync('kachmo_targets.csv', 'utf-8')).slice(1);
quiet(() => runMigration({ force: false }));
let leads = loadLeads();
assert(leads.length === csvRows.length, `every CSV data row became a lead (${csvRows.length})`, leads.length);
assert(
  csvRows.every(r => leads.filter(l => l.target_number === r[0].trim() && l.company_name === r[3].trim()).length === 1),
  'target_number → company mapping is exactly 1:1 with the CSV'
);
assert(new Set(leads.map(l => l.lead_id)).size === leads.length, 'lead_ids are unique');
assert(/already exists/.test(errorOf(() => runMigration({ force: false })) ?? ''), 're-running migration without --force is refused');
{
  const bad = newWorkspace([]);
  process.chdir(bad);
  writeFileSync('kachmo_targets.csv', `${readFileSync(join(W, 'kachmo_targets.csv'), 'utf-8').split('\n')[0]}\n001,only,three\n`);
  const err = errorOf(() => runMigration({ force: false }));
  assert(/Migration aborted/.test(err ?? ''), 'a malformed CSV row aborts migration (no silent skip)', err);
  assert(!existsSync('database/kachmo_leads.json'), '…and nothing is written');
  process.chdir(W);
}

// ─────────────────────────────────────────────────────────────────────────────
group('2. Contact provenance & non-fabrication');
quiet(refreshLeads);
leads = loadLeads();
const usable = new Set(['PUBLICLY_LISTED', 'VERIFIED']);
assert(leads.every(l => !usable.has(l.phone_status) && !usable.has(l.email_status)), 'migration never marks a contact PUBLICLY_LISTED/VERIFIED (no sources exist)');
const batch6 = leads.filter(l => l.batch_history.includes('batch6'));
assert(batch6.length === 10 && batch6.every(l => l.phone_status === 'UNVERIFIED' && !/^https?:/.test(l.phone_source ?? '')), 'Batch 6 tracker phones are UNVERIFIED with no source URL', batch6.map(l => l.phone_status));
assert(leads.every(l => !l.whatsapp_basis && l.whatsapp_eligible !== 'YES'), 'no lead is WhatsApp-eligible by inference');
assert(leads.every(l => l.research_sources.length === 0 && l.current_website_status === null), 'no fabricated research visits or website status');
assert(leads.every(l => l.conversion_probability === 'UNKNOWN' && l.expected_revenue === 'UNKNOWN'), 'conversion probability / expected revenue stay UNKNOWN');
assert(leads.every(l => !l.estimated_project_value || (l.estimated_project_value_basis?.includes('NOT evidence') && l.expected_value_confidence === 'LOW')), 'project value is labelled as Kachmo’s price band, not prospect budget');
assert(leads.every(l => l.decision_maker_confidence === 'LOW' && l.overall_research_confidence === 'LOW'), 'unsourced legacy research is LOW confidence');
assert(leads.every(l => l.timezone !== 'UTC'), 'no UTC placeholder timezones');
assert(resolveTimezone('Union City', 'United States').timezone === null, 'multi-timezone country is not guessed');
assert(resolveTimezone('London (West End)', 'United Kingdom').timezone === 'Europe/London', 'city substring resolves');

// ─────────────────────────────────────────────────────────────────────────────
group('3. 8-gate qualification');
{
  const l = clone('111');
  l.decision_maker_email = 'info@example.com';
  l.email_status = 'UNVERIFIED';
  l.decision_maker_phone = null;
  l.phone_status = 'UNKNOWN';
  const r = evaluateLeadGates(l);
  assert(r.gates.gate_2_contactability === 'PENDING' && r.missing.some(m => m.startsWith('direct_contact_route')), 'Gate 2: info@ is not a decision-maker route');
  l.decision_maker_email = 'support@example.com';
  const s = evaluateLeadGates(l);
  assert(s.gates.gate_2_contactability === 'PENDING' && s.state !== 'DISQUALIFIED', 'Gate 2: support@ is a research gap, not a disqualification');
  l.decision_maker_email = null;
  l.decision_maker_phone = '+91 99999 99999';
  l.phone_status = 'INFERRED';
  assert(evaluateLeadGates(l).gates.gate_2_contactability === 'PENDING' && !phoneEligibility(l).ok, 'INFERRED phone never passes contactability');
  l.phone_status = 'UNVERIFIED';
  assert(evaluateLeadGates(l).gates.gate_2_contactability === 'PENDING', 'UNVERIFIED phone never passes contactability');
  l.phone_status = 'PUBLICLY_LISTED';
  l.phone_source = null;
  assert(!phoneEligibility(l).ok && findInvariantViolations([l]).length > 0, 'PUBLICLY_LISTED without a source URL is rejected');
  l.phone_source = 'https://example.com/contact';
  assert(evaluateLeadGates(l).gates.gate_2_contactability === 'PASS' && phoneEligibility(l).ok, 'PUBLICLY_LISTED phone with a source URL passes');
}
{
  const l = clone('050');
  const r = evaluateLeadGates(l);
  assert(r.gates.gate_6_budget_probability === 'UNKNOWN' && r.gates.gate_7_buying_intent === 'UNKNOWN' && r.state !== 'DISQUALIFIED', 'unknown budget / trigger never disqualify');
  l.budget_probability = 'LOW';
  assert(evaluateLeadGates(l).gates.gate_6_budget_probability === 'UNVERIFIED', 'LOW budget without a source is UNVERIFIED, not FAIL');
  l.budget_probability_source = 'https://example.com/evidence';
  assert(evaluateLeadGates(l).gates.gate_6_budget_probability === 'FAIL', 'LOW budget with a source FAILs');
  const g = clone('050');
  g.decision_maker_name = 'Founders';
  assert(evaluateLeadGates(g).gates.gate_1_decision_maker === 'PENDING' && evaluateLeadGates(g).state === 'RESEARCH_REQUIRED', 'generic "Founders" is not a named decision maker');
  assert(JSON.stringify(evaluateLeadGates(g)) === JSON.stringify(evaluateLeadGates(g)), 'gate evaluation is deterministic');
  const fit = clone('050');
  assert(evaluateLeadGates(fit).gates.gate_8_kachmo_fit === 'UNVERIFIED', 'Gate 8 is not auto-passed from text length');
  fit.kachmo_fit_rejected_reason = 'not a fit';
  assert(evaluateLeadGates(fit).state === 'DISQUALIFIED', 'a human fit rejection disqualifies');
}
{
  const l = clone('113'); // anilsadvani@gmail.com, no recorded source
  l.decision_maker_phone = null;
  l.phone_status = 'UNKNOWN';
  assert(evaluateLeadGates(l).gates.gate_2_contactability === 'PENDING', 'an unsourced personal Gmail address is not a usable route');
  l.email_status = 'PUBLICLY_LISTED';
  l.email_source = 'https://example.com/about';
  assert(evaluateLeadGates(l).gates.gate_2_contactability === 'PASS', '…until its public source is recorded');
}

// ─────────────────────────────────────────────────────────────────────────────
group('4. Scoring');
const strong = (): KachmoLead => {
  const l = clone('111');
  l.research_state = 'QUALIFIED';
  l.decision_maker_name = 'Test Person';
  l.decision_maker_title = 'Founder & CEO';
  l.commercial_validation_signal = 'YC W24, Seed. Clients include Nike, Apple, BBC; award-winning; 1,200+ reviews across 15+ locations';
  l.observable_friction = 'Slow legacy WordPress site with a third-party iframe booking widget; lacks an interactive 3D walkthrough';
  l.trigger_event = null;
  l.research_completeness_score = 30;
  return l;
};
{
  const s0 = calculateLeadScores(strong());
  assert(s0.priority === 'A+', 'an exceptional prospect with no trigger reaches A+', s0);
  const none = strong();
  none.trigger_event = 'NO_CLEAR_TRIGGER';
  const trig = strong();
  trig.trigger_event = 'Raised Series A';
  trig.trigger_source = 'https://example.com/news';
  assert(calculateLeadScores(none).kachmoScore === s0.kachmoScore && calculateLeadScores(trig).kachmoScore === s0.kachmoScore, 'trigger presence/absence never changes kachmo_score');
  assert(calculateLeadScores(trig).intentTriggerScore === 100 && calculateLeadScores(none).intentTriggerScore === 0, 'urgency is tracked separately');
  assert(s0.priorityConfidence === 'PROVISIONAL', 'high score + 30% research = PROVISIONAL');
  const researched = strong();
  researched.research_completeness_score = 80;
  assert(calculateLeadScores(researched).kachmoScore === s0.kachmoScore && calculateLeadScores(researched).priorityConfidence === 'CONFIRMED', 'research completeness does not change the commercial score');
  const noContact = strong();
  noContact.decision_maker_phone = null;
  noContact.decision_maker_email = null;
  assert(calculateLeadScores(noContact).kachmoScore === s0.kachmoScore, 'contact availability does not inflate the commercial score');
  const low = strong();
  low.budget_probability = 'LOW';
  assert(calculateLeadScores(strong()).kachmoScore! > calculateLeadScores(low).kachmoScore!, 'UNKNOWN budget is excluded, not scored as low');
  const decoy = strong();
  decoy.commercial_validation_signal = 'Bicycle psychology interpretation practice in a small town';
  assert(!calculateLeadScores(decoy).signals.includes('commercial:funding'), 'keyword matching uses word boundaries ("yc" is not in "bicycle")');
  assert(leads.every(l => l.kachmo_score === null || (l.kachmo_score >= 0 && l.kachmo_score <= 100)), 'all scores within 0–100');
  assert(leads.every(l => l.score_basis?.startsWith('HEURISTIC')), 'every score is labelled heuristic');
}

// ─────────────────────────────────────────────────────────────────────────────
group('5. Research completeness');
assert(leads.every(l => l.research_completeness_score < 60), 'unsourced legacy data never counts as well researched (< 60%)', Math.max(...leads.map(l => l.research_completeness_score)));
{
  const before = lead('050').research_completeness_score;
  quiet(() => recordResearch(['--lead=050', '--field=commercial-source', '--source=https://example.com/case-study', '--by=DEV']));
  quiet(qualifyLeads);
  assert(lead('050').research_completeness_score > before, 'recording a source raises research completeness');
}

// ─────────────────────────────────────────────────────────────────────────────
group('6. Research queue');
{
  let rq = quiet(generateResearchQueue).items;
  assert(rq.length > 0 && rq.every(i => i.specific_research_tasks.length > 0 && i.specific_research_tasks.every(t => t.evidence_needed && t.record_with.includes(`--lead=${i.target_number}`))), 'every task says what evidence to find and how to record it');
  assert(rq.find(i => i.target_number === '111')?.specific_research_tasks.some(t => t.field === 'phone_source'), 'an unverified phone produces a "find the phone source" task');
  const file = safeReadJson<any[]>(paths().researchQueue, []);
  file[0].status = 'IN_PROGRESS';
  safeWriteJson(paths().researchQueue, file);
  rq = quiet(generateResearchQueue).items;
  assert(rq.find(i => i.lead_id === file[0].lead_id)?.status === 'IN_PROGRESS', 'task status survives regeneration');
}

// ─────────────────────────────────────────────────────────────────────────────
group('7. Calling queue');
{
  let cq = quiet(generateCallingQueue);
  assert(cq.cards.length === 0, 'no call cards while every phone is UNVERIFIED', cq.cards.map(c => c.target_number));
  assert(cq.excluded.some(x => x.target_number === '111' && /UNVERIFIED/.test(x.reason)), 'exclusion reason explains the provenance gap');
  for (const tn of ['111', '112', '113', '114']) {
    quiet(() => recordResearch([`--lead=${tn}`, '--field=phone', '--status=PUBLICLY_LISTED', `--source=https://example.com/${tn}/contact`, '--by=AADI']));
  }
  quiet(refreshLeads);
  cq = quiet(generateCallingQueue);
  assert(['111', '112', '113', '114'].every(tn => cq.cards.some(c => c.target_number === tn)), 'sourced phones enter the calling queue');
  const all = loadLeads();
  const sup = loadSuppression();
  assert(cq.cards.every(c => { const l = all.find(x => x.lead_id === c.lead_id)!; return phoneEligibility(l).ok && !outreachBlock(l, sup).blocked; }), 'every call card satisfies calling eligibility');
  assert(cq.cards.every(c => all.filter(o => o.lead_id !== c.lead_id && o.company_name.length >= 6).every(o => !`${c.recommended_opening} ${c.bridge}`.includes(o.company_name))), 'no call card mentions another company');
  const templates = ['scripts/queue-calls.ts', 'scripts/queue-whatsapp.ts', 'core/queues/calls.ts', 'core/queues/whatsapp.ts'].map(f => readFileSync(join(REPO, f), 'utf-8')).join('\n');
  assert(!/Advani|Sunita|Akshay|Royal Heritage|Bombay Shirt/.test(templates), 'no hard-coded prospect names in templates');

  assert(/No lead matches/.test(errorOf(() => logCallOutcome(['--lead=999', '--outcome=INTERESTED'])) ?? ''), 'calls:log fails on a nonexistent lead');
  assert(/Invalid --outcome/.test(errorOf(() => logCallOutcome(['--lead=111', '--outcome=BANANA'])) ?? ''), 'calls:log rejects unknown outcomes');
  assert(/no phone/.test(errorOf(() => logCallOutcome(['--lead=001', '--outcome=NO_ANSWER'])) ?? ''), 'calls:log refuses a lead with no phone');
  assert(/Usage/.test(errorOf(() => logCallOutcome([])) ?? ''), 'calls:log with no arguments fails with usage');
  assert(/Unknown option/.test(errorOf(() => logCallOutcome(['--lead=111', '--outcome=NO_ANSWER', '--oops=1'])) ?? ''), 'calls:log rejects unknown options');

  quiet(() => logCallOutcome(['--lead=111', '--outcome=NO_ANSWER']));
  assert(!quiet(generateCallingQueue).cards.some(c => c.target_number === '111'), 'a lead called in the last 20h is not re-queued');
  quiet(() => logCallOutcome(['--lead=111', '--outcome=INTERESTED', '--whatsapp-ok', '--confirmed-identity', '--notes=budget=5L approx', '--objection-category=TIMING']));
  const l111 = lead('111');
  assert(l111.call_attempts?.length === 2 && l111.notes?.includes('budget=5L approx'), 'call attempts append; notes containing "=" are preserved');
  assert(l111.phone_status === 'VERIFIED' && !!l111.phone_verification_basis, '--confirmed-identity records a verification basis');
  quiet(() => logCallOutcome(['--lead=112', '--outcome=MEETING_BOOKED']));
  assert(lead('112').meeting_status === 'BOOKED' && !quiet(generateCallingQueue).cards.some(c => c.target_number === '112'), 'MEETING_BOOKED records the meeting and leaves the cold-call queue');
}

// ─────────────────────────────────────────────────────────────────────────────
group('8. WhatsApp (human review only)');
{
  const wq = quiet(generateWhatsAppQueue);
  assert(!wq.items.some(i => i.target_number === '113'), 'a sourced phone without a WhatsApp basis is not queued');
  assert(wq.items.find(i => i.target_number === '111')?.status === 'PENDING_HUMAN_REVIEW', 'permission given on a call queues a draft for human review');
  assert(wq.items.every(i => i.word_count >= 25 && i.word_count <= 75 && /(STOP|won't follow up)/.test(i.message_draft)), 'drafts are 25–75 words and include an opt-out line');
  assert(!readFileSync('WHATSAPP_QUEUE.md', 'utf-8').includes('wa.me/'), 'no chat link before human approval');
  assert(/APPROVED/.test(errorOf(() => logWhatsApp(['--lead=111', '--status=SENT'])) ?? ''), 'cannot mark SENT before APPROVED');
  quiet(() => logWhatsApp(['--lead=111', '--status=APPROVED', '--by=DEV']));
  quiet(generateWhatsAppQueue);
  assert(readFileSync('WHATSAPP_QUEUE.md', 'utf-8').includes('wa.me/919983317271'), 'an approved draft gets a click-to-chat link (a human sends it)');
  quiet(() => logWhatsApp(['--lead=111', '--status=SENT', '--by=AADI']));
  assert(!quiet(generateWhatsAppQueue).items.some(i => i.target_number === '111'), 'a sent message leaves the queue');
  assert(/already SENT/.test(errorOf(() => logWhatsApp(['--lead=111', '--status=SENT'])) ?? ''), 'a duplicate SENT is refused');
}

// ─────────────────────────────────────────────────────────────────────────────
group('9. Suppression across channels');
{
  assert(quiet(generateCallingQueue).cards.some(c => c.target_number === '114'), '(setup) 114 is callable');
  quiet(() => suppressContact(['--email=Amit.Sood@TheTivoliHotels.COM', '--reason=Replied unsubscribe']));
  assert(!quiet(generateCallingQueue).cards.some(c => c.target_number === '114'), 'an email opt-out (different casing) blocks calls');
  assert(lead('114').research_state === 'DISQUALIFIED' && lead('114').do_not_contact === true, 'the suppressed lead is flagged do_not_contact and DISQUALIFIED');
  quiet(refreshLeads);
  assert(lead('114').research_state === 'DISQUALIFIED', 're-running the pipeline never un-suppresses a lead');
  assert(!quiet(generateResearchQueue).items.some(i => i.target_number === '114'), 'a suppressed lead leaves the research queue');
  assert(/suppressed/.test(errorOf(() => logPipeline(['--lead=114', '--stage=MEETING_BOOKED', '--channel=EMAIL'])) ?? ''), 'cannot book a meeting with a suppressed lead');

  const t = clone('111');
  const entry = (e: object) => [{ reason: 'x', suppressed_at: '', source: 't', ...e }];
  assert(checkSuppression(t, entry({ phone: '0091-99833-17271' })).suppressed, 'phone suppression matches across formats');
  assert(checkSuppression(t, entry({ domain: 'https://www.RoyalHeritageHaveli.com/contact' })).suppressed, 'domain suppression matches www/https/case variants');
  assert(!checkSuppression(t, entry({ domain: 'gmail.com' })).suppressed, 'a freemail domain never suppresses unrelated people');
  assert(outreachBlock(t, [], 'REPLIED_NO').blocked, 'REPLIED_NO in the email ledger blocks every channel');

  quiet(() => logCallOutcome(['--lead=113', '--outcome=DO_NOT_CONTACT']));
  quiet(() => logCallOutcome(['--lead=113', '--outcome=DO_NOT_CONTACT']));
  assert(loadSuppression().filter(e => e.target_number === '113').length === 1, 'DO_NOT_CONTACT logged twice creates one suppression entry');
  quiet(refreshLeads);
  assert(lead('113').research_state === 'DISQUALIFIED', 'DO_NOT_CONTACT survives re-qualification (regression)');

  renameSync(paths().suppression, `${paths().suppression}.bak`);
  assert(/Suppression list missing/.test(errorOf(generateCallingQueue) ?? ''), 'a missing suppression list fails closed');
  renameSync(`${paths().suppression}.bak`, paths().suppression);
  const raw = readFileSync(paths().suppression, 'utf-8');
  writeFileSync(paths().suppression, '{bad');
  assert(/not valid JSON/.test(errorOf(generateWhatsAppQueue) ?? ''), 'a corrupt suppression list fails closed');
  writeFileSync(paths().suppression, raw);
}

// ─────────────────────────────────────────────────────────────────────────────
group('10. Safe I/O, backups, event log');
{
  const dbRaw = readFileSync(paths().leads, 'utf-8');
  writeFileSync(paths().leads, '{bad');
  assert(errorOf(qualifyLeads) !== null && readFileSync(paths().leads, 'utf-8') === '{bad', 'a corrupt lead DB aborts instead of being overwritten with [] (regression)');
  writeFileSync(paths().leads, dbRaw);
  assert(/shrink/.test(errorOf(() => saveLeads(loadLeads().slice(1))) ?? ''), 'saving fewer leads than on disk is refused');
  const inv = loadLeads();
  const x = inv.find(l => l.target_number === '051')!;
  x.phone_status = 'PUBLICLY_LISTED';
  x.decision_maker_phone = '+44 20 7946 0000';
  x.phone_source = null;
  assert(/invariant/.test(errorOf(() => saveLeads(inv)) ?? ''), 'a PUBLICLY_LISTED phone without a source cannot be saved');
  assert(/source URL/.test(errorOf(() => recordResearch(['--lead=051', '--field=phone', '--value=+44 20 7946 0000', '--status=PUBLICLY_LISTED'])) ?? ''), 'leads:record requires a source URL for PUBLICLY_LISTED');
  const bdir = join(W, 'prune-test');
  mkdirSync(bdir);
  for (let i = 1; i <= 5; i++) writeFileSync(join(bdir, `kachmo_leads_2026-01-0${i}.json`), '[]');
  pruneBackups(bdir, 'kachmo_leads_', 2);
  assert(readdirSync(bdir).length === 2 && readdirSync(bdir).includes('kachmo_leads_2026-01-05.json'), 'backup retention keeps the newest N');
  assert(readdirSync(paths().backups).filter(f => f.startsWith('kachmo_leads_')).length <= 30, 'lead backups are capped at 30');
  writeFileSync(join(W, 't.jsonl'), '{"a":1}\n{"a":2}\n{"a":');
  assert(quiet(() => readJsonl(join(W, 't.jsonl'))).length === 2, 'a truncated final event line is tolerated');
  writeFileSync(join(W, 't2.jsonl'), '{"a":1}\n{bad\n{"a":2}\n');
  assert(errorOf(() => readJsonl(join(W, 't2.jsonl'))) !== null, 'corruption inside the event log is reported');
  assert(!readdirSync(join(W, 'database')).some(f => f.startsWith('.tmp_')), 'atomic writes leave no temp files');
}

// ─────────────────────────────────────────────────────────────────────────────
group('11. Sales state machine');
{
  assert(/meeting/i.test(errorOf(() => logPipeline(['--lead=050', '--stage=PROPOSAL_SENT'])) ?? ''), 'PROPOSAL_SENT without a meeting is refused');
  assert(/proposal/i.test(errorOf(() => logPipeline(['--lead=050', '--stage=WON'])) ?? ''), 'WON without a proposal is refused');
  assert(/reason/i.test(errorOf(() => logPipeline(['--lead=050', '--stage=LOST'])) ?? ''), 'LOST requires a reason');
  assert(/channel/i.test(errorOf(() => logPipeline(['--lead=050', '--stage=MEETING_BOOKED'])) ?? ''), 'MEETING_BOOKED requires channel attribution');
  for (const a of [['--stage=MEETING_BOOKED', '--channel=EMAIL'], ['--stage=MEETING_DONE'], ['--stage=PROPOSAL_SENT', '--value=$4,000'], ['--stage=WON', '--value=$4,000']]) {
    quiet(() => logPipeline(['--lead=050', ...a]));
  }
  assert(lead('050').deal_stage === 'WON', 'meeting → proposal → won is accepted');
  assert(/closed/i.test(errorOf(() => logPipeline(['--lead=050', '--stage=LOST', '--reason=BUDGET'])) ?? ''), 'a closed deal cannot be re-closed');
  const bad = loadLeads();
  bad.find(l => l.target_number === '051')!.whatsapp_outreach_status = 'SENT';
  assert(/invariant/.test(errorOf(() => saveLeads(bad)) ?? ''), 'WhatsApp SENT without a basis cannot be persisted');
  const events = readJsonl<any>(paths().events);
  assert(events.some(e => e.event_type === 'DEAL_WON' && e.payload.archetype_id), 'won deals are recorded with attribution');
  assert(!events.some(e => /\+\d|\d{10}/.test(JSON.stringify(e.payload))), 'event payloads contain no phone numbers');
}

// ─────────────────────────────────────────────────────────────────────────────
group('12. Deduplication (non-destructive)');
{
  const base = clone('051');
  const mk = (tn: string, patch: Partial<KachmoLead>): KachmoLead => ({ ...JSON.parse(JSON.stringify(base)), lead_id: `dup-${tn}`, target_number: tn, ...patch });
  const fixture = [
    mk('900', { company_name: 'Ashby Works', website_url: 'https://www.dupe-example.com/', decision_maker_email: 'info@shared.com', decision_maker_phone: null }),
    mk('901', { company_name: 'Other Name', website_url: 'http://dupe-example.com', decision_maker_email: 'info@shared.com', decision_maker_phone: null }),
    mk('902', { company_name: 'Studio Ashby', website_url: 'https://studioashby-a.com', decision_maker_email: 'hello@shared2.com', decision_maker_phone: null }),
    mk('903', { company_name: 'Ashby Design', website_url: 'https://ashbydesign-b.com', decision_maker_email: 'hello@shared2.com', decision_maker_phone: null }),
    mk('904', { company_name: 'Phone Co A', website_url: 'https://pa-example.com', decision_maker_email: null, decision_maker_phone: '+91 98765 43210' }),
    mk('905', { company_name: 'Phone Co B', website_url: 'https://pb-example.com', decision_maker_email: null, decision_maker_phone: '098765-43210' }),
  ];
  const dups = findDuplicates(fixture);
  assert(dups.some(d => d.target_number === '901' && d.duplicate_of === '900'), 'the same domain across www/http variants is flagged');
  assert(!dups.some(d => ['902', '903'].includes(d.target_number)), 'similar names and shared generic mailboxes are not treated as duplicates');
  assert(dups.some(d => d.target_number === '905' && d.duplicate_of === '904'), 'the same phone in different formats is flagged');
  const count = loadLeads().length;
  quiet(() => deduplicateLeads(true));
  assert(loadLeads().length === count, 'dedupe --apply never deletes leads');
}

// ─────────────────────────────────────────────────────────────────────────────
group('13. Email subsystem boundaries');
{
  const protectedScripts = ['send-titan-smtp.ts', 'create-titan-drafts.ts', 'cron-dispatch.ts'];
  const v2Files = [...listTs(join(REPO, 'scripts')), ...listTs(join(REPO, 'core'))].filter(f => !protectedScripts.some(p => f.endsWith(join('scripts', p))) && !f.endsWith('run-tests.ts') && !f.includes(join('__tests__', 'golden')) && !f.endsWith('golden-v1.ts'));
  const mailers = v2Files.filter(f => /from ['"](nodemailer|imapflow)['"]|require\(['"](nodemailer|imapflow)['"]\)|createTransport\(|\.sendMail\(|\.append\(/i.test(readFileSync(f, 'utf-8')));
  assert(mailers.length === 0, 'no second email pipeline in V2 code', mailers);
  const network = v2Files.filter(f => /\bfetch\(|https?\.request|axios|twilio|graph\.facebook\.com|puppeteer|playwright|whatsapp-web/i.test(readFileSync(f, 'utf-8')));
  assert(network.length === 0, 'V2 makes no network calls (no automated WhatsApp/email sender)', network);
  assert(/protected/.test(errorOf(() => exportLeadsToCsv(resolve('kachmo_targets.csv'))) ?? ''), 'CSV export refuses to overwrite kachmo_targets.csv');
  const rows = [...parseTracker(join(REPO, 'OUTREACH_TRACKER.md')).values()];
  assert(rows.filter(r => r.status === 'SENT').length >= 20, 'tracker parser reads sent emails');
  assert(rows.filter(r => r.batch === 'batch6' && r.phone).length === 10, 'tracker parser reads Batch 6 phones');
  for (const f of ['kachmo_targets.csv', 'OUTREACH_TRACKER.md', 'scheduled-queue.json']) {
    assert(sha(join(W, f)) === sha(join(REPO, f)), `the whole workflow never wrote its copy of ${f}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
group('14. War room & analytics');
{
  // Fixed fixture: the real queue changes whenever the cron runs, so tests must not depend on its contents.
  const fixture = (targetNumber: string, to: string, companyName: string) => ({
    to, subject: 'test', plainText: 'test', htmlContent: '<p>test</p>', targetNumber, companyName,
    locationCity: 'San Francisco', locationCountry: 'United States', confidence: 'HIGH',
  });
  writeFileSync('scheduled-queue.json', JSON.stringify([fixture('101', 'studio@spin.co.uk', 'Spin'), fixture('106', 'yonghee@cuckoo.so', 'Cuckoo'), fixture('108', 'daksh@greptile.com', 'Greptile')], null, 2));
  writeFileSync(
    'OUTREACH_TRACKER.md',
    readFileSync('OUTREACH_TRACKER.md', 'utf-8').split('\n').map(line => (line.startsWith('| **106**') ? line.replace('**SCHEDULED**', '**SENT**') : line)).join('\n')
  );
  const sup = quiet(() => suppressContact(['--email=daksh@greptile.com', '--reason=test opt-out']));
  assert(sup.scheduledConflicts.includes('108'), 'suppress:add warns when the recipient is still in scheduled-queue.json');
  const wr = quiet(runWarRoom);
  assert(wr.alerts.some(a => a.includes('Duplicate-send risk') && a.includes('106')), 'war room flags a scheduled email the tracker already marks SENT');
  assert(wr.alerts.some(a => a.includes('Suppressed recipient') && a.includes('108')), 'war room flags a suppressed recipient still in the production email queue');
  const rep = quiet(generateWeeklyReport);
  assert(rep.conversion_probability === 'UNKNOWN', 'the weekly report never estimates conversion probability');
  assert([...rep.conversions, ...rep.channels.flatMap(c => [c.responded, c.positive])].every(c => c.n >= 20 || !c.display.includes('%')), 'no percentages for samples under 20');
}

// ─────────────────────────────────────────────────────────────────────────────
group('15. Migration re-run preserves human data');
{
  const before = loadLeads();
  quiet(() => runMigration({ force: true }));
  const after = loadLeads();
  const byTn = (ls: KachmoLead[], tn: string) => ls.find(l => l.target_number === tn)!;
  assert(after.length === before.length && before.every(b => byTn(after, b.target_number).lead_id === b.lead_id), '--force keeps every lead_id');
  assert(byTn(after, '111').call_attempts?.length === 2 && byTn(after, '111').phone_status === 'VERIFIED' && byTn(after, '111').whatsapp_outreach_status === 'SENT', 'call history, verified phone and WhatsApp state survive re-migration');
  assert(byTn(after, '113').do_not_contact === true && byTn(after, '050').deal_stage === 'WON', 'opt-outs and won deals survive re-migration');
  quiet(refreshLeads);
  assert(lead('113').research_state === 'DISQUALIFIED' && findInvariantViolations(loadLeads()).length === 0, 'the pipeline after re-migration is consistent');
}

// ─────────────────────────────────────────────────────────────────────────────
group('17. Outreach template safety (rendered with a synthetic prospect)');
{
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rows = parseCsv(readFileSync(join(REPO, 'kachmo_targets.csv'), 'utf-8')).slice(1);
  const forbidden = new Set<string>();
  for (const r of rows) {
    const company = r[3].trim();
    const dm = r[8].trim();
    forbidden.add(company);
    const cw = company.split(/\s+/);
    for (let i = 0; i < cw.length - 1; i++) forbidden.add(`${cw[i]} ${cw[i + 1]}`);
    if (!/founders?|director|principals|proprietor/i.test(dm)) {
      forbidden.add(dm);
      for (const t of dm.split(/\s+/)) if (t.length >= 4 && /^[A-Z][a-z]/.test(t)) forbidden.add(t);
    }
    const domain = r[4].replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
    if (domain.includes('.')) forbidden.add(domain);
  }
  const found = (text: string) => [...forbidden].filter(f => new RegExp(`(^|[^\\w])${esc(f)}([^\\w]|$)`).test(text));
  assert(found('Hi Mr. Advani, we loved Royal Heritage Haveli').length >= 2, '(self-check) the name detector catches the original hard-coded-name bug');

  const CLAIMS = /\b(our clients?|we['’]ve (worked|partnered|built|helped)|we have (worked|partnered|built|helped)|clients? (include|like)|trusted by|award|case stud|guarantee|proven|world[- ]class|leading|best in)\b|\d+\s?%|\b\d+x\b/i;
  const hits: string[] = [];
  let rendered = 0;
  for (const arch of ['1', '2', '3', '4', '5', '6', '9']) {
    for (const basis of ['BUSINESS_LISTED_WHATSAPP', 'PERMISSION_GIVEN_ON_CALL'] as const) {
      const l: KachmoLead = {
        ...clone('051'), archetype_id: arch, archetype_label: `${arch}: Synthetic`, company_name: 'Zyxcorp',
        decision_maker_name: 'Qwerty Asdfgh', decision_maker_title: 'Founder', website_url: 'https://zyxcorp.invalid',
        observable_friction: 'Zfriction sentence for testing only.', kachmo_solution_angle: 'Zangle sentence for testing only.',
        commercial_validation_signal: 'Zsignal sentence for testing only.', location_city: 'Zcity', location_country: 'India', whatsapp_basis: basis,
      };
      const card = buildCallCard(l);
      const draft = buildWhatsAppDraft(l);
      const outreach = [card.recommended_opening, card.bridge, card.call_objective, ...card.discovery_questions, ...card.objections.flatMap(o => [o.objection, o.response]), draft].join('\n');
      const everything = `${outreach}\n${card.what_not_to_say.join('\n')}\n${card.verify_before_call.join('\n')}`;
      rendered++;
      hits.push(...found(everything).map(f => `arch ${arch}/${basis}: name "${f}"`));
      if (/https?:\/\/(?!zyxcorp\.invalid)|www\./i.test(everything)) hits.push(`arch ${arch}: hard-coded URL`);
      const claim = outreach.match(CLAIMS);
      if (claim) hits.push(`arch ${arch}: claim "${claim[0]}"`);
      if (!outreach.includes('Zyxcorp') || !draft.includes('zangle')) hits.push(`arch ${arch}: template ignores the lead's own data`);
    }
  }
  assert(rendered === 14 && hits.length === 0, 'every call card and WhatsApp draft (all archetypes, both bases) has no real prospect names, domains, URLs or Kachmo claims', hits.slice(0, 6));
  const src = ['scripts/queue-calls.ts', 'scripts/queue-whatsapp.ts', 'scripts/lib/text.ts', 'core/queues/calls.ts', 'core/queues/whatsapp.ts', 'core/util/text.ts'].map(f => readFileSync(join(REPO, f), 'utf-8')).join('\n');
  assert(found(src).length === 0, 'template source files contain no real prospect names or domains', found(src).slice(0, 5));
  assert(!/https?:\/\/(?!wa\.me\/)/.test(src), 'template source files contain no hard-coded URLs except wa.me');
}

// ─────────────────────────────────────────────────────────────────────────────
group('18. DO_NOT_CONTACT cannot be reversed by the system');
{
  const tn = '115';
  quiet(() => recordResearch([`--lead=${tn}`, '--field=phone', '--status=PUBLICLY_LISTED', '--source=https://example.com/115/contact', '--by=AADI']));
  quiet(() => recordResearch([`--lead=${tn}`, '--field=whatsapp-basis', '--value=BUSINESS_LISTED_WHATSAPP', '--source=https://example.com/115/whatsapp']));
  quiet(refreshLeads);
  assert(quiet(generateCallingQueue).cards.some(c => c.target_number === tn) && quiet(generateWhatsAppQueue).items.some(i => i.target_number === tn), '(setup) 115 is callable and WhatsApp-queued');
  quiet(() => logCallOutcome([`--lead=${tn}`, '--outcome=DO_NOT_CONTACT']));

  const holds = (after: string, channelCleared = false) => {
    const l = lead(tn);
    const state = { dnc: l.do_not_contact, research: l.research_state, priority: l.lead_priority, channel: l.recommended_channel };
    const ok =
      l.do_not_contact === true && l.research_state === 'DISQUALIFIED' && l.lead_priority === 'DISQUALIFIED' &&
      (!channelCleared || l.recommended_channel === null) &&
      !quiet(generateCallingQueue).cards.some(c => c.target_number === tn) &&
      !quiet(generateWhatsAppQueue).items.some(i => i.target_number === tn) &&
      !quiet(generateResearchQueue).items.some(i => i.target_number === tn);
    assert(ok, `DO_NOT_CONTACT holds after ${after} (excluded from call, WhatsApp and research queues)`, state);
  };
  holds('calls:log');
  quiet(qualifyLeads);
  holds('re-qualification');
  quiet(scoreLeads);
  holds('re-scoring');
  quiet(evaluateOpportunities);
  holds('opportunity analysis', true);
  quiet(() => runMigration({ force: true }));
  holds('re-migration from the CSV');
  quiet(refreshLeads);
  holds('re-migration + full refresh', true);
  quiet(() => recordResearch([`--lead=${tn}`, '--field=phone', '--status=VERIFIED', '--basis=confirmed again', '--by=AADI']));
  quiet(refreshLeads);
  holds('recording a newly verified phone', true);

  const tampered = loadLeads();
  const t = tampered.find(l => l.target_number === tn)!;
  t.research_state = 'QUALIFIED';
  t.lead_priority = 'A';
  assert(/invariant/.test(errorOf(() => saveLeads(tampered)) ?? ''), 'no code path can persist a DO_NOT_CONTACT lead as QUALIFIED');
  assert(/suppressed/.test(errorOf(() => logWhatsApp([`--lead=${tn}`, '--status=APPROVED'])) ?? ''), 'WhatsApp approval is refused');
  assert(/suppressed/.test(errorOf(() => logPipeline([`--lead=${tn}`, '--stage=MEETING_BOOKED', '--channel=CALL'])) ?? ''), 'meeting booking is refused');
  assert(!quiet(runWarRoom).dev.next_email_candidates.some(c => c.startsWith(tn)), 'never proposed as an email candidate');

  const supRaw = readFileSync(paths().suppression, 'utf-8');
  writeFileSync(paths().suppression, JSON.stringify(loadSuppression().filter(e => e.target_number !== tn)));
  quiet(refreshLeads);
  holds('its suppression-list entry is deleted (the lead flag still blocks)', true);
  writeFileSync(paths().suppression, supRaw);

  const sq = JSON.parse(readFileSync('scheduled-queue.json', 'utf-8'));
  sq.push({ ...sq[0], targetNumber: tn, to: 'someone@sunitashekhawat.com', companyName: lead(tn).company_name });
  writeFileSync('scheduled-queue.json', JSON.stringify(sq, null, 2));
  assert(checkEmailQueue().issues.some(i => i.kind === 'SUPPRESSED' && i.target_number === tn && i.blocking), 'the email pre-dispatch check blocks it in scheduled-queue.json');
}

// ─────────────────────────────────────────────────────────────────────────────
group('19. Contact provenance matrix');
{
  const today = '2026-09-14';
  const callable = (patch: Partial<KachmoLead>) =>
    callEligibility(
      { ...clone('116'), research_state: 'QUALIFIED', call_attempts: [], meeting_status: null, proposal_status: null, deal_stage: null, response_status: null, do_not_contact: false, decision_maker_phone: '+91 95134 46201', phone_source: null, phone_verification_basis: null, ...patch },
      [], null, today
    ).ok;
  assert(!callable({ phone_status: 'UNKNOWN' }), 'UNKNOWN phone → never callable');
  assert(!callable({ phone_status: 'INFERRED' }), 'INFERRED phone → never callable');
  assert(!callable({ phone_status: 'INFERRED', phone_source: 'https://example.com/guess' }), 'INFERRED phone with a URL → still never callable');
  assert(!callable({ phone_status: 'UNVERIFIED' }), 'UNVERIFIED phone → never callable');
  assert(!callable({ phone_status: 'INVALID', phone_source: 'https://example.com' }), 'INVALID phone → never callable');
  assert(!callable({ phone_status: 'PUBLICLY_LISTED' }), 'PUBLICLY_LISTED without a source → not callable');
  assert(!callable({ phone_status: 'PUBLICLY_LISTED', phone_source: 'their website' }), 'PUBLICLY_LISTED with a non-URL source → not callable');
  assert(callable({ phone_status: 'PUBLICLY_LISTED', phone_source: 'https://example.com/contact' }), 'PUBLICLY_LISTED with a source URL → callable');
  assert(!callable({ phone_status: 'VERIFIED' }), 'VERIFIED without a basis → not callable');
  assert(callable({ phone_status: 'VERIFIED', phone_verification_basis: 'answered and confirmed identity' }), 'VERIFIED with a basis → callable');
  assert(/source URL/.test(errorOf(() => recordResearch(['--lead=116', '--field=phone', '--status=PUBLICLY_LISTED'])) ?? ''), 'leads:record refuses PUBLICLY_LISTED without a source');
  assert(/basis/.test(errorOf(() => recordResearch(['--lead=116', '--field=phone', '--status=VERIFIED'])) ?? ''), 'leads:record refuses VERIFIED without a basis');

  for (const st of ['UNKNOWN', 'INFERRED', 'UNVERIFIED'] as const) {
    const l: KachmoLead = { ...clone('112'), decision_maker_email: 'drrinkykapoor@gmail.com', email_status: st, decision_maker_phone: null, phone_status: 'UNKNOWN', do_not_contact: false };
    const r = evaluateLeadGates(l);
    assert(emailRoute(l).quality !== 'DIRECT' && r.gates.gate_2_contactability !== 'PASS' && r.state === 'RESEARCH_REQUIRED', `${st} Gmail address → never a decision-maker contact`);
  }

  const wa = (patch: Partial<KachmoLead>) =>
    whatsappEligibility({ ...clone('116'), decision_maker_phone: '+91 95134 46201', phone_status: 'PUBLICLY_LISTED', phone_source: 'https://example.com/contact', whatsapp_basis: null, whatsapp_basis_source: null, ...patch }).ok;
  assert(!wa({}), 'sourced phone without a WhatsApp basis → not WhatsApp-eligible');
  assert(!wa({ whatsapp_basis: 'BUSINESS_LISTED_WHATSAPP' }), 'BUSINESS_LISTED_WHATSAPP without a URL → not eligible');
  assert(wa({ whatsapp_basis: 'BUSINESS_LISTED_WHATSAPP', whatsapp_basis_source: 'https://example.com/wa' }), 'BUSINESS_LISTED_WHATSAPP with a URL → eligible');
  assert(!wa({ whatsapp_basis: 'PERMISSION_GIVEN_ON_CALL' }), 'PERMISSION_GIVEN_ON_CALL without a note → not eligible');
  for (const st of ['UNKNOWN', 'INFERRED', 'UNVERIFIED', 'INVALID'] as const) {
    assert(!wa({ phone_status: st, whatsapp_basis: 'PERMISSION_GIVEN_ON_CALL', whatsapp_basis_source: 'call 2026-09-14' }), `${st} phone + WhatsApp basis → not eligible`);
  }
  assert(/source/.test(errorOf(() => recordResearch(['--lead=116', '--field=whatsapp-basis', '--value=BUSINESS_LISTED_WHATSAPP'])) ?? ''), 'leads:record refuses a business-listed WhatsApp without a source');

  quiet(() => recordResearch(['--lead=117', '--field=phone', '--status=PUBLICLY_LISTED', '--source=https://example.com/117/contact', '--by=AADI']));
  quiet(refreshLeads);
  const all = loadLeads();
  const ok = new Set(['PUBLICLY_LISTED', 'VERIFIED']);
  const cq = quiet(generateCallingQueue);
  const wq = quiet(generateWhatsAppQueue);
  assert(cq.cards.length > 0 && cq.cards.every(c => ok.has(all.find(l => l.lead_id === c.lead_id)!.phone_status)) && wq.items.every(i => ok.has(all.find(l => l.lead_id === i.lead_id)!.phone_status)), 'generated call and WhatsApp queues contain only PUBLICLY_LISTED/VERIFIED phones');
}

// ─────────────────────────────────────────────────────────────────────────────
group('20. Data recovery (fail closed, never auto-repair)');
{
  const good = readFileSync(paths().leads, 'utf-8');
  const arr = JSON.parse(good);
  const backupsBefore = readdirSync(paths().backups).length;
  const mustFail = (name: string, content: string, fn: () => unknown, re: RegExp) => {
    writeFileSync(paths().leads, content);
    const err = errorOf(fn);
    assert(err !== null && re.test(err) && readFileSync(paths().leads, 'utf-8') === content, `${name} → refused, file left exactly as found`, err);
    writeFileSync(paths().leads, good);
  };
  mustFail('empty lead file', '', qualifyLeads, /not valid JSON/);
  mustFail('lead file that is not an array', '{"a":1}', scoreLeads, /not a JSON array/);
  mustFail('null record', JSON.stringify([...arr.slice(0, 3), null]), generateCallingQueue, /malformed/);
  mustFail('record missing company_name', JSON.stringify(arr.map((l: any, i: number) => (i === 5 ? { ...l, company_name: undefined } : l))), evaluateOpportunities, /company_name/);
  mustFail('record with invalid phone_status', JSON.stringify(arr.map((l: any, i: number) => (i === 5 ? { ...l, phone_status: 'MAYBE' } : l))), runWarRoom, /phone_status/);
  mustFail('duplicate target_number', JSON.stringify([...arr, arr[0]]), generateResearchQueue, /Duplicate/);
  assert(readdirSync(paths().backups).length === backupsBefore, 'no backup was created or restored automatically during failures');

  const sup = readFileSync(paths().suppression, 'utf-8');
  for (const [name, content] of [['empty suppression file', ''], ['suppression entry that is a bare string', '["foo@example.com"]'], ['suppression entry with no identifier', '[{"reason":"x","suppressed_at":"","source":"t"}]']] as const) {
    writeFileSync(paths().suppression, content);
    const err = errorOf(generateCallingQueue);
    assert(err !== null && readFileSync(paths().suppression, 'utf-8') === content, `${name} → queues refuse to build, file untouched`, err);
  }
  writeFileSync(paths().suppression, sup);

  const tmp = join(dirname(paths().leads), '.tmp_99999_crash.json');
  writeFileSync(tmp, good.slice(0, 500));
  assert(errorOf(qualifyLeads) === null && existsSync(tmp) && loadLeads().length === arr.length, 'a half-written temp file from a crashed write is ignored; the database is intact');
  rmSync(tmp);
  const before = sha(paths().leads);
  assert(errorOf(() => safeWriteJson(paths().leads, { n: BigInt(1) })) !== null && sha(paths().leads) === before, 'a write that fails mid-serialisation leaves the original untouched');
  const inv = loadLeads();
  inv[0].deal_stage = 'WON';
  assert(errorOf(() => saveLeads(inv)) !== null && sha(paths().leads) === before, 'a rejected save writes nothing');
}

// ─────────────────────────────────────────────────────────────────────────────
group('21. Concurrent modification guard');
{
  const a = loadLeads();
  const b = loadLeads();
  a.find(l => l.target_number === '051')!.notes = 'written by command A';
  quiet(() => saveLeads(a));
  b.find(l => l.target_number === '051')!.notes = 'stale command B';
  const err = errorOf(() => saveLeads(b));
  assert(/modified by another command/.test(err ?? '') && lead('051').notes === 'written by command A', 'a command holding a stale copy cannot overwrite a newer save', err);
  const c = loadLeads();
  c.find(l => l.target_number === '051')!.notes = 'fresh';
  saveLeads(c);
  assert(lead('051').notes === 'fresh', 'a normal load → modify → save still works');
}

// ─────────────────────────────────────────────────────────────────────────────
group('22. Idempotency & stale actions');
{
  quiet(refreshLeads);
  const n1 = readJsonl(paths().events).length;
  quiet(refreshLeads);
  assert(readJsonl(paths().events).length === n1, 're-running the pipeline adds no duplicate events');
  assert(JSON.stringify(quiet(generateCallingQueue).cards) === JSON.stringify(quiet(generateCallingQueue).cards), 'calling queue generation is idempotent');
  assert(JSON.stringify(quiet(generateWhatsAppQueue).items) === JSON.stringify(quiet(generateWhatsAppQueue).items), 'WhatsApp queue generation is idempotent');
  const strip = (xs: any[]) => JSON.stringify(xs.map(({ updated_at, ...r }) => r));
  assert(strip(quiet(generateResearchQueue).items) === strip(quiet(generateResearchQueue).items), 'research queue generation is idempotent (status and created_at kept)');
  assert(JSON.stringify(quiet(runWarRoom).alerts) === JSON.stringify(quiet(runWarRoom).alerts), 'war room alerts are stable across runs');

  const warn = warnings(() => logCallOutcome(['--lead=111', '--outcome=NO_ANSWER']));
  assert(/was not in today's call queue/.test(warn), 'logging a call for a lead not in today’s queue warns (stale call sheet)', warn);
  const aged = loadLeads();
  const l111 = aged.find(l => l.target_number === '111')!;
  for (const at of l111.call_attempts!) at.at = '2026-01-01T00:00:00.000Z';
  l111.next_action_date = null;
  saveLeads(aged);
  assert(!quiet(generateCallingQueue).cards.some(c => c.target_number === '111'), 'a stray NO_ANSWER after INTERESTED never puts the lead back into cold calling');

  process.env.KACHMO_TODAY = '2026-09-20';
  try {
    assert(quiet(runWarRoom).dev.email_follow_ups_due.some(x => x.startsWith('001')), '(setup) 001 email follow-up is due');
    quiet(() => logPipeline(['--lead=001', '--stage=FOLLOW_UP_SENT']));
    assert(!quiet(runWarRoom).dev.email_follow_ups_due.some(x => x.startsWith('001')), 'a logged follow-up disappears from the next war room');
    assert(/already sent/.test(errorOf(() => logPipeline(['--lead=001', '--stage=FOLLOW_UP_SENT'])) ?? ''), 'a second bump is refused (single-bump protocol)');
    assert(/does not show a sent email/.test(errorOf(() => logPipeline(['--lead=116', '--stage=FOLLOW_UP_SENT'])) ?? ''), 'a follow-up cannot be logged for a lead never emailed');
  } finally {
    delete process.env.KACHMO_TODAY;
  }

  const sq = JSON.parse(readFileSync('scheduled-queue.json', 'utf-8'));
  sq.push({ ...sq[0] });
  writeFileSync('scheduled-queue.json', JSON.stringify(sq, null, 2));
  const eq = checkEmailQueue();
  assert(eq.issues.some(i => i.kind === 'DUPLICATE_ENTRY' && i.target_number === sq[0].targetNumber), 'a duplicated scheduled email is flagged');
  assert(eq.issues.some(i => i.kind === 'ALREADY_SENT' && i.target_number === '106'), 'a scheduled email already marked SENT is flagged');

  const md = ['RESEARCH_QUEUE.md', 'AADI_DAILY_CALLS.md', 'DAILY_WAR_ROOM.md'].map(f => readFileSync(f, 'utf-8')).join('\n');
  assert(!/(^|[\s|(])(A\+|A|B|C)\s\d{1,3}\b/.test(md) && !/\/100\b/.test(md), 'operator files show tier + signals, not a precise 0–100 score');
}

// ─────────────────────────────────────────────────────────────────────────────
group('24. Production email dispatcher safety boundary (dry-run only, no SMTP possible)');
{
  const D = newWorkspace(['OUTREACH_TRACKER.md']);
  const payload = (targetNumber: string, to: string) => ({
    to, subject: 'test', plainText: 'test', htmlContent: '<p>test</p>', targetNumber, companyName: `Test ${targetNumber}`,
    locationCity: 'London', locationCountry: 'United Kingdom', confidence: 'HIGH',
  });
  writeFileSync(join(D, 'scheduled-queue.json'), JSON.stringify([
    payload('901', 'ok@normal.example'),
    payload('902', 'person@blocked.example'),
    payload('903', 'anyone@blockeddomain.example'),
    payload('904', 'x@target-suppressed.example'),
    payload('106', 'yonghee@cuckoo.so'), // marked SENT in OUTREACH_TRACKER.md by the cron on 2026-09-14
  ], null, 2));
  const goodSup = JSON.stringify([
    { email: 'Person@Blocked.example', reason: 'opt-out', suppressed_at: '2026-09-15', source: 'test' },
    { domain: 'https://www.blockeddomain.example/', reason: 'company opt-out', suppressed_at: '2026-09-15', source: 'test' },
    { target_number: '904', reason: 'DNC', suppressed_at: '2026-09-15', source: 'test' },
  ]);
  const runs: Array<{ queueUnchanged: boolean }> = [];
  const dispatch = (sup: string | null, args: string[]) => {
    if (!args.includes('--dry-run')) throw new Error('The test suite must never run the dispatcher without --dry-run.');
    const supPath = join(D, 'database/suppression.json');
    if (sup === null) rmSync(supPath, { force: true });
    else writeFileSync(supPath, sup);
    const before = sha(join(D, 'scheduled-queue.json'));
    const r = spawnSync(process.execPath, [join(REPO, 'node_modules/tsx/dist/cli.mjs'), join(REPO, 'scripts/cron-dispatch.ts'), ...args], {
      cwd: D,
      encoding: 'utf-8',
      timeout: 60000,
      // Belt and braces: no password and an unreachable SMTP host, so even a bug could not send.
      env: { ...process.env, TITAN_PASSWORD: '', TITAN_EMAIL: 'nobody@invalid.example', TITAN_SMTP_HOST: '127.0.0.1', TITAN_SMTP_PORT: '9' },
    });
    const result = { code: r.status, out: `${r.stdout}\n${r.stderr}`, queueUnchanged: sha(join(D, 'scheduled-queue.json')) === before };
    runs.push(result);
    return result;
  };
  const listed = (out: string, tn: string) => new RegExp(`#${tn} to `).test(out);

  const forced = dispatch(goodSup, ['--dry-run', '--force']);
  assert(forced.code === 0 && listed(forced.out, '901'), '1. a normal scheduled recipient remains eligible', forced.out.slice(-800));
  assert(
    ['902', '903', '904'].every(tn => !listed(forced.out, tn) && new RegExp(`#${tn} .*suppressed`).test(forced.out)),
    '2. suppressed recipients (email in any case, company domain, target number) are blocked'
  );
  assert(!listed(forced.out, '106') && /#106 .*already sent/.test(forced.out), '3. a recipient already SENT in OUTREACH_TRACKER.md is blocked');
  const missing = dispatch(null, ['--dry-run', '--force']);
  assert(missing.code !== 0 && /suppression/i.test(missing.out) && !/#\d{3} to /.test(missing.out), '4. missing suppression file → exits non-zero before listing anything', missing.out.slice(-400));
  for (const [name, content] of [['invalid JSON', '{bad'], ['empty file', ''], ['not an array', '{}'], ['bare string entry', '["person@blocked.example"]'], ['entry without identifier', '[{"reason":"x"}]']] as const) {
    const r = dispatch(content, ['--dry-run', '--force']);
    assert(r.code !== 0 && !/#\d{3} to /.test(r.out), `5. malformed suppression file (${name}) → fails closed`, r.out.slice(-300));
  }
  assert(forced.code === 0 && ['902', '903', '904', '106'].every(tn => !listed(forced.out, tn)), '6. --force does not bypass suppression or the already-sent check');
  const unforced = dispatch(goodSup, ['--dry-run']);
  assert(unforced.code === 0 && ['902', '903', '904', '106'].every(tn => !listed(unforced.out, tn) && new RegExp(`#${tn} .*(suppressed|already sent)`).test(unforced.out)), '   …and the same recipients are blocked without --force');
  assert(runs.length === 8 && runs.every(r => r.queueUnchanged), '7. scheduled-queue.json is byte-for-byte unchanged by every safety-check run');

  const git = (...a: string[]) => spawnSync('git', a, { cwd: REPO, encoding: 'utf-8' });
  const patchSha = git('log', '--format=%H', '-1', '--fixed-strings', '--grep=fix: enforce suppression in titan dispatcher', '--', 'scripts/cron-dispatch.ts').stdout.trim();
  const numstat = patchSha ? git('diff', '--numstat', `${patchSha}^`, patchSha, '--', 'scripts/cron-dispatch.ts').stdout.trim().split(/\s+/) : [];
  assert(numstat.length >= 2 && Number(numstat[0]) > 0 && numstat[1] === '0', 'the committed dispatcher patch only adds lines; no existing production line was removed or edited', { patchSha, numstat });
  const sinceApproved = patchSha ? git('diff', '-U0', patchSha, '--', 'scripts/cron-dispatch.ts').stdout.split('\n').filter(l => /^[+-](?![+-])/.test(l)) : ['<no patch commit>'];
  assert(
    sinceApproved.length === 0 || (sinceApproved.length === 2 && sinceApproved[0] === '-      rejectUnauthorized: false,' && sinceApproved[1] === '+      rejectUnauthorized: true,'),
    'since the approved suppression patch, the only dispatcher change is the approved TLS certificate-verification fix (Phase 1.1)',
    sinceApproved
  );
  assert(
    readFileSync(join(REPO, 'scripts/cron-dispatch.ts'), 'utf-8').includes(
      "interface EmailPayload {\n  to: string;\n  subject: string;\n  plainText: string;\n  htmlContent: string;\n  targetNumber: string;\n  companyName: string;\n  locationCity: string;\n  locationCountry: string;\n  confidence: 'HIGH' | 'LOW';\n}"
    ),
    'the EmailPayload interface is unchanged'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
group('23. Real repository data (read-only)');
process.chdir(REPO);
{
  const real = loadLeads();
  assert(real.length === parseCsv(readFileSync(paths().csv, 'utf-8')).length - 1, 'the real DB holds one lead per CSV row');
  assert(findInvariantViolations(real).length === 0, 'the real lead DB has no invariant violations', findInvariantViolations(real).slice(0, 3));
  const sup = loadSuppression();
  const tracker = parseTracker(paths().tracker);
  const cq = safeReadJson<any>(paths().callingQueue, { cards: [] });
  assert(Array.isArray(cq.cards) && cq.cards.every((c: any) => { const l = real.find(x => x.lead_id === c.lead_id); return l && phoneEligibility(l).ok && !outreachBlock(l, sup, tracker.get(l.target_number)?.status ?? null).blocked; }), 'the real calling queue only holds eligible, unsuppressed leads');
  const wq = safeReadJson<any>(paths().whatsappQueue, { items: [] });
  assert(Array.isArray(wq.items) && wq.items.every((i: any) => { const l = real.find(x => x.lead_id === i.lead_id); return l && whatsappEligibility(l).ok; }), 'the real WhatsApp queue only holds eligible leads');
}

for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
console.log(`\n${'='.repeat(60)}\nTEST SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
