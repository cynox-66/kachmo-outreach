/**
 * THE OPERATOR REDESIGN — regression tests (ADR-035, ADR-036, audit 2026-09-22).
 *
 * Every translation is pinned to core's own value sets, so a new engine value cannot reach the screen as an identifier;
 * the audit's findings are reproduced against the committed data and must stay fixed:
 *
 *   B1  an unverified claim is never presented as checked
 *   D1  gate labels are keyed by exactly core's gate keys
 *   A1  a scheduled email past its planned date is reported as stuck, not as "queued"
 *   A2  one blocked queue entry is reported as holding ALL automatic email
 *   A3  a planned date is never labelled "sent"
 *   C5  server actions turn an expired session / denied role / failed database into a message, never a thrown page
 *   C6  a malformed id is refused before it reaches the database
 *
 * In-memory Postgres only (PGlite); no network, no hosted database; the repository working tree is read, never written.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_CLAIM_FIELDS } from '@kachmo/core/research/coverage.js';
import { RESEARCH_STATE_VALUES, PROVENANCE_VALUES } from '@kachmo/core/leads/validation.js';
import { EVIDENCE_LEVELS } from '@kachmo/core/research/evidence.js';
import { PIPELINE_STAGES } from '@kachmo/core/state/pipeline.js';
import { CALL_OUTCOMES, type KachmoLead } from '@kachmo/core/leads/schema.js';
import { WHATSAPP_STATUSES } from '@kachmo/core/state/whatsapp.js';
import { RECORDABLE_FIELDS } from '@kachmo/core/state/research-record.js';
import { FIELD_ORDER } from '@kachmo/core/research/tasks.js';
import { EMAIL_SENT_STATUSES } from '@kachmo/core/email-ledger/tracker.js';
import { evaluateLeadGates } from '@kachmo/core/qualification/gates.js';
// Next's framework modules, imported by path: the public 'next/navigation' entry needs the Next bundler.
import { redirect } from 'next/dist/client/components/redirect.js';
import { unstable_rethrow } from 'next/dist/client/components/unstable-rethrow.js';
import { createRehearsalDatabase } from '../server/db/rehearsal-db';
import { loadCanonicalSource } from '../server/db/migration/source';
import { importCanonicalSource } from '../server/db/migration/import';
import { permissionsFor } from '../server/authz/permissions';
import { AuthenticationRequiredError, AuthorizationError, type Actor } from '../server/authz/authorize';
import { METHODOLOGY_V1_0 } from '../server/methodology/v1';
import * as op from '../server/services/operator';
import { presentGate } from '../server/services/presentation';
import { queuePreviewsFromJson } from '../server/repo/titan-ledger';

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
    console.error(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 1200)}` : ''}`);
  }
}
const group = (t: string) => console.log(`\n${t}`);
const RAW_ENUM = /\b[A-Z]{2,}(?:_[A-Z]+)+\b/; // e.g. PUBLICLY_LISTED, NO_ANSWER — an identifier, not a word
const FILE_OR_COMMAND = /OUTREACH_TRACKER|scheduled-queue|\.md\b|npm (run|--prefix)|KACHMO_[A-Z_]+|--[a-z-]+=/;

console.log('\n🗣️  KACHMO OUTBOUND OS — OPERATOR LANGUAGE AND SAFETY');

const POST = { KACHMO_CUTOVER_PHASE: 'POST_CUTOVER', KACHMO_APP_WRITES: 'on', DATABASE_URL: 'postgres://localhost:5432/kachmo_test' };
Object.assign(process.env, POST);

// The live committed data — exactly what was migrated to production (120 leads, the Titan ledger and queue as committed).
const database = await createRehearsalDatabase();
await importCanonicalSource(database.db, loadCanonicalSource(REPO), 'TEST');
(globalThis as unknown as { __kachmoServer?: unknown }).__kachmoServer = { db: database.db, auth: {} };
const { loadCanonical } = await import('../server/repo/canonical');
const snap = await loadCanonical();
const TODAY = '2026-09-22';
const actorWith = (roles: string[], name = 'Dev Jaiswal'): Actor => ({ userId: `u-${roles[0]}`, name, email: `${roles[0]}@kachmo.test`, roles: roles as Actor['roles'], permissions: permissionsFor(roles) });
const owner = actorWith(['OWNER']);
const intern = actorWith(['INTERN'], 'Intern');
const outreach = actorWith(['OUTREACH'], 'Aadi');

// ─────────────────────────────────────────────────────────────────────────────
group('1. Every engine value has an operator label (no identifier can reach the screen)');
{
  const coreGates = Object.keys(GATE_CLAIM_FIELDS).sort();
  assert(JSON.stringify(Object.keys(op.GATE_LABELS).sort()) === JSON.stringify(coreGates), 'D1: gate labels are keyed by exactly core’s gate keys', { labels: Object.keys(op.GATE_LABELS), core: coreGates });
  const lead = snap.leads[0];
  const emitted = Object.keys(evaluateLeadGates(lead, snap.suppression, null).gates);
  assert(emitted.every(g => presentGate(g) === op.GATE_LABELS[g as keyof typeof op.GATE_LABELS]), 'D1: every gate core emits is shown with its label, never as an identifier', emitted.map(g => presentGate(g)));
  assert(METHODOLOGY_V1_0.config.gateOutcomes.every(o => op.GATE_OUTCOME_LABELS[o as keyof typeof op.GATE_OUTCOME_LABELS]?.label), 'every gate outcome has a label');
  assert([...RESEARCH_STATE_VALUES].every(s => op.RESEARCH_STATE_LABELS[s as keyof typeof op.RESEARCH_STATE_LABELS]), 'every research state has a label');
  assert([...PROVENANCE_VALUES].every(p => op.PROVENANCE_LABELS[p as keyof typeof op.PROVENANCE_LABELS]?.label), 'every contact provenance has a label');
  assert(Object.entries(op.PROVENANCE_LABELS).every(([k, v]) => v.usable === (k === 'PUBLICLY_LISTED' || k === 'VERIFIED')), 'only published-by-them and confirmed-by-us are labelled usable (core OUTREACH_USABLE)');
  assert(EVIDENCE_LEVELS.every(l => op.EVIDENCE_LEVEL_LABELS[l]), 'every evidence level has a label');
  const appStages = PIPELINE_STAGES.filter(s => s !== 'FOLLOW_UP_SENT');
  assert(appStages.every(s => op.STAGE_CHOICES[s]) && Object.keys(op.STAGE_CHOICES).every(s => (appStages as readonly string[]).includes(s)), 'every stage the app may record is offered, and nothing else');
  assert(!op.STAGE_CHOICES.FOLLOW_UP_SENT, 'the email follow-up stage is never offered: Titan records it (ADR-019)');
  assert(CALL_OUTCOMES.every(o => op.CALL_OUTCOME_CHOICES[o]) && Object.keys(op.CALL_OUTCOME_CHOICES).length === CALL_OUTCOMES.length, 'every call outcome has a label and a consequence');
  assert(WHATSAPP_STATUSES.every(s => op.WHATSAPP_CHOICES[s]), 'every WhatsApp step has a label and a consequence');
  assert(RECORDABLE_FIELDS.every(f => op.RESEARCH_CHOICES[f]) && Object.keys(op.RESEARCH_CHOICES).every(f => (RECORDABLE_FIELDS as readonly string[]).includes(f)), 'every recordable research field is offered, and nothing invented');
  assert(FIELD_ORDER.every(f => op.RESEARCH_TASK_LABELS[f]), 'every research task core can raise has a plain description');
  const ledgerStatuses = new Set([...snap.tracker.values()].map(r => r.status));
  assert([...ledgerStatuses, ...EMAIL_SENT_STATUSES].every(s => op.LEDGER_STATUS_LABELS[s]), 'every email-record status in use (and every sent status core knows) has a label', [...ledgerStatuses].filter(s => !op.LEDGER_STATUS_LABELS[s]));
  const eventTypes = [...readFileSync(join(REPO, 'core/leads/schema.ts'), 'utf-8').match(/export type EventType =([\s\S]*?);/)![1].matchAll(/'([A-Z_]+)'/g)].map(m => m[1]);
  assert(eventTypes.length > 15 && eventTypes.every(t => op.knownEventKinds().includes(t)), 'every domain event type has a history label', eventTypes.filter(t => !op.knownEventKinds().includes(t)));
  const choices = [op.STAGE_CHOICES, op.CALL_OUTCOME_CHOICES, op.WHATSAPP_CHOICES].flatMap(m => Object.values(m).flatMap(c => [c.label, c.consequence]));
  assert(choices.every(t => !RAW_ENUM.test(t) && !FILE_OR_COMMAND.test(t)), 'no choice or consequence is written in identifiers, file names or commands');
  const stops = Object.entries({ ...op.CALL_OUTCOME_CHOICES, ...op.WHATSAPP_CHOICES }).filter(([, c]) => 'stop' in c && c.stop).map(([k]) => k);
  assert(JSON.stringify(stops.sort()) === JSON.stringify(['DO_NOT_CONTACT', 'OPT_OUT']), 'exactly the two opt-out choices are marked as stops', stops);
}

// ─────────────────────────────────────────────────────────────────────────────
group('2. B1 — research is never stated more strongly than the evidence (all 120 leads)');
{
  assert(op.verificationFor('UNVERIFIED') === 'UNSOURCED' && op.verificationFor('PENDING') === 'UNSOURCED', 'a claim with no source is "No source"');
  assert(op.verificationFor('PASS') === 'SOURCED', 'PASS means a source is recorded — never "checked": nobody opened it');
  assert(op.verificationFor('PASS', { level: 'SUPPORTED', contradicted: false }) === 'CHECKED', 'only a person-checked source is "Checked"');
  assert(op.verificationFor('PASS', { level: 'SUPPORTED', contradicted: true }) === 'CONTRADICTED', 'a contradiction outranks a check');
  assert(op.verificationFor('UNVERIFIED', { level: 'RETRIEVED', contradicted: false }) === 'FETCHED', 'a fetched page nobody read is "fetched, not checked"');
  let claims = 0;
  const wrong: string[] = [];
  for (const lead of snap.leads) {
    const gates = evaluateLeadGates(lead, snap.suppression, snap.tracker.get(lead.target_number)?.status ?? null).gates;
    for (const c of op.whyClaims(lead, gates, null)) {
      claims++;
      if (c.verification === 'CHECKED') wrong.push(`${lead.target_number}:${c.key} checked without evidence`);
      if (gates[c.gate] === 'UNVERIFIED' && c.verification !== 'UNSOURCED') wrong.push(`${lead.target_number}:${c.key} unverified shown as ${c.verification}`);
    }
  }
  assert(claims > 100 && wrong.length === 0, `no claim is overstated across ${claims} claims on the committed leads`, wrong.slice(0, 5));
  const l101 = snap.leads.find(l => l.target_number === '101')!;
  const c101 = op.whyClaims(l101, evaluateLeadGates(l101, snap.suppression, 'SCHEDULED').gates, null);
  assert(c101.some(c => c.key === 'commercial' && c.verification === 'UNSOURCED'), 'lead 101’s client list (“BBC, Nike, Apple…”) is shown as unsourced, not as fact');
  assert(op.whyClaims({ ...l101, commercial_validation_signal: '  ', observable_friction: '', why_now: null, trigger_event: 'NO_CLEAR_TRIGGER' } as KachmoLead, evaluateLeadGates(l101, [], null).gates, null).length === 0, 'an empty field is research to do, never a claim');
}

// ─────────────────────────────────────────────────────────────────────────────
group('3. A3 — a planned email is never labelled sent');
{
  const planned = op.emailDates({ status: 'SCHEDULED', sent_date: '2026-09-15', follow_up_due: '2026-09-18' }, TODAY);
  assert(planned.kind === 'PLANNED' && planned.date === '2026-09-15' && planned.followUpDue === null, 'a SCHEDULED row’s date is the plan, and it has no follow-up yet');
  assert(planned.late && planned.lateDays === 7, 'and a plan in the past is late (7 days on 22 Sep)');
  const drafted = op.emailDates({ status: 'DRAFTED', sent_date: '2026-09-10', follow_up_due: null }, TODAY);
  assert(drafted.kind === 'PLANNED' && !drafted.late, 'a draft is never "late" (nothing is scheduled to send it)');
  const sent = op.emailDates({ status: 'SENT', sent_date: '2026-09-11', follow_up_due: '2026-09-14' }, TODAY);
  assert(sent.kind === 'SENT' && sent.followUpDue === '2026-09-14', 'a SENT row’s date is the send');
  const queued = snap.scheduled.map(s => op.emailDates(snap.tracker.get(s.targetNumber), TODAY));
  assert(queued.length === 5 && queued.every(d => d.kind === 'PLANNED' && d.late), 'the five held emails (101–105) read as planned and late, not as sent', queued);
}

// ─────────────────────────────────────────────────────────────────────────────
group('4. Company status: one label, one sentence, from stored facts');
{
  const base = snap.leads.find(l => l.research_state === 'RESEARCH_REQUIRED')!;
  const s = (lead: KachmoLead, ledger: { status: string; sent_date: string | null; follow_up_due: string | null } | null, blocked = false, queued = false) =>
    op.operatorStatus({ lead, ledger, blocked: { blocked, reason: blocked ? 'OUTREACH_TRACKER.md status is REPLIED_NO' : null }, queued, today: TODAY });
  assert(s(base, { status: 'SENT', sent_date: '2026-09-11', follow_up_due: '2026-09-14' }, true).key === 'DO_NOT_CONTACT', 'a blocked company is "Do not contact" whatever else is true');
  assert(s(base, null, true).sentence === 'They replied no to our email.', 'and the reason is said in words, not as a field statement');
  assert(s(base, { status: 'SCHEDULED', sent_date: '2026-09-15', follow_up_due: null }, false, true).key === 'SCHEDULED_LATE', 'a scheduled email past its date is "not sent yet", not "scheduled"');
  assert(s(base, { status: 'SENT', sent_date: '2026-09-11', follow_up_due: '2026-09-14' }).key === 'FOLLOW_UP_DUE', 'a sent email with its follow-up due says so');
  assert(s({ ...base, email_follow_up_sent_at: '2026-09-15T10:00:00Z' }, { status: 'SENT', sent_date: '2026-09-11', follow_up_due: '2026-09-14' }).key === 'FOLLOWED_UP', 'once the one follow-up is sent, no second is asked for');
  assert(s({ ...base, research_state: 'OUTREACH_READY' }, null).key === 'READY', 'a ready company with no email yet is "Ready to contact"');
  assert(s(base, null).key === 'NEEDS_RESEARCH', 'otherwise it needs research');
  assert(s({ ...base, response_status: 'REPLIED_POSITIVE' }, { status: 'SENT', sent_date: '2026-09-11', follow_up_due: '2026-09-14' }).key === 'INTERESTED', 'a recorded reply outranks the email ledger');
  const { listLeads } = await import('../server/services/leads');
  const all = await listLeads({ pageSize: 200 }, snap);
  assert(all.rows.every(r => r.status.label && !RAW_ENUM.test(r.status.label) && !RAW_ENUM.test(r.status.sentence) && !FILE_OR_COMMAND.test(r.status.sentence)), 'every one of the 120 companies has a status in words', all.rows.filter(r => RAW_ENUM.test(r.status.sentence)).map(r => r.status.sentence).slice(0, 3));
  const scheduled = await listLeads({ status: 'SCHEDULED_ANY', pageSize: 200 }, snap);
  assert(scheduled.rows.length >= 5 && scheduled.rows.every(r => ['SCHEDULED', 'SCHEDULED_LATE', 'DRAFTED'].includes(r.status.key)), 'the status filter returns exactly what it names');
  assert(all.rows.every(r => !/Titan|OUTREACH_TRACKER|GitHub Actions|Research: [a-z_]+$/.test(r.nextAction ?? '')), 'no next step in the list is engine-speak', all.rows.map(r => r.nextAction).filter(a => /Titan|Research: /.test(a ?? '')).slice(0, 3));
  const attention = await listLeads({ sort: 'attention', pageSize: 200 }, snap);
  const tones = attention.rows.map(r => r.status.tone);
  assert(tones.indexOf('act') === 0 || !tones.includes('act'), 'the default order puts what needs someone first');
}

// ─────────────────────────────────────────────────────────────────────────────
group('5. Today speaks plainly, and never offers to send');
{
  const { getToday } = await import('../server/services/today');
  const today = await getToday(owner, { mine: false, snapshot: snap });
  assert(today.items.length > 0, 'the committed data has work for today', today.items.length);
  const words = today.items.flatMap(i => [i.line.what, i.line.sentence, i.line.action]);
  assert(words.every(w => !FILE_OR_COMMAND.test(w) && !/\b[a-z]+_[a-z_]+\b/.test(w)), 'no work line contains a file name, a field name or a command', words.filter(w => FILE_OR_COMMAND.test(w) || /\b[a-z]+_[a-z_]+\b/.test(w)).slice(0, 3));
  assert(today.items.every(i => !/\bsend\b/i.test(i.line.action)), 'no button offers to send: the app sends nothing');
  const follow = today.items.find(i => i.kind === 'EMAIL_FOLLOW_UP_DUE');
  assert(!!follow && /^Emailed .+\. The one follow-up was due .+ \(\d+ days ago\)\. Send it from the studio inbox\.$/.test(follow.line.sentence), 'a follow-up says when we emailed, when it was due, how late, and where to send it', follow?.line.sentence);
  assert(today.byUrgency.now + today.byUrgency.today + today.byUrgency.later === today.items.length, 'every item is in exactly one urgency group');
}

// ─────────────────────────────────────────────────────────────────────────────
group('6. A1 / A2 — the email sender’s real state (committed data, 22 Sep)');
{
  const { senderStatus } = await import('../server/services/sender');
  const s = senderStatus(snap, owner, TODAY);
  assert(s.state === 'STUCK', 'A1: with all five held past their plan, the sender is reported STUCK — not "5 queued"', s.state);
  assert(s.queued.length === 5 && s.queued.every(q => q.late && q.lateDays === 7), 'each held email carries its plan and how late it is');
  assert(s.headline === `5 scheduled emails have not gone out. The oldest was planned for ${op.dayLabel('2026-09-15')} (7 days ago).`, 'the headline says it in words', s.headline);
  assert(s.queued.every(q => q.subject && q.body.length > 50), 'the preview shows what will be sent: subject and plain-text body');
  const held = senderStatus({ ...snap, suppression: [...snap.suppression, { target_number: '103', reason: 'asked not to be contacted', suppressed_at: '2026-09-22T00:00:00Z', source: 'test' }] }, owner, TODAY);
  assert(held.state === 'ON_HOLD', 'A2: one do-not-contact entry on a queued company puts the whole sender ON HOLD', held.state);
  assert(held.hold.length === 1 && held.hold[0].targetNumber === '103' && /still in the automatic queue/.test(held.hold[0].reason), 'and names the company holding it', held.hold);
  assert(held.explanation.some(e => /other queued emails wait/.test(e)), 'and says the other emails wait too', held.explanation);
  const masked = senderStatus(snap, intern, TODAY);
  const real = s.queued.map(q => q.to);
  assert(masked.queued.every((q, i) => !q.toVisible && q.to !== real[i] && !q.body.includes(real[i])), 'for a role without contact access, recipients are masked — in the header and in the body');
  const empty = senderStatus({ ...snap, previews: [], scheduled: [], titanRaw: { tracker: snap.titanRaw?.tracker ?? null, queue: '[]' } }, owner, TODAY);
  assert(empty.state === 'IDLE' && /Nothing is scheduled/.test(empty.headline), 'an empty queue is "nothing scheduled"');
}

// ─────────────────────────────────────────────────────────────────────────────
group('7. The queue preview is display-only');
{
  const previews = queuePreviewsFromJson(JSON.parse(readFileSync(join(REPO, 'scheduled-queue.json'), 'utf-8')));
  assert(previews.length === 5 && previews.every(p => !('htmlContent' in p) && !('htmlContent' in (p as unknown as Record<string, unknown>))), 'the HTML part is never read into the app');
  assert(queuePreviewsFromJson({ not: 'an array' }).length === 0 && queuePreviewsFromJson([{ subject: 42, plainText: null }])[0].subject === '', 'malformed queue content is left out, not trusted');
  assert(queuePreviewsFromJson([{ plainText: 'x'.repeat(50_000) }])[0].plainText.length === 20_000, 'a preview is bounded');
}

// ─────────────────────────────────────────────────────────────────────────────
group('8. Refusals and results are translated at the boundary (core wording unchanged)');
{
  const cli = [
    '--stage=REPLIED_POSITIVE requires --channel (for channel attribution).',
    '--callback-date must be YYYY-MM-DD',
    '--whatsapp-ok needs a connected call where they agreed to WhatsApp.',
    '--field=email requires --status=UNKNOWN|INFERRED|UNVERIFIED|PUBLICLY_LISTED|VERIFIED|INVALID',
    'PUBLICLY_LISTED requires --source=<the https source URL where it is published>',
    'VERIFIED requires --basis="how it was verified"',
    '--field=decision-maker requires --source=<url showing the person and role>',
    '--source must be a full http(s) URL, got "ftp://x"',
    '101 is suppressed (email match — asked). Do not send.',
    'That lead changed since you opened it (version 3 → 4). Reload and check before acting again.',
    'Your account is not bound to an engine actor (DEV or AADI), so it cannot change leads. Ask an owner to run `npm --prefix os run actor:bind`.',
    'Application writes are switched off (KACHMO_APP_WRITES is not "on"). Nothing was written.',
    'Not permitted: lead.approve.',
    '101: follow-up already sent on 2026-09-15 (single-bump protocol).',
  ];
  const out = cli.map(op.humanizeRefusal);
  assert(out.every(t => t && !FILE_OR_COMMAND.test(t) && !RAW_ENUM.test(t)), 'no refusal an operator sees contains a flag, a command, a variable or an identifier', out.filter(t => FILE_OR_COMMAND.test(t) || RAW_ENUM.test(t)));
  assert(/changed since you opened it/.test(out[9]) && /nothing was saved/i.test(out[9]), 'a stale write says what happened and that nothing was saved');
  const ok = [
    'Recorded decision-maker for 101 Spin. Run "npm run leads:refresh" to re-qualify and re-score.',
    '101 Spin: NO_ANSWER. Next: Retry call (2026-09-24)',
    '101 Spin: REPLIED_POSITIVE. Next: Book a meeting',
    '101 Spin: WhatsApp APPROVED',
    'Suppression recorded; 1 lead(s) flagged do-not-contact (103). It is recorded in Postgres. Titan dispatch stays blocked until the next workflow run publishes and verifies it. Still queued for email: 103 — the dispatch preflight will refuse to send them.',
  ].map(op.humanizeSuccess);
  assert(ok.every(t => !/npm run|leads:refresh/.test(t) && !RAW_ENUM.test(t)), 'no success message tells an operator to run a command or shows an identifier', ok);
  assert(/on hold for everyone/.test(ok[4]), 'a do-not-contact on a queued company says automatic email is now on hold for everyone');
  assert(op.humanizeExclusion('phone provenance is UNVERIFIED; needs PUBLICLY_LISTED (source URL) or VERIFIED (basis)') === 'The number’s source is unknown — record where they publish it.', 'queue exclusions are translated too');
}

// ─────────────────────────────────────────────────────────────────────────────
group('9. C5 / C6 — server actions never throw at an operator; malformed ids never reach the database');
{
  const { makeGuarded, isUuid, SIGNED_OUT_MESSAGE, NOT_PERMITTED_MESSAGE, UNCONFIRMED_MESSAGE } = await import('../server/auth/action-guard-core');
  const guarded = makeGuarded(unstable_rethrow);
  assert(/export const guarded = makeGuarded\(unstable_rethrow\)/.test(readFileSync(join(OS, 'server/auth/action-guard.ts'), 'utf-8')), 'the runtime guard is exactly this logic, bound to Next’s own rethrow');
  const quiet = console.error;
  console.error = () => {};
  type S = { error: string | null };
  const signedOut = await guarded<S>(async () => {
    throw new AuthenticationRequiredError();
  });
  const denied = await guarded<S>(async () => {
    throw new AuthorizationError('lead.approve');
  });
  const dbDown = await guarded<S>(async () => {
    throw new Error('connect ECONNREFUSED 10.0.0.1:5432');
  });
  console.error = quiet;
  assert(signedOut.error === SIGNED_OUT_MESSAGE && /nothing was saved/i.test(signedOut.error ?? ''), 'an expired session is a message that nothing was saved, not a crashed page');
  assert(denied.error === NOT_PERMITTED_MESSAGE, 'a denied role is a message');
  assert(dbDown.error === UNCONFIRMED_MESSAGE && /Reload the page to see whether it was saved/.test(dbDown.error ?? ''), 'a database failure says the outcome is uncertain and to check before retrying');
  assert(!JSON.stringify(dbDown).includes('ECONNREFUSED'), 'the internal error is never shown to the operator');
  let rethrown = false;
  try {
    await guarded(async () => redirect('/research/briefs'));
  } catch (e) {
    rethrown = /NEXT_REDIRECT/.test(String((e as { digest?: string }).digest ?? e));
  }
  assert(rethrown, 'Next’s own control flow (a redirect after creating a brief) passes through untouched');
  assert(isUuid('dd365e3c-8d4f-4b76-90ae-e933302095ca') && !isUuid('not-a-uuid') && !isUuid("'; drop table lead; --") && !isUuid(undefined), 'a UUID is checked before any query');
  const src = (f: string) => readFileSync(join(OS, f), 'utf-8');
  assert(/if \(!isUuid\(id\)\) notFound\(\)/.test(src('app/(app)/research/candidates/[id]/page.tsx')), 'C6: a malformed suggestion id is a 404, not a database error');
  assert(/isUuid\(candidateId\)/.test(src('server/research/actions.ts')) && /isUuid\(mergeInto\)/.test(src('server/research/actions.ts')), 'C6: the review action checks both ids before any query');
  assert(/isUuid\(openId\)/.test(src('app/(app)/research/briefs/page.tsx')), 'C6: a malformed brief id is never queried');
}

// ─────────────────────────────────────────────────────────────────────────────
group('10. The company page: history includes the email; engine noise is on request');
{
  const { getLeadTimeline } = await import('../server/services/timeline');
  const l101 = snap.leads.find(l => l.target_number === '101')!;
  const t101 = await getLeadTimeline(l101, 200, { ledger: snap.tracker.get('101'), today: TODAY });
  const email = t101.find(e => e.kind === 'EMAIL_SCHEDULED');
  assert(!!email && email.at === '2026-09-15' && /not sent yet \(7 days late\)/.test(email.summary ?? ''), 'the scheduled email is in the history, marked late', email);
  assert(t101.filter(e => e.kind === 'QUALIFICATION_CHANGED').every(e => e.system), 'engine re-checks are system entries, shown only on request');
  const l007 = snap.leads.find(l => l.target_number === '007')!;
  const t007 = await getLeadTimeline(l007, 200, { ledger: snap.tracker.get('007'), today: TODAY });
  assert(t007.some(e => e.kind === 'EMAIL_SENT' && e.at === '2026-09-11' && !e.system), 'a sent email is in the history, dated');
  assert(t007.every(e => !JSON.stringify(e).includes(l007.decision_maker_email ?? '@@none@@')), 'no contact value appears in the history');

  const { getCompany } = await import('../server/services/company');
  const c101 = await getCompany('101', owner, snap, TODAY);
  assert(c101?.status.key === 'SCHEDULED_LATE' && c101.email.queued?.late === true, 'company 101 shows its scheduled email as late, with the email itself');
  assert(!!c101?.email.queued?.subject && c101.claims.every(c => c.verification !== 'CHECKED'), 'the preview has a subject, and no claim is shown as checked');
  const asIntern = await getCompany('101', intern, snap, TODAY);
  assert(asIntern?.email.queued === null && asIntern.routes.every(r => !r.value || !r.value.includes('@spin.co.uk')), 'an intern sees neither the email preview nor a contact value');
  const asOutreach = await getCompany('101', outreach, snap, TODAY);
  assert(!!asOutreach?.email.queued, 'the outreach role sees what will be sent');
  const missing = await getCompany('999', owner, snap, TODAY);
  assert(missing === null, 'an unknown company is not found');
}

// ─────────────────────────────────────────────────────────────────────────────
group('11. The forms cannot be submitted by accident');
{
  const read = (f: string) => readFileSync(join(OS, f), 'utf-8');
  const forms = read('app/(app)/components/LeadActions.tsx');
  const review = read('app/(app)/research/candidates/[id]/review-form.tsx');
  assert(!/defaultValue="(NO_ANSWER|REPLIED_POSITIVE|APPROVED|ACCEPT|SUPPORTS)"/.test(forms + review + read('app/(app)/components/EvidenceReview.tsx')), 'C1: no consequential choice is preselected anywhere');
  assert((forms.match(/<option value="" disabled>/g) ?? []).length >= 8 && /<option value="" disabled>/.test(review), 'every consequential select starts on an empty, unselectable "Choose…"');
  assert(!/<form action=\{/.test(forms + review + read('app/(app)/components/EvidenceReview.tsx') + read('app/(app)/research/upload/form.tsx') + read('app/(app)/research/briefs/form.tsx') + read('app/login/login-form.tsx')), 'no form is a form action (React resets those before they run — a refusal would wipe what was typed)');
  assert(/if \(state\.ok\) return <Recorded/.test(forms), 'C2: a successful record replaces the form; recording again is a deliberate click');
  assert(/name="confirm" value="yes"/.test(forms) && /field\(form, 'confirm'\) !== 'yes'/.test(read('server/leads/actions.ts')), 'C3: do-not-contact needs an explicit confirmation, and the server refuses one without it');
  assert(/name="confirm" value="yes" required/.test(review) && /decision === 'ACCEPT' && str\(form, 'confirm', 8\) !== 'yes'/.test(read('server/research/actions.ts')), 'adding a suggested company needs an explicit confirmation, enforced by the server');
  assert(/initialKind !== 'dnc'/.test(forms), 'a link can never open the do-not-contact form by itself');
}

// ─────────────────────────────────────────────────────────────────────────────
group('12. The error screens recover, and say nothing an operator cannot use');
{
  const read = (f: string) => readFileSync(join(OS, f), 'utf-8');
  const pageError = read('app/(app)/error.tsx');
  const globalError = read('app/global-error.tsx');
  const notFound = read('app/(app)/not-found.tsx');

  // Found in the browser: with the database stopped and then restarted, a plain `reset()` left the error on screen,
  // because it re-renders the boundary against the cached failed payload. The retry has to refetch the server render.
  assert(/router\.refresh\(\)/.test(pageError) && /startRetry\(/.test(pageError), 'C5: "Try again" refetches the server render — reset() alone replays the cached failure');
  assert(/useTransition/.test(pageError) && /disabled=\{retrying\}/.test(pageError), 'C5: the retry says it is working and cannot be clicked twice');
  const globalHandler = globalError.match(/onClick=\{[^}]*\}/)?.[0] ?? '';
  assert(/window\.location\.reload\(\)/.test(globalHandler) && !/reset/.test(globalHandler), 'C5: the root boundary reloads — the layout that failed has no healthy tree to reset into');

  for (const [name, src] of [['page', pageError], ['root', globalError]] as const) {
    assert(/Nothing was changed\./.test(src), `the ${name} error screen states that nothing was changed`);
    assert(!/error\.message|error\.stack|\{error\}/.test(src), `the ${name} error screen never prints the raw error`);
    assert(/error\.digest/.test(src), `the ${name} error screen gives a reference the owner can find in the logs`);
  }
  assert(!/\b(500|Internal Server Error|Unhandled|Exception)\b/.test(pageError + globalError + notFound), 'no error screen uses a status code or engineering word');
  assert(/href="\/"/.test(pageError) && /href="\//.test(notFound), 'every dead end offers a way back into the app');
}

await database.close();
console.log(`\n${'─'.repeat(60)}\nOPERATOR SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.error('\nFAILED:\n' + failures.map(f => `  • ${f}`).join('\n'));
  process.exit(1);
}
