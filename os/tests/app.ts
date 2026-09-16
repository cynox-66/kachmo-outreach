/**
 * PHASE 2 — APPLICATION AND SECURITY TESTS.
 *
 * The read surfaces against the real 120-lead canonical store, and the boundaries that must hold whatever the UI
 * does: every route gated server-side, contact values revealed to exactly one set of roles, numbers that agree
 * with the engine, and result sets that cannot grow without bound.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRehearsalDatabase } from '../server/db/rehearsal-db';
import { permissionsFor, PERMISSIONS, ROLE_PERMISSIONS, canAssignRole } from '../server/authz/permissions';
import type { Actor } from '../server/authz/authorize';

const OS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(OS, 'app');

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
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (f === 'node_modules' || f === '.next') return [];
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
const read = (f: string) => readFileSync(f, 'utf-8');

console.log('\n🖥️  KACHMO OUTBOUND OS — APPLICATION (Phase 2)');

const database = await createRehearsalDatabase();
(globalThis as unknown as { __kachmoServer?: unknown }).__kachmoServer = { db: database.db, auth: {} };

const { loadCanonical } = await import('../server/repo/canonical');
const { resolveCutoverPhase, leadWritesEnabled, phaseBanner, DEFAULT_PHASE } = await import('../server/repo/phase');
const { getDashboard } = await import('../server/services/dashboard');
const { listLeads, getLeadDetail, MAX_PAGE_SIZE } = await import('../server/services/leads');
const { getCallQueue, getWhatsAppQueue, getEmailLedger, getPipeline, getInventory, getAnalytics } = await import('../server/services/operations');
const { contactsFor, maskContact, withoutContactValues } = await import('../server/services/contacts');

const snapshot = await loadCanonical({});
const actorWith = (roles: string[], name = 'Dev'): Actor => ({ userId: `u-${name}`, name, email: `${name}@kachmo.test`, roles: roles as Actor['roles'], permissions: permissionsFor(roles) });
const owner = actorWith(['OWNER']);
const intern = actorWith(['INTERN'], 'Intern');
const viewer = actorWith(['VIEWER'], 'Viewer');

// ─────────────────────────────────────────────────────────────────────────────
group('1. The app reads the canonical store and says which one it is');
{
  assert(snapshot.source === 'GIT_JSON' && snapshot.phase === 'PRE_CUTOVER', 'with no phase declared, the committed JSON store is canonical', { source: snapshot.source, phase: snapshot.phase });
  assert(snapshot.leads.length === 120, 'all 120 real leads are read', snapshot.leads.length);
  assert(snapshot.tracker.size > 0, 'the Titan ledger is read in every phase', snapshot.tracker.size);
  assert(resolveCutoverPhase({}) === DEFAULT_PHASE && DEFAULT_PHASE === 'PRE_CUTOVER', 'an undeclared phase defaults to the read-only direction');
  assert(resolveCutoverPhase({ KACHMO_CUTOVER_PHASE: 'nonsense' }) === 'PRE_CUTOVER', 'an unrecognised phase falls back to PRE_CUTOVER rather than guessing');
  assert(resolveCutoverPhase({ KACHMO_CUTOVER_PHASE: 'POST_CUTOVER' }) === 'POST_CUTOVER', 'a declared phase is honoured');
  assert(!leadWritesEnabled('PRE_CUTOVER') && !leadWritesEnabled('CUTOVER_WINDOW') && leadWritesEnabled('POST_CUTOVER'), 'lead writes are enabled only after cutover');
  assert(phaseBanner('PRE_CUTOVER').detail.includes('CLI'), 'the banner tells the operator where writes actually go');
}

// ─────────────────────────────────────────────────────────────────────────────
group('2. Dashboard numbers are the engine’s, not the page’s');
{
  const d = await getDashboard(snapshot);
  assert(d.base.total === 120, 'lead total matches the store', d.base.total);
  assert(d.base.qualified + d.base.outreach_ready === 13, 'qualified + outreach-ready is the known 13', d.base.qualified + d.base.outreach_ready);
  assert(d.base.research_required === 107, 'research-required is the known 107', d.base.research_required);
  assert(d.base.a_or_a_plus === 20 && d.base.a_or_a_plus_provisional === 20, 'A/A+ is the known 20, all provisional', [d.base.a_or_a_plus, d.base.a_or_a_plus_provisional]);
  assert(d.usable === 13, 'usable-today matches the inventory count', d.usable);
  assert(d.callQueue.callable === 0, 'no lead is callable, because no phone has a recorded source', d.callQueue.callable);
  assert(d.attention.every(a => a.count > 0), 'the attention list never shows a zero — an empty queue is simply absent');
  assert(d.nextActions.every(n => n.action), 'every "what next" row carries the lead’s stored next_action');
  assert(d.phase.source === 'GIT_JSON', 'the dashboard states which store it read');
}

// ─────────────────────────────────────────────────────────────────────────────
group('3. Contact values are revealed to exactly one set of roles');
{
  const withPhone = snapshot.leads.find(l => l.decision_maker_phone)!;
  const asOwner = contactsFor(withPhone, owner);
  const asIntern = contactsFor(withPhone, intern);
  const asViewer = contactsFor(withPhone, viewer);

  assert(asOwner.phone.value === withPhone.decision_maker_phone, 'an OWNER sees the real number');
  assert(asIntern.phone.value === null && asViewer.phone.value === null, 'an INTERN and a VIEWER get null, not a hidden string');
  assert(asIntern.phone.masked !== withPhone.decision_maker_phone, 'the mask is not the value');
  assert(asIntern.phone.present === true, 'but they can still tell a number EXISTS — absent and forbidden are different');
  assert(!JSON.stringify(asIntern).includes(withPhone.decision_maker_phone!.replace(/\D/g, '').slice(0, 6)), 'no part of the real number survives anywhere in the intern’s view');

  assert(maskContact('jane.roe@northlight.example', 'email') === 'j•••@n•••.example', 'an email mask keeps only the shape', maskContact('jane.roe@northlight.example', 'email'));
  assert(maskContact('+44 20 7946 0000', 'phone') === '•••• 00', 'a phone mask keeps only the last two digits');
  assert(maskContact(null, 'email') === '—', 'an absent value is a dash, not a mask');

  const redacted = withoutContactValues({ email: 'a@b.com', nested: { phone: '+123456', safe: 'keep' } });
  assert(JSON.stringify(redacted).includes('[redacted]') && !JSON.stringify(redacted).includes('a@b.com'), 'contact keys are redacted at any depth');
  assert(JSON.stringify(redacted).includes('keep'), 'and nothing else is touched');

  // The same rule must hold through every surface that renders a contact.
  const internCalls = await getCallQueue(intern, snapshot);
  assert(internCalls.cards.every(c => !c.phoneVisible), 'the call queue masks numbers for an intern');
  const internWa = await getWhatsAppQueue(intern, snapshot);
  assert(internWa.items.every(i => !i.numberVisible), 'so does the WhatsApp queue');
  const internEmail = await getEmailLedger(intern, snapshot);
  assert(internEmail.rows.every(r => !r.emailVisible), 'so does the email ledger');
  const withEmail = internEmail.rows.find(r => r.email !== '—' && r.email !== '•••');
  assert(!withEmail || !withEmail.email.includes('@') || withEmail.email.includes('•'), 'and no raw address reaches an intern through the ledger');
}

// ─────────────────────────────────────────────────────────────────────────────
group('4. Lead list: filtered, sorted and bounded server-side');
{
  const all = await listLeads({}, snapshot);
  assert(all.total === 120 && all.matched === 120, 'an unfiltered list matches everything');
  assert(all.rows.length <= 50, 'but only one page is returned', all.rows.length);

  const huge = await listLeads({ pageSize: 100000 }, snapshot);
  assert(huge.rows.length <= MAX_PAGE_SIZE, 'a caller cannot ask for the whole database at once', huge.rows.length);
  const negative = await listLeads({ page: -5, pageSize: -5 }, snapshot);
  assert(negative.page >= 1 && negative.pageSize >= 1, 'nonsense paging is clamped rather than crashing');
  const past = await listLeads({ page: 9999 }, snapshot);
  assert(past.page === past.pages, 'a page beyond the end lands on the last page');

  const india = await listLeads({ country: 'India' }, snapshot);
  assert(india.matched === snapshot.leads.filter(l => l.location_country === 'India').length, 'a geography filter matches the store exactly');
  assert(india.rows.every(r => r.country === 'India'), 'and returns only that geography');
  const search = await listLeads({ q: snapshot.leads[0].company_name.slice(0, 6) }, snapshot);
  assert(search.matched >= 1, 'search finds a known company');
  const none = await listLeads({ q: 'zzzzzz-no-such-company' }, snapshot);
  assert(none.matched === 0 && none.rows.length === 0, 'a search matching nothing returns nothing, not everything');

  const byScore = await listLeads({ sort: 'score', pageSize: 10 }, snapshot);
  const scores = byScore.rows.map(r => r.score ?? -1);
  assert(scores.every((s, i) => i === 0 || scores[i - 1] >= s), 'sorting by score is actually sorted');
  assert(all.facets.archetypes.length === 6, 'facets cover all six archetypes', all.facets.archetypes.length);
  assert(all.facets.countries.reduce((n, c) => n + c.count, 0) === 120, 'facet counts add up to the whole database');
}

// ─────────────────────────────────────────────────────────────────────────────
group('5. "Why this lead?" is stored facts and rule outcomes only');
{
  const detail = await getLeadDetail('111', owner, snapshot);
  assert(detail !== null, 'a lead is found by target number');
  assert((await getLeadDetail(detail!.lead.lead_id, owner, snapshot)) !== null, 'and by lead id');
  assert((await getLeadDetail('999', owner, snapshot)) === null, 'an unknown lead is null, not an error page of guesses');

  assert(detail!.gates.length === 8, 'all eight gates are shown', detail!.gates.length);
  assert(detail!.gates.every(g => ['PASS', 'UNVERIFIED', 'PENDING', 'UNKNOWN', 'FAIL'].includes(g.outcome)), 'each with one of the five v1.0 outcomes');
  assert(detail!.gates.filter(g => !g.blocking).length === 2, 'budget and intent are marked as never blocking');
  // A missing entry may carry an explanation after the field name ("direct_contact_route (reservation@ is a shared
  // mailbox…)"), while the task names the bare field. Every task must still trace to a reported gap.
  assert(
    detail!.researchTasks.every(t => detail!.missingIntelligence.some(f => f === t.field || f.startsWith(`${t.field} (`))),
    'every research task names a field the engine actually reported missing',
    { tasks: detail!.researchTasks.map(t => t.field), missing: detail!.missingIntelligence }
  );
  assert(detail!.researchTasks.length > 0 && detail!.researchTasks.every(t => t.recordWith.startsWith('npm run leads:record')), 'and tells the operator the exact command to record what they find');
  assert(detail!.provenance.every(p => p.evidenceLevel === 'URL_SHAPED' || p.evidenceLevel === 'CLAIMED'), 'no stored provenance claims more than URL_SHAPED, because nothing has been fetched');
  assert(detail!.provenance.every(p => p.note.length > 20), 'and each says plainly what that level does and does not mean');
}

// ─────────────────────────────────────────────────────────────────────────────
group('6. Operational surfaces agree with the engine');
{
  const calls = await getCallQueue(owner, snapshot);
  assert(calls.cards.length === 0 && calls.unsourcedPhones === 18, 'nothing is callable and 18 phones are unsourced — the honest denominator', [calls.cards.length, calls.unsourcedPhones]);
  assert(calls.excluded.length === 18, 'every lead with a phone is listed as excluded, with a reason', calls.excluded.length);
  assert(calls.excluded.every(e => e.reason.length > 0), 'and no exclusion is unexplained');

  const wa = await getWhatsAppQueue(owner, snapshot);
  assert(wa.items.length === 0, 'no WhatsApp draft exists, because no lead has a recorded basis');

  const email = await getEmailLedger(owner, snapshot);
  assert(email.rows.length === snapshot.tracker.size, 'the ledger shows every tracker row');
  assert(email.byStatus.reduce((n, s) => n + s.count, 0) === email.rows.length, 'status counts add up');
  assert(email.suppressionFreshness.outreachAllowed === true, 'with an empty suppression list, outreach is not blocked');

  const pipeline = await getPipeline(snapshot);
  assert(pipeline.columns.reduce((n, c) => n + c.leads.length, 0) <= 120, 'no lead appears in two pipeline columns');
  assert(pipeline.totals.won === 0 && pipeline.totals.proposals === 0, 'nothing is claimed as won that was not');

  const inv = await getInventory(snapshot);
  assert(inv.report.totals.usable === 13, 'inventory agrees with the dashboard on usable leads');
  assert(inv.report.segments.every(s => s.usable + s.recoverableByResearch + s.permanentlyUnavailable === s.total), 'every lead is exactly one of usable, recoverable or unavailable');
  assert(inv.needs.every(n => n.shortfall > 0), 'a research need always states a real shortfall');

  const an = await getAnalytics(snapshot);
  assert(an.report.conversion_probability === 'UNKNOWN', 'analytics never estimates a conversion probability');
  assert(an.report.conversions.every(c => c.n >= 20 || !/%/.test(c.display)), 'no percentage is shown below the sample floor');
}

// ─────────────────────────────────────────────────────────────────────────────
group('7. Every route is gated server-side');
{
  const pages = walk(join(APP, '(app)')).filter(f => f.endsWith('page.tsx'));
  assert(pages.length >= 12, `every section has a page (${pages.length})`);
  const ungated = pages.filter(f => !/requirePermission\(/.test(read(f)));
  assert(ungated.length === 0, 'every page calls requirePermission before reading anything', ungated.map(f => relative(OS, f)));

  // Sign-in and sign-out are deliberately exempt: requiring a permission to authenticate would be circular.
  // They carry their own protections (rate limiting, origin checks) and are covered by tests/auth.ts.
  const UNAUTHENTICATED_BY_DESIGN = ['server/auth/actions.ts'];
  const actions = walk(join(OS, 'server')).filter(f => read(f).startsWith("'use server'"));
  assert(actions.length > 0, 'there are server actions to check');
  for (const f of actions) {
    if (UNAUTHENTICATED_BY_DESIGN.includes(relative(OS, f))) continue;
    const body = read(f);
    const exported = [...body.matchAll(/export async function (\w+)/g)].map(m => m[1]);
    const gated = (body.match(/requirePermission\(/g) ?? []).length;
    assert(gated >= exported.length, `every server action in ${relative(OS, f)} calls requirePermission (${gated}/${exported.length})`);
  }
  const authActions = read(join(OS, 'server/auth/actions.ts'));
  assert(/signOut|signIn/i.test(authActions), 'the exempt file really is the sign-in/sign-out pair, not a back door', relative(OS, join(OS, 'server/auth/actions.ts')));

  // A client component must never be the thing deciding what a role may see.
  const clientFiles = walk(APP).filter(f => read(f).startsWith("'use client'"));
  const deciding = clientFiles.filter(f => /permissions\.has\(|ROLE_PERMISSIONS|hasPermission\(/.test(read(f)));
  assert(deciding.length === 0, 'no client component evaluates permissions', deciding.map(f => relative(OS, f)));
  const leaky = clientFiles.filter(f => /decision_maker_email|decision_maker_phone/.test(read(f)));
  assert(leaky.length === 0, 'no client component touches a raw contact field', leaky.map(f => relative(OS, f)));
}

// ─────────────────────────────────────────────────────────────────────────────
group('8. Role boundaries hold');
{
  assert(!intern.permissions.has('lead.view_contacts'), 'an intern cannot view contacts');
  assert(!intern.permissions.has('lead.export') && !intern.permissions.has('research.approve'), 'nor export nor approve');
  assert(!intern.permissions.has('suppression.create') && !intern.permissions.has('outreach.call'), 'nor suppress nor contact anyone');
  assert(!viewer.permissions.has('lead.view_contacts'), 'a viewer cannot view contacts either');
  assert(permissionsFor([]).size === 0, 'a user with no role has no permissions at all');
  assert(permissionsFor(['NOT_A_ROLE']).size === 0, 'an unknown role grants nothing');

  assert(!canAssignRole(['ADMIN'], 'OWNER'), 'an ADMIN cannot grant OWNER');
  assert(canAssignRole(['OWNER'], 'OWNER'), 'only an OWNER can');
  assert(!canAssignRole(['RESEARCHER'], 'VIEWER'), 'a role without users.manage can grant nothing');

  // No role may hold a permission that does not exist, and none may bypass send safety.
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const unknown = perms.filter(p => !(PERMISSIONS as readonly string[]).includes(p));
    assert(unknown.length === 0, `${role} holds only declared permissions`, unknown);
  }
  assert(!PERMISSIONS.some(p => /send|dispatch|bypass|override/i.test(p)), 'no permission exists that would send or bypass anything', PERMISSIONS.filter(p => /send|bypass/i.test(p)));
}

// ─────────────────────────────────────────────────────────────────────────────
group('9. Nothing in the app can send, and no secret can leak');
{
  const src = [...walk(join(OS, 'server')), ...walk(APP)];
  const offenders = (re: RegExp) => src.filter(f => re.test(read(f))).map(f => relative(OS, f));
  assert(offenders(/from ['"]nodemailer['"]|from ['"]imapflow['"]/).length === 0, 'no mail library anywhere in the app');
  assert(offenders(/send-titan-smtp|create-titan-drafts|cron-dispatch/).length === 0, 'no legacy send script is imported');
  assert(offenders(/NEXT_PUBLIC_/).length === 0, 'nothing is exposed through a NEXT_PUBLIC variable', offenders(/NEXT_PUBLIC_/));
  assert(offenders(/TITAN_PASSWORD|SMTP_PASS|GOOGLE_PRIVATE_KEY/).length === 0, 'no production credential is named in the app');

  const clientFiles = walk(APP).filter(f => read(f).startsWith("'use client'"));
  assert(clientFiles.every(f => !/process\.env/.test(read(f))), 'no client component reads the environment', clientFiles.filter(f => /process\.env/.test(read(f))).map(f => relative(OS, f)));

  // Secrets must never reach an audit record.
  const redact = read(join(OS, 'server/audit/redact.ts'));
  assert(/password|secret|token/i.test(redact), 'the audit redactor knows about credentials');
  const auditWrites = src.filter(f => /recordAudit\(/.test(read(f)));
  assert(auditWrites.length > 0, 'audit records are actually written');
  assert(!src.some(f => /recordAudit\([^)]*decision_maker_(email|phone)/s.test(read(f))), 'no audit call passes a contact field');
}

await database.close();
console.log(`\n${'='.repeat(60)}\nAPP SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
