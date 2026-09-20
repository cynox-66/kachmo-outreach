/**
 * PHASE C — THE OPERATING LOOP.
 *
 * Today's work list, the lead history read model, the in-app research loop and the two operator safety changes,
 * against in-memory PostgreSQL loaded with the pinned golden dataset. No network, no hosted database.
 *
 * The oracle for the work list is the war room: both select work with the same rules in core, so the lists must
 * agree lead for lead over the same data.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import type { KachmoLead } from '@kachmo/core/leads/schema.js';
import { parseTrackerContent } from '@kachmo/core/email-ledger/tracker.js';
import { selectCallQueue } from '@kachmo/core/queues/calls.js';
import { selectWhatsAppQueue } from '@kachmo/core/queues/whatsapp.js';
import { buildResearchQueue, FIELD_ORDER } from '@kachmo/core/research/tasks.js';
import { buildWarRoomSummary } from '@kachmo/core/reports/war-room.js';
import { buildTodayList, compareToday, TODAY_KINDS, type TodayItem } from '@kachmo/core/queues/today.js';
import { decideResearchRecord } from '@kachmo/core/state/research-record.js';
import { RECORDABLE_FIELDS } from '@kachmo/core/state/research-record.js';
import * as schema from '../server/db/schema/index';
import { createRehearsalDatabase } from '../server/db/rehearsal-db';
import { loadCanonicalSource } from '../server/db/migration/source';
import { importCanonicalSource } from '../server/db/migration/import';
import { permissionsFor, ROLES } from '../server/authz/permissions';
import type { Actor } from '../server/authz/authorize';
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
    console.error(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 1200)}` : ''}`);
  }
}
const group = (t: string) => console.log(`\n${t}`);

console.log('\n🗓️  KACHMO OUTBOUND OS — PHASE C OPERATING LOOP');

const POST = { KACHMO_CUTOVER_PHASE: 'POST_CUTOVER', KACHMO_APP_WRITES: 'on', DATABASE_URL: 'postgres://localhost:5432/kachmo_test' };
Object.assign(process.env, POST);

const workspace = goldenWorkspace(REPO);
const source = loadCanonicalSource(workspace);
const tracker = parseTrackerContent(readFileSync(join(workspace, 'OUTREACH_TRACKER.md'), 'utf-8'));
const ledger = (tn: string) => tracker.get(tn)?.status ?? null;
const TODAY = '2026-09-15';

// ─────────────────────────────────────────────────────────────────────────────
group('1. Today selects exactly the work the war room reports (same rules, one definition)');
let items: TodayItem[] = [];
{
  const calls = selectCallQueue(source.leads, source.suppression, ledger, TODAY, Date.parse(`${TODAY}T06:00:00.000Z`));
  const whatsapp = selectWhatsAppQueue(source.leads, source.suppression, ledger);
  const research = buildResearchQueue(source.leads, source.suppression, ledger, new Map(), `${TODAY}T06:00:00.000Z`);
  const war = buildWarRoomSummary({
    today: TODAY,
    generatedAt: `${TODAY}T06:00:00.000Z`,
    leads: source.leads,
    suppression: source.suppression,
    tracker,
    scheduled: [],
    callCards: calls.cards,
    whatsappItems: whatsapp.items,
    researchItems: research,
    alerts: [],
  });
  items = buildTodayList({ today: TODAY, leads: source.leads, suppression: source.suppression, tracker, callCards: calls.cards, whatsappItems: whatsapp.items, researchItems: research });

  const tnsOf = (kind: string) => items.filter(i => i.kind === kind).map(i => i.targetNumber).sort();
  const fromWar = (lines: string[]) => lines.map(l => l.slice(0, 3)).sort();
  assert(JSON.stringify(tnsOf('REPLY_WAITING')) === JSON.stringify(fromWar(war.dev.replies_to_answer)), 'replies waiting match the war room', { today: tnsOf('REPLY_WAITING'), war: fromWar(war.dev.replies_to_answer) });
  assert(JSON.stringify(tnsOf('EMAIL_FOLLOW_UP_DUE')) === JSON.stringify(fromWar(war.dev.email_follow_ups_due)), 'email follow-ups due match the war room');
  assert(JSON.stringify(tnsOf('CALL_READY')) === JSON.stringify(fromWar(war.aadi.calls)), 'calls ready match the war room');
  assert(JSON.stringify(tnsOf('WHATSAPP_TO_SEND')) === JSON.stringify(fromWar(war.aadi.whatsapp_to_send)), 'WhatsApp to send matches the war room');
  assert(JSON.stringify(tnsOf('WHATSAPP_TO_APPROVE')) === JSON.stringify(fromWar(war.aadi.whatsapp_to_approve)), 'WhatsApp to approve matches the war room');
  const warFollowUps = fromWar([...war.aadi.follow_ups_due, ...war.dev.follow_ups_due]);
  assert(JSON.stringify(tnsOf('FOLLOW_UP_DUE')) === JSON.stringify(warFollowUps), 'follow-ups due match the war room (both owners)');
  const warPositive = fromWar(war.dev.positive_without_meeting);
  assert(tnsOf('POSITIVE_NO_MEETING').every(t => warPositive.includes(t)), 'positive-without-meeting is a subset of the war room list (blocked leads are dropped)');
  assert(items.filter(i => i.kind === 'RESEARCH').length === Math.min(10, research.length), 'the research items are the top of core’s research queue');
}

// ─────────────────────────────────────────────────────────────────────────────
group('2. The list is deterministic, honest and safe');
{
  const again = buildTodayList({
    today: TODAY,
    leads: source.leads,
    suppression: source.suppression,
    tracker,
    callCards: selectCallQueue(source.leads, source.suppression, ledger, TODAY, Date.parse(`${TODAY}T06:00:00.000Z`)).cards,
    whatsappItems: selectWhatsAppQueue(source.leads, source.suppression, ledger).items,
    researchItems: buildResearchQueue(source.leads, source.suppression, ledger, new Map(), `${TODAY}T06:00:00.000Z`),
  });
  assert(JSON.stringify(again) === JSON.stringify(items), 'the same state produces exactly the same list');
  const kinds = items.map(i => TODAY_KINDS.indexOf(i.kind));
  assert(kinds.every((k, i) => i === 0 || kinds[i - 1] <= k), 'items are grouped in the declared order of consequence');
  assert([...items].sort(compareToday).every((it, i) => it === items[i]), 'the comparator is the order');
  assert(items.every(i => i.why.length > 0), 'every item says which stored facts put it there');

  // Suppression removes outreach work, in every kind.
  // Whichever lead the list actually carries work for (the pinned dataset has no callable phone, by design).
  const target = source.leads.find(l => items.some(i => i.targetNumber === l.target_number))!;
  const suppressed = [{ target_number: target.target_number, reason: 'opted out', suppressed_at: `${TODAY}T00:00:00.000Z`, source: 'test' }];
  const after = buildTodayList({
    today: TODAY,
    leads: source.leads,
    suppression: suppressed,
    tracker,
    callCards: selectCallQueue(source.leads, suppressed, ledger, TODAY, Date.parse(`${TODAY}T06:00:00.000Z`)).cards,
    whatsappItems: selectWhatsAppQueue(source.leads, suppressed, ledger).items,
    researchItems: buildResearchQueue(source.leads, suppressed, ledger, new Map(), `${TODAY}T06:00:00.000Z`),
  });
  const kindsBefore = [...new Set(items.filter(i => i.targetNumber === target.target_number).map(i => i.kind))];
  assert(!after.some(i => i.targetNumber === target.target_number), `a suppressed lead disappears from the whole list (${target.target_number}: was ${kindsBefore.join(', ')})`);
  assert(items.filter(i => i.where === 'TITAN').every(i => i.kind === 'REPLY_WAITING' || i.kind === 'EMAIL_FOLLOW_UP_DUE'), 'only email work is marked as happening in Titan');
}

// ── Database-backed sections ─────────────────────────────────────────────────
const database = await createRehearsalDatabase();
(globalThis as unknown as { __kachmoServer?: unknown }).__kachmoServer = { db: database.db, auth: {} };
const db = database.db;
await importCanonicalSource(db, source, 'PHASE-C-TEST');
await db.insert(schema.user).values(ROLES.map(r => ({ id: `u-${r.toLowerCase()}`, name: `Test ${r}`, email: `u-${r.toLowerCase()}@kachmo.test` })));
await db.insert(schema.userRole).values(ROLES.map(r => ({ userId: `u-${r.toLowerCase()}`, role: r })));
const { bindEngineActor } = await import('../server/leads/actor-binding');
await bindEngineActor(db, { userEmail: 'u-owner@kachmo.test', engineActor: 'DEV', ownerLabel: 'Dev Jaiswal' });
await bindEngineActor(db, { userEmail: 'u-outreach@kachmo.test', engineActor: 'AADI', ownerLabel: 'Dev Jaiswal' });
const actorWith = (role: string): Actor => ({ userId: `u-${role.toLowerCase()}`, name: `Test ${role}`, email: `u-${role.toLowerCase()}@kachmo.test`, roles: [role] as Actor['roles'], permissions: permissionsFor([role]) });
const owner = actorWith('OWNER');
const { getToday } = await import('../server/services/today');
const { getResearchQueue, recordFieldForTask, RECORD_FIELD_FOR_TASK } = await import('../server/services/research-queue');
const { getLeadDetail } = await import('../server/services/leads');
const { loadCanonical } = await import('../server/repo/canonical');
const snapshot = await loadCanonical({ KACHMO_CUTOVER_PHASE: 'POST_CUTOVER' });

// ─────────────────────────────────────────────────────────────────────────────
group('3. Today shows each person only work they may do');
{
  const all = await getToday(owner, { snapshot });
  assert(all.items.length > 0 && all.source === 'POSTGRES', `the owner sees the whole list (${all.items.length} items)`);
  assert(all.items.every(i => !!i.href), 'every item links to where the work happens');
  assert(all.items.filter(i => i.kind === 'CALL_READY').every(i => i.href === '/calls') && all.items.filter(i => i.kind === 'REPLY_WAITING').every(i => i.href === '/email'), 'calls link to the call queue and email work to the ledger');

  const intern = await getToday(actorWith('INTERN'), { snapshot });
  assert(intern.items.every(i => i.kind === 'RESEARCH' || i.kind === 'FOLLOW_UP_DUE'), 'an intern sees no outreach, review or approval work', [...new Set(intern.items.map(i => i.kind))]);
  const viewer = await getToday(actorWith('VIEWER'), { snapshot });
  assert(viewer.items.every(i => i.kind === 'FOLLOW_UP_DUE'), 'a viewer sees no work that would change anything', [...new Set(viewer.items.map(i => i.kind))]);
  const outreach = await getToday(actorWith('OUTREACH'), { snapshot });
  assert(!outreach.items.some(i => i.kind === 'CANDIDATE_REVIEW' || i.kind === 'EVIDENCE_REVIEW'), 'outreach sees no research approvals');

  const mine = await getToday(actorWith('OUTREACH'), { snapshot, mine: true });
  assert(mine.me === 'AADI' && mine.items.every(i => i.owner === 'AADI'), '"mine" filters by the engine actor the person is bound to', { me: mine.me, owners: [...new Set(mine.items.map(i => i.owner))] });
  assert(mine.items.length <= outreach.items.length, 'and never shows more than everyone’s list');
  const counts = await getToday(owner, { snapshot });
  assert(TODAY_KINDS.every(k => counts.counts[k] === counts.items.filter(i => i.kind === k).length), 'the counts match the items');
}

// ─────────────────────────────────────────────────────────────────────────────
group('4. Lead history is assembled from the logs, never invented');
{
  const { getLeadTimeline } = await import('../server/services/timeline');
  const { applyLeadMutation } = await import('../server/leads/mutate');
  const [row] = await db.select().from(schema.lead).where(eq(schema.lead.targetNumber, '111'));
  const lead = row.record as KachmoLead;
  const before = await getLeadTimeline(lead);
  assert(before.length > 0 && before.every(e => e.source === 'EVENT' || e.source === 'CALL'), 'a migrated lead already has its imported history', before.length);

  const r = await applyLeadMutation(
    db,
    {
      leadId: row.leadId,
      expectedVersion: row.version,
      action: 'lead.research_recorded',
      actor: { userId: 'u-owner', label: 'Test OWNER', engineActor: 'DEV' },
      decide: (l, ctx) => decideResearchRecord(l, { field: 'tech', by: 'DEV', value: 'Webflow', source: 'https://example.com/111/built-with' }, { today: ctx.today, now: ctx.now, isKnownTimezone: () => true }),
    },
    { env: POST, ledger }
  );
  assert(r.outcome === 'APPLIED', 'a write is recorded', r);
  const [after] = await db.select().from(schema.lead).where(eq(schema.lead.leadId, row.leadId));
  const timeline = await getLeadTimeline(after.record as KachmoLead);
  assert(timeline[0].source === 'AUDIT' || timeline[0].source === 'EVENT', 'the newest entry is first');
  assert(timeline.some(e => e.kind === 'lead.research_recorded' && e.actor === 'Test OWNER'), 'the audited action names the real person');
  assert(timeline.some(e => e.kind === 'RESEARCH_RECORDED' && e.actor === 'DEV'), 'the domain event names the engine actor');
  const calls = (after.record as KachmoLead).call_attempts ?? [];
  const callEvents = timeline.filter(e => e.source === 'CALL');
  assert(callEvents.length <= calls.length, 'call attempts already described by an event are not shown twice');
  const contactValues = [lead.decision_maker_email, lead.decision_maker_phone].filter((v): v is string => !!v && v.length > 5);
  assert(!contactValues.some(v => JSON.stringify(timeline).includes(v)), 'no contact value appears anywhere in the history');
}

// ─────────────────────────────────────────────────────────────────────────────
group('5. The research loop is in the app, and never leaks a contact value (regression)');
{
  assert(FIELD_ORDER.every(f => !!RECORD_FIELD_FOR_TASK[f]), 'every research task core can produce maps to a form field', FIELD_ORDER.filter(f => !RECORD_FIELD_FOR_TASK[f]));
  assert(Object.values(RECORD_FIELD_FOR_TASK).every(f => (RECORDABLE_FIELDS as readonly string[]).includes(f)), 'and every mapped field is one the write path accepts');
  assert(recordFieldForTask('nonsense_field') === null, 'an unknown field maps to nothing rather than guessing');

  // The defect this test exists for: core writes the lead's own phone/email into its task text
  // ("Find where +44 … is published"), and the lead page shows that text to anyone with lead.view.
  const withContact = source.leads.find(l => l.decision_maker_phone && l.missing_intelligence.some(f => f.startsWith('phone_source')))!;
  const intern = actorWith('INTERN');
  const asIntern = await getLeadDetail(withContact.target_number, intern, snapshot);
  const internText = JSON.stringify(asIntern!.researchTasks);
  assert(!internText.includes(withContact.decision_maker_phone!), 'an intern never reads the lead’s phone number inside a research task', internText.slice(0, 200));
  assert(/••••/.test(internText), 'it is masked in place, so the instruction still makes sense');
  const asOwner = await getLeadDetail(withContact.target_number, owner, snapshot);
  assert(JSON.stringify(asOwner!.researchTasks).includes(withContact.decision_maker_phone!), 'someone allowed to see contacts still sees the real number');

  const queueAsIntern = await getResearchQueue(intern, { snapshot });
  const queueText = JSON.stringify(queueAsIntern.items);
  const anyContact = source.leads.flatMap(l => [l.decision_maker_email, l.decision_maker_phone]).filter((v): v is string => !!v && v.length > 5);
  assert(!anyContact.some(v => queueText.includes(v)), 'the research queue leaks no contact value either');
  const queue = await getResearchQueue(owner, { snapshot });
  assert(queue.items.length > 0 && queue.items.every(i => i.tasks.length > 0), 'the queue lists every lead with open research');
  assert(queue.items.every(i => i.tasks.every(t => t.recordField === null || (RECORDABLE_FIELDS as readonly string[]).includes(t.recordField))), 'each task offers the form field that records it');
  assert(queue.topFields.length > 0 && queue.topFields[0].leads >= (queue.topFields[1]?.leads ?? 0), 'the blocking fields are ranked by how many leads they hold up');
}

// ─────────────────────────────────────────────────────────────────────────────
group('6. Operator safety: a writing command names its target; a revert that changes nothing is refused');
{
  const { operatorHostRefusal } = await import('../server/leads/operator-db');
  const url = 'postgres://u:p@ep-prod.neon.tech/neondb';
  assert(/KACHMO_OPERATOR_CONFIRM_HOST=ep-prod.neon.tech/.test(operatorHostRefusal(url, {}) ?? ''), 'without confirmation a writing command refuses and names the host it would have written');
  assert(operatorHostRefusal(url, { KACHMO_OPERATOR_CONFIRM_HOST: 'ep-other.neon.tech' }) !== null, 'a different host is refused');
  assert(operatorHostRefusal(url, { KACHMO_OPERATOR_CONFIRM_HOST: 'EP-PROD.neon.tech' }) === null, 'the exact host (any case) is accepted');
  assert(operatorHostRefusal('not a url', { KACHMO_OPERATOR_CONFIRM_HOST: 'x' }) !== null, 'an unparseable target is refused');
  const cli = readFileSync(join(OS, 'server/leads/actor-bind-cli.ts'), 'utf-8');
  assert(/openOperatorDatabase\(\{ writes: true \}\)/.test(cli), 'actor:bind always declares that it writes');

  const { runRevert } = await import('../server/leads/revert');
  const [l111] = await db.select().from(schema.lead).where(eq(schema.lead.targetNumber, '111'));
  const noop = await runRevert(db, { targetNumber: '111', toVersion: 1, apply: false, actor: 'Dev Jaiswal', env: POST, ledger });
  const derivedOnly = noop.plan.fieldsChanged.length === 0;
  assert(!derivedOnly || /Nothing to revert/.test(noop.message), 'a revert that would change no field is refused instead of writing an empty version', noop.message);
  const [unchanged] = await db.select().from(schema.lead).where(eq(schema.lead.targetNumber, '111'));
  assert(unchanged.version === l111.version, 'and the lead is untouched');
}

await database.close();
console.log(`\n${'='.repeat(60)}`);
console.log(`OPERATING LOOP SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.error(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
