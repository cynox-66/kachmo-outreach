/**
 * PHASE 1.5D — SINGLE-WRITER AND RECONCILIATION TESTS.
 *
 * Proves the boundary rules hold as code, not only as prose: one writer per field per phase, immutable fields,
 * drift classified by how dangerous it is, and a Titan suppression publish that is one-way, additive, optimistic
 * and fail-closed.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { KachmoLead, SuppressionEntry } from '../lib/schema.js';
import { CUTOVER_PHASES, PHASES, FIELD_OWNERSHIP, OWNED_FIELDS, IMMUTABLE_FIELDS, mayWrite, ownerOf, isImmutableField } from '../../core/reconciliation/ownership.js';
import { reconcileStores, compareSuppressionLists, DRIFT_IGNORED_FIELDS } from '../../core/reconciliation/drift.js';
import { planSuppressionPublish, suppressionFreshness, publishStateLabel } from '../../core/reconciliation/publish.js';

const REPO = process.cwd();
let passed = 0;
const failures: string[] = [];
function assert(cond: unknown, name: string, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ❌ ${name}${detail !== undefined ? `\n     ${JSON.stringify(detail)}` : ''}`);
  }
}
const group = (t: string) => console.log(`\n${t}`);

const LEADS: KachmoLead[] = JSON.parse(readFileSync(join(REPO, 'database/kachmo_leads.json'), 'utf-8'));
const clone = (l: KachmoLead): KachmoLead => JSON.parse(JSON.stringify(l));
const entry = (over: Partial<SuppressionEntry>): SuppressionEntry => ({ reason: 'r', suppressed_at: '2026-09-15T00:00:00.000Z', source: 'test', ...over });

console.log('\n🔀 RECONCILIATION & SINGLE-WRITER BOUNDARY (Phase 1.5D)');

group('1. Every field has exactly one writer in every phase');
{
  assert(CUTOVER_PHASES.length === 3, 'the cutover is a sequence of explicit phases, not an instant');
  assert(PHASES.PRE_CUTOVER.canonicalLeadStore === 'GIT_JSON', 'before cutover the committed JSON store is canonical');
  assert(PHASES.POST_CUTOVER.canonicalLeadStore === 'POSTGRES', 'after cutover Postgres is canonical');
  assert(PHASES.CUTOVER_WINDOW.writableStores.length === 1 && PHASES.CUTOVER_WINDOW.writableStores[0] === 'TITAN', 'during the window no store accepts lead writes, so drift cannot appear mid-comparison');
  assert(PHASES.CUTOVER_WINDOW.canonicalLeadStore === 'GIT_JSON', 'during the window the old store stays canonical, so rollback costs nothing');

  const seen = new Map<string, string>();
  const duplicated: string[] = [];
  for (const g of FIELD_OWNERSHIP) for (const f of g.fields) (seen.has(f) ? duplicated.push(`${f} (${seen.get(f)} and ${g.group})`) : seen.set(f, g.group));
  assert(duplicated.length === 0, 'no field is claimed by two ownership groups', duplicated);

  for (const phase of CUTOVER_PHASES) {
    const unowned = OWNED_FIELDS.filter(f => ownerOf(f, phase) === null);
    assert(unowned.length === 0, `every governed field has a writer in ${phase}`, unowned);
  }
  assert(FIELD_OWNERSHIP.find(g => g.group === 'EMAIL_LEDGER')!.writer.POST_CUTOVER === 'TITAN', 'Titan still owns email send state after cutover — the OS never sends email');
  assert(ownerOf('lead_state', 'POST_CUTOVER') === 'TITAN' && ownerOf('research_state', 'POST_CUTOVER') === 'POSTGRES', 'the email ledger state and the engine research state have different owners');
}

group('2. Writes outside the ownership model are denied by default');
{
  assert(mayWrite('POSTGRES', 'kachmo_score', 'PRE_CUTOVER').allowed === false, 'Postgres cannot write engine output before cutover');
  assert(mayWrite('GIT_JSON', 'kachmo_score', 'PRE_CUTOVER').allowed === true, 'the JSON store can, because it owns it then');
  assert(mayWrite('GIT_JSON', 'kachmo_score', 'POST_CUTOVER').allowed === false, 'and cannot after cutover');
  assert(mayWrite('POSTGRES', 'kachmo_score', 'POST_CUTOVER').allowed === true, 'Postgres can after cutover');
  assert(mayWrite('POSTGRES', 'lead_state', 'POST_CUTOVER').reason.includes('TITAN'), 'the OS may never write the email ledger state, and the refusal says who owns it');
  assert(mayWrite('GIT_JSON', 'lead_id', 'PRE_CUTOVER').reason.includes('immutable'), 'identity cannot be rewritten by anyone, in any phase');
  for (const f of IMMUTABLE_FIELDS) {
    for (const phase of CUTOVER_PHASES) {
      if (mayWrite('POSTGRES', f, phase).allowed || mayWrite('GIT_JSON', f, phase).allowed) {
        assert(false, `immutable field ${f} is writable in ${phase}`);
      }
    }
  }
  assert(IMMUTABLE_FIELDS.includes('lead_id') && IMMUTABLE_FIELDS.includes('target_number'), 'lead identity is immutable');
  assert(mayWrite('POSTGRES', 'a_field_nobody_classified', 'POST_CUTOVER').allowed === false, 'an unclassified field is deny-by-default');
  assert(mayWrite('POSTGRES', 'a_field_nobody_classified', 'POST_CUTOVER').reason.includes('classify it'), 'and the refusal says what to do about it');
  assert(mayWrite('GIT_JSON', 'kachmo_score', 'CUTOVER_WINDOW').allowed === false, 'nothing writes leads during the cutover window');
}

group('3. Drift is detected and graded by how dangerous it is');
{
  const left = LEADS.slice(0, 20).map(clone);
  const identical = reconcileStores({ store: 'GIT_JSON', leads: left, suppression: [] }, { store: 'POSTGRES', leads: left.map(clone), suppression: [] }, 'PRE_CUTOVER');
  assert(identical.leads.length === 0 && identical.counts.BLOCKING === 0, 'two identical stores produce an empty drift report');
  assert(identical.safeToCutOver === true, 'and are safe to cut over');

  const missing = reconcileStores({ store: 'GIT_JSON', leads: left, suppression: [] }, { store: 'POSTGRES', leads: left.slice(1).map(clone), suppression: [] }, 'PRE_CUTOVER');
  assert(missing.leads.some(d => d.kind === 'ONLY_IN_LEFT' && d.severity === 'BLOCKING'), 'a lead missing from the other store is blocking');
  assert(missing.safeToCutOver === false, 'and blocks cutover');

  const extra = reconcileStores({ store: 'GIT_JSON', leads: left.slice(1), suppression: [] }, { store: 'POSTGRES', leads: left.map(clone), suppression: [] }, 'PRE_CUTOVER');
  assert(extra.leads.some(d => d.kind === 'ONLY_IN_RIGHT' && d.severity === 'BLOCKING'), 'a lead that exists only in the non-canonical store is blocking');

  const swapped = left.map(clone);
  swapped[0] = { ...swapped[0], target_number: '999' };
  const identity = reconcileStores({ store: 'GIT_JSON', leads: left, suppression: [] }, { store: 'POSTGRES', leads: swapped, suppression: [] }, 'PRE_CUTOVER');
  assert(identity.leads.some(d => d.kind === 'IDENTITY_MISMATCH' && d.severity === 'BLOCKING'), 'a lead_id pointing at a different target number is blocking');

  const provenance = left.map(clone);
  provenance[0] = { ...provenance[0], phone_status: 'VERIFIED', phone_verification_basis: 'somebody said so' };
  const prov = reconcileStores({ store: 'GIT_JSON', leads: left, suppression: [] }, { store: 'POSTGRES', leads: provenance, suppression: [] }, 'POST_CUTOVER');
  const provDrift = prov.leads.find(d => d.leadId === left[0].lead_id);
  assert(provDrift?.severity === 'BLOCKING', 'contact provenance differing is blocking even when the other store owns the field');
  assert(provDrift?.fields.some(f => f.group === 'CONTACT_PROVENANCE'), 'and the report names the group that differs');
  assert(!JSON.stringify(prov).includes('somebody said so'), 'the drift report never carries the differing values, only which fields differ');

  const dnc = left.map(clone);
  dnc[0] = { ...dnc[0], do_not_contact: true, research_state: 'DISQUALIFIED', lead_priority: 'DISQUALIFIED' };
  const dncReport = reconcileStores({ store: 'GIT_JSON', leads: left, suppression: [] }, { store: 'POSTGRES', leads: dnc, suppression: [] }, 'POST_CUTOVER');
  assert(dncReport.leads.find(d => d.leadId === left[0].lead_id)?.severity === 'BLOCKING', 'a suppression flag differing is blocking');

  const shorter = left.map(clone);
  const withHistory = left.map(clone);
  withHistory[0] = { ...withHistory[0], call_attempts: [{ at: '2026-09-10T00:00:00.000Z', by: 'AADI', outcome: 'NO_ANSWER', notes: null, objection: null, objection_category: null }] };
  const regression = reconcileStores({ store: 'GIT_JSON', leads: withHistory, suppression: [] }, { store: 'POSTGRES', leads: shorter, suppression: [] }, 'POST_CUTOVER');
  const rd = regression.leads.find(d => d.leadId === left[0].lead_id);
  assert(rd?.fields.some(f => f.field === 'call_attempts' && f.severity === 'BLOCKING' && f.reason.includes('append-only')), 'a call history that got shorter is reported as data loss');

  // A field the right store legitimately owns, differing in the phase where it owns it, is informational.
  const notes = left.map(clone);
  notes[0] = { ...notes[0], notes: 'a note added in the app' };
  const info = reconcileStores({ store: 'GIT_JSON', leads: left, suppression: [] }, { store: 'POSTGRES', leads: notes, suppression: [] }, 'POST_CUTOVER');
  assert(info.leads.find(d => d.leadId === left[0].lead_id)?.severity === 'INFO', 'an expected write by the owning store is informational, not an alarm');
  // The same difference, in the phase where that store does NOT own the field, is blocking.
  const stale = reconcileStores({ store: 'GIT_JSON', leads: left, suppression: [] }, { store: 'POSTGRES', leads: notes, suppression: [] }, 'PRE_CUTOVER');
  assert(stale.leads.find(d => d.leadId === left[0].lead_id)?.severity === 'BLOCKING', 'the identical difference is blocking when the store had no right to write it');

  const supDrift = compareSuppressionLists([entry({ target_number: '001' })], []);
  assert(supDrift.severity === 'BLOCKING' && supDrift.onlyInLeft === 1, 'a suppression entry the other store lacks is blocking');
  assert(compareSuppressionLists([entry({ email: 'A@B.com' })], [entry({ email: 'a@b.com' })]).severity === 'INFO', 'suppression identifiers compare case-insensitively');
  assert(compareSuppressionLists([], [entry({ target_number: '001' })]).onlyInRight === 1, 'an entry only in the non-canonical store is reported, never silently dropped');
}

group('4. The Titan suppression publish is one-way, additive and optimistic');
{
  const a = entry({ target_number: '001', email: 'a@x.example' });
  const b = entry({ target_number: '002', email: 'b@x.example' });
  const SHA = 'abc123def456';

  const plan = planSuppressionPublish({ canonical: [a, b], remote: [a], remoteSha: SHA, observedSha: SHA });
  assert(plan.refusal === null && plan.toAppend.length === 1, 'a publish appends only what the remote is missing');
  assert(plan.nextContents.length === 2 && plan.nextContents[0] === a, 'the published contents keep everything that was already there, in order');

  const stale = planSuppressionPublish({ canonical: [a, b], remote: [a], remoteSha: 'someone-else-wrote', observedSha: SHA });
  assert(stale.refusal?.code === 'STALE_BASE', 'a publish onto a file that moved is refused, not merged');
  assert(stale.nextContents.length === 0, 'and produces no contents to write');
  assert(stale.refusal!.message.includes('never overwrite a change you have not seen'), 'the refusal explains why it is not retried blindly');

  const nothing = planSuppressionPublish({ canonical: [a], remote: [a], remoteSha: SHA, observedSha: SHA });
  assert(nothing.refusal?.code === 'NOTHING_TO_PUBLISH' && nothing.toAppend.length === 0, 'a publish with nothing to add is a no-op, not an empty overwrite');

  // A canonical store that has "lost" an entry must never cause it to be removed downstream.
  const shrunk = planSuppressionPublish({ canonical: [b], remote: [a, b], remoteSha: SHA, observedSha: SHA });
  assert(shrunk.presentOnlyOnRemote.length === 1, 'an entry the remote has and the canonical store does not is reported');
  assert(shrunk.refusal?.code === 'NOTHING_TO_PUBLISH', 'and is never removed by a publish');

  const malformed = planSuppressionPublish({ canonical: [a], remote: null as unknown as SuppressionEntry[], remoteSha: SHA, observedSha: SHA });
  assert(malformed.refusal?.code === 'MALFORMED_REMOTE', 'a malformed published file is never replaced wholesale');
}

group('5. Outreach fails closed while a suppression is unpublished');
{
  const a = entry({ target_number: '001', email: 'a@x.example' });
  const b = entry({ target_number: '002', email: 'b@x.example' });
  const behind = suppressionFreshness([a, b], [a]);
  assert(behind.fresh === false && behind.outreachAllowed === false && behind.unpublished === 1, 'an unpublished suppression blocks outreach');
  assert(behind.reason.includes('could contact someone who opted out'), 'and the reason states the actual risk');
  const current = suppressionFreshness([a], [a]);
  assert(current.fresh && current.outreachAllowed, 'outreach is allowed only once everything is published');
  assert(suppressionFreshness([], []).outreachAllowed === true, 'an empty canonical list is trivially fresh');
  assert(suppressionFreshness([a], [a, b]).outreachAllowed === true, 'a remote that suppresses MORE than canonical is safe — over-suppression never blocks');

  const states = (['NOT_PUBLISHED', 'PUBLISH_IN_FLIGHT', 'PUBLISHED_VERIFIED', 'PUBLISH_FAILED', 'PUBLISH_CONFLICT'] as const).map(s => [s, publishStateLabel(s)] as const);
  assert(states.filter(([, v]) => v.safeToSend).length === 1, 'exactly one publish state permits sending');
  assert(publishStateLabel('PUBLISHED_VERIFIED').safeToSend === true, 'and it is the verified one');
  assert(publishStateLabel('PUBLISH_IN_FLIGHT').safeToSend === false, 'a publish that has been sent but not confirmed does not permit sending');
  assert(!publishStateLabel('PUBLISH_IN_FLIGHT').label.toLowerCase().includes('synced'), 'the UI never calls an unconfirmed publish "synced"');
}

group('6. The model stays honest about the real database');
{
  const governed = new Set(OWNED_FIELDS);
  // The UNION of every key on every real record: a field only some leads carry must still be governed.
  const allFields = new Set<string>();
  for (const l of LEADS) for (const k of Object.keys(l as unknown as Record<string, unknown>)) allFields.add(k);
  const ungoverned = [...allFields].filter(k => !governed.has(k)).sort();
  assert(ungoverned.length === 0, `every field on every real lead is governed by the ownership model (${allFields.size} fields)`, ungoverned);
  assert(DRIFT_IGNORED_FIELDS.includes('updated_at'), 'updated_at is governed but excluded from drift, because it moves on every write');
  assert(governed.has('do_not_contact') && governed.has('phone_status') && governed.has('call_attempts'), 'the safety-critical fields are governed');
  assert(isImmutableField('lead_id') && !isImmutableField('kachmo_score'), 'immutability is declared per field, not assumed');
}

console.log(`\n${'='.repeat(60)}\nRECONCILIATION SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
