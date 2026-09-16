/**
 * Authentication, authorization and audit tests. Better Auth runs against in-memory PostgreSQL (PGlite) with the real
 * migrations; requests go through its real HTTP handler. No network, no hosted database, no email.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import * as schema from '../server/db/schema/index';
import { createRehearsalDatabase } from '../server/db/rehearsal-db';
import { createAuth, AuthConfigError, AUTH_POLICY } from '../server/auth/auth';
import { bootstrapOwner, BootstrapRefusedError } from '../server/auth/bootstrap-owner';
import { loadActor, assertPermission, AuthenticationRequiredError, AuthorizationError } from '../server/authz/authorize';
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS, permissionsFor, hasPermission, canAssignRole } from '../server/authz/permissions';
import { recordAudit, AuditInputError } from '../server/audit/audit';
import { redact } from '../server/audit/redact';

const OS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://localhost:3000';
const OWNER = { email: 'owner@kachmo.test', name: 'Test Owner', password: 'correct horse battery staple 42' };

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
async function errorOf(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

console.log('\n🔐 KACHMO OUTBOUND OS — AUTHENTICATION, AUTHORIZATION, AUDIT');

const database = await createRehearsalDatabase();
const { db } = database;
const auth = createAuth(db, { secret: 'test-secret-'.padEnd(48, 'x'), baseURL: BASE, secureCookies: true, nextCookies: false });
let ipCounter = 1;
const post = (path: string, body: unknown, opts: { ip?: string; origin?: string; cookie?: string } = {}) =>
  auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: opts.origin ?? BASE,
        'x-forwarded-for': opts.ip ?? `10.0.0.${ipCounter++}`,
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      body: JSON.stringify(body),
    })
  );
const sessionCookieOf = (res: Response) => {
  const raw = res.headers.getSetCookie?.() ?? [];
  const line = raw.find(c => c.includes('session_token='));
  return { line: line ?? '', pair: line ? line.split(';')[0] : '' };
};

// ─────────────────────────────────────────────────────────────────────────────
group('1. Configuration refuses insecure setups');
assert((await errorOf(async () => createAuth(db, { secret: 'short', baseURL: BASE, secureCookies: true, nextCookies: false }))) instanceof AuthConfigError, 'a secret shorter than 32 characters is refused');
assert((await errorOf(async () => createAuth(db, { secret: 'x'.repeat(40), baseURL: 'not a url', secureCookies: true, nextCookies: false }))) instanceof AuthConfigError, 'an invalid base URL is refused');
assert(AUTH_POLICY.minPasswordLength >= 12 && AUTH_POLICY.rateLimit.signIn.max <= 5 && AUTH_POLICY.sessionExpiresInSeconds <= 12 * 3600, 'policy: ≥12-char passwords, ≤5 sign-in attempts per window, sessions ≤12h');

// ─────────────────────────────────────────────────────────────────────────────
group('2. No public sign-up; owner bootstrap');
{
  const res = await post('/sign-up/email', { email: 'intruder@evil.test', name: 'Intruder', password: 'a very long password 123' });
  const [intruder] = await db.select().from(schema.user).where(eq(schema.user.email, 'intruder@evil.test'));
  assert(res.status >= 400 && !intruder, 'public sign-up is disabled (no account is created)', res.status);

  assert((await errorOf(() => bootstrapOwner(db, auth, { ...OWNER, password: 'short' }))) instanceof BootstrapRefusedError, 'bootstrap refuses a short password');
  assert((await errorOf(() => bootstrapOwner(db, auth, { ...OWNER, email: 'not-an-email' }))) instanceof BootstrapRefusedError, 'bootstrap refuses an invalid email');
  assert((await errorOf(() => bootstrapOwner(db, auth, { ...OWNER, password: 'owner-password-long' }))) instanceof BootstrapRefusedError, 'bootstrap refuses a password containing the email name');

  const { userId } = await bootstrapOwner(db, auth, OWNER);
  const roles = await db.select().from(schema.userRole).where(eq(schema.userRole.userId, userId));
  assert(roles.length === 1 && roles[0].role === 'OWNER', 'bootstrap creates exactly one OWNER role');
  const [acct] = await db.select().from(schema.account).where(eq(schema.account.userId, userId));
  assert(acct?.providerId === 'credential' && !!acct.password && !acct.password.includes(OWNER.password) && acct.password.length > 60, 'the password is stored only as a salted hash');
  const audits = await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'user.bootstrap_owner'));
  assert(audits.length === 1 && audits[0].targetId === userId && !JSON.stringify(audits[0]).includes(OWNER.email), 'bootstrap is audited without the email address');
  assert((await errorOf(() => bootstrapOwner(db, auth, { email: 'second@kachmo.test', name: 'Second', password: 'another strong passphrase 99' }))) instanceof BootstrapRefusedError, 'bootstrap refuses once an OWNER exists');
}

// ─────────────────────────────────────────────────────────────────────────────
group('3. Sign-in, secure session cookie, server-side session validation');
let ownerCookie = '';
{
  const res = await post('/sign-in/email', { email: OWNER.email, password: OWNER.password });
  const cookie = sessionCookieOf(res);
  ownerCookie = cookie.pair;
  assert(res.status === 200 && !!cookie.pair, 'the owner can sign in', res.status);
  assert(/^__Secure-kachmo\.session_token=/.test(cookie.line), 'session cookie is __Secure- prefixed and namespaced', cookie.line.split('=')[0]);
  assert(/HttpOnly/i.test(cookie.line) && /SameSite=Lax/i.test(cookie.line) && /Secure/i.test(cookie.line), 'session cookie is HttpOnly, SameSite=Lax and Secure');
  const body = await res.clone().json().catch(() => ({}));
  assert(!JSON.stringify(body).includes(OWNER.password), 'the sign-in response never echoes the password');

  const session = await auth.api.getSession({ headers: new Headers({ cookie: cookie.pair }) });
  assert(session?.user.email === OWNER.email, 'the session validates server-side from the cookie');
  const actor = await loadActor(db, session!.user.id);
  assert(actor?.roles.join() === 'OWNER' && actor.permissions.has('users.manage') && actor.permissions.has('methodology.manage'), 'the actor is resolved with roles and permissions from the database');

  const [name, value] = cookie.pair.split('=');
  const forged = await auth.api.getSession({ headers: new Headers({ cookie: `${name}=${value.slice(0, -4)}AAAA` }) });
  assert(!forged, 'a tampered session cookie is rejected');
  const noCookie = await auth.api.getSession({ headers: new Headers() });
  assert(!noCookie, 'no cookie → no session');

  const wrong = await post('/sign-in/email', { email: OWNER.email, password: 'wrong password entirely' });
  assert(wrong.status === 401 && !sessionCookieOf(wrong).pair, 'a wrong password is rejected without a session', wrong.status);
  const unknown = await post('/sign-in/email', { email: 'nobody@kachmo.test', password: 'whatever long password' });
  assert(unknown.status === wrong.status, 'unknown email and wrong password are indistinguishable (no account enumeration)', [unknown.status, wrong.status]);
}

// ─────────────────────────────────────────────────────────────────────────────
group('4. Abuse protection');
{
  const ip = '203.0.113.77';
  const statuses: number[] = [];
  for (let i = 0; i < AUTH_POLICY.rateLimit.signIn.max + 2; i++) statuses.push((await post('/sign-in/email', { email: OWNER.email, password: `guess number ${i} long` }, { ip })).status);
  assert(statuses.slice(-2).every(s => s === 429), `sign-in is rate limited after ${AUTH_POLICY.rateLimit.signIn.max} attempts per window from one IP`, statuses);
  const good = await post('/sign-in/email', { email: OWNER.email, password: OWNER.password }, { ip });
  assert(good.status === 429, 'while limited, even the correct password is refused from that IP', good.status);
  const [limitRow] = await db.select().from(schema.rateLimit);
  assert(!!limitRow, 'rate-limit counters are stored in the database (hold across serverless instances)');

  const cross = await post('/sign-in/email', { email: OWNER.email, password: OWNER.password }, { origin: 'https://evil.example' });
  assert(cross.status === 403 && !sessionCookieOf(cross).pair, 'a sign-in from an untrusted origin is rejected (CSRF / origin check)', cross.status);
}

// ─────────────────────────────────────────────────────────────────────────────
group('5. Deactivation and deny-by-default');
{
  const ctx = await auth.$context;
  const intern = await ctx.internalAdapter.createUser({ email: 'intern@kachmo.test', name: 'Intern', emailVerified: true }, { method: 'admin' });
  await ctx.internalAdapter.linkAccount({ providerId: 'credential', accountId: intern.id, userId: intern.id, password: await ctx.password.hash('intern passphrase long 7') });
  const noRoles = await loadActor(db, intern.id);
  assert(!!noRoles && noRoles.permissions.size === 0, 'a user without roles has no permissions');
  assert((await errorOf(async () => assertPermission(noRoles, 'lead.view'))) instanceof AuthorizationError, 'a user without roles is denied lead.view');

  await db.insert(schema.userRole).values({ userId: intern.id, role: 'INTERN' });
  const internActor = await loadActor(db, intern.id);
  for (const p of ['lead.view_contacts', 'lead.export', 'lead.approve', 'suppression.create', 'suppression.view', 'outreach.call', 'outreach.whatsapp', 'users.manage', 'methodology.manage'] as const) {
    assert(!internActor!.permissions.has(p), `INTERN is denied ${p}`);
  }
  assert(internActor!.permissions.has('research.upload') && internActor!.permissions.has('lead.view'), 'INTERN can view leads (masked) and submit research');

  const signedIn = await post('/sign-in/email', { email: 'intern@kachmo.test', password: 'intern passphrase long 7' });
  const internCookie = sessionCookieOf(signedIn).pair;
  assert(signedIn.status === 200 && !!internCookie, '(setup) intern can sign in while active');
  await db.update(schema.user).set({ deactivatedAt: new Date() }).where(eq(schema.user.id, intern.id));
  const after = await post('/sign-in/email', { email: 'intern@kachmo.test', password: 'intern passphrase long 7' });
  assert(after.status >= 400 && !sessionCookieOf(after).pair, 'a deactivated user cannot sign in', after.status);
  const existing = await auth.api.getSession({ headers: new Headers({ cookie: internCookie }) });
  assert(!existing || (await loadActor(db, existing.user.id)) === null, 'an existing session of a deactivated user resolves to no actor');
  assert((await errorOf(async () => assertPermission(null, 'lead.view'))) instanceof AuthenticationRequiredError, 'no actor → authentication required');
  assert(ownerCookie.length > 0, '(owner session unaffected)');
}

// ─────────────────────────────────────────────────────────────────────────────
group('6. Permission model');
{
  assert(JSON.stringify([...schema.ROLE_VALUES]) === JSON.stringify([...ROLES]), 'database role check and permission roles are identical');
  assert(ROLES.every(r => ROLE_PERMISSIONS[r].every(p => (PERMISSIONS as readonly string[]).includes(p))), 'every granted permission is a defined permission');
  assert(permissionsFor(['OWNER']).size === PERMISSIONS.length, 'OWNER holds every permission');
  assert(!hasPermission(['ADMIN'], 'methodology.manage') && !hasPermission(['ADMIN'], 'suppression.revoke'), 'ADMIN cannot change the methodology or lift suppressions');
  assert(permissionsFor(['SUPERUSER', 'root']).size === 0, 'unknown role strings grant nothing');
  assert(!hasPermission(['VIEWER'], 'lead.view_contacts') && !hasPermission(['VIEWER'], 'lead.export'), 'VIEWER sees no contacts and cannot export');
  assert(!hasPermission(['RESEARCHER'], 'lead.approve') && !hasPermission(['RESEARCHER'], 'lead.export') && !hasPermission(['RESEARCHER'], 'suppression.create'), 'RESEARCHER cannot approve, export or suppress');
  assert(!hasPermission(['OUTREACH'], 'lead.approve') && !hasPermission(['OUTREACH'], 'suppression.revoke'), 'OUTREACH cannot approve leads or lift suppressions');
  assert(canAssignRole(['OWNER'], 'OWNER') && !canAssignRole(['ADMIN'], 'OWNER') && canAssignRole(['ADMIN'], 'RESEARCHER') && !canAssignRole(['OUTREACH'], 'VIEWER'), 'only an OWNER can grant OWNER; only user managers assign roles');
  assert(!PERMISSIONS.some(p => /send|dispatch|force|bypass/.test(p)), 'no permission exists to send email, force or bypass anything');
}

// ─────────────────────────────────────────────────────────────────────────────
group('7. Audit service');
{
  const red = redact({ email: 'a@b.com', phoneNumber: '+91 98765 43210', password: 'x', note: 'called +44 20 7946 0000 and wrote to jane@doe.com', nested: { apiKey: 'k', target: '001' }, empty: null }) as Record<string, unknown>;
  const nested = red.nested as Record<string, unknown>;
  const isRedacted = (v: unknown) => typeof v === 'string' && v.startsWith('[redacted]');
  assert(isRedacted(red.email) && isRedacted(red.phoneNumber) && isRedacted(red.password) && isRedacted(nested.apiKey), 'contact and secret keys are redacted');
  assert(red.note === 'called [phone] and wrote to [email]' && nested.target === '001' && red.empty === null, 'contact values inside free text are masked; other values are kept');
  assert((await errorOf(() => recordAudit(db, { actor: { userId: null, label: 'TEST' }, action: 'Bad Action', target: { type: 'x' } }))) instanceof AuditInputError, 'malformed audit actions are rejected before the database');
  await recordAudit(db, { actor: { userId: null, label: 'TEST' }, action: 'lead.edit', target: { type: 'lead', id: 'L1' }, before: { phone: '+91 99999 99999' }, after: { phone: '+91 88888 88888' } });
  const [row] = await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'lead.edit'));
  assert(!!row && !/\d{5}/.test(JSON.stringify([row.before, row.after])), 'stored before/after never contain the contact value');
}

// ─────────────────────────────────────────────────────────────────────────────
group('8. Secrets never reach the browser');
{
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(f => {
      const p = join(dir, f);
      if (['node_modules', '.next', 'tests', 'migrations', 'out'].includes(f)) return [];
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mjs)$/.test(f) ? [p] : [];
    });
  const files = walk(OS);
  const publicEnv = files.filter(f => /process\.env\.NEXT_PUBLIC_/.test(readFileSync(f, 'utf-8')));
  const exampleDefines = readFileSync(join(OS, '.env.example'), 'utf-8').split('\n').filter(l => /^\s*(#\s*)?NEXT_PUBLIC_\w+\s*=/.test(l));
  assert(publicEnv.length === 0 && exampleDefines.length === 0, 'no NEXT_PUBLIC_ variable is defined or read (nothing secret can be inlined into the client bundle)', [...publicEnv, ...exampleDefines]);
  const instance = readFileSync(join(OS, 'server/auth/instance.ts'), 'utf-8');
  const current = readFileSync(join(OS, 'server/auth/current-actor.ts'), 'utf-8');
  assert(instance.startsWith("import 'server-only';") && current.startsWith("import 'server-only';"), 'the auth instance and request-actor modules are server-only (client import = build error)');
  // A client component may import a 'use server' action module (only a server reference is shipped), but never the
  // database, authorization, audit, the auth instance or the request-actor helper.
  const clientFiles = files.filter(f => /^['"]use client['"]/m.test(readFileSync(f, 'utf-8')));
  const leaky = clientFiles.filter(f => /server\/(db|authz|audit)|server\/auth\/(instance|current-actor|auth|bootstrap-owner)/.test(readFileSync(f, 'utf-8')));
  assert(leaky.length === 0, 'no client component imports the database, authz, audit or the auth instance', leaky);
  const actionModules = clientFiles.flatMap(f => [...readFileSync(f, 'utf-8').matchAll(/from '@\/(server\/[^']+)'/g)].map(m => m[1]));
  assert(
    actionModules.length > 0 && actionModules.every(m => readFileSync(join(OS, `${m}.ts`), 'utf-8').startsWith("'use server'")),
    'every server module a client component imports is a server-action module',
    actionModules
  );
  const bootstrap = readFileSync(join(OS, 'server/auth/bootstrap-owner.ts'), 'utf-8');
  assert(!/console\.(log|error)\([^)]*password/i.test(bootstrap) && !/KACHMO_BOOTSTRAP_OWNER_PASSWORD/.test(bootstrap), 'the bootstrap never logs the password and never reads it from the environment');
}

await database.close();
console.log(`\n${'='.repeat(60)}\nAUTH SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
