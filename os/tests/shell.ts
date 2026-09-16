/**
 * Application shell tests: static guarantees about the Next.js surface. No server is started and no database is used.
 * These assert the boundaries that must hold before any real data reaches the UI.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  existsSync(dir)
    ? readdirSync(dir).flatMap(f => {
        const p = join(dir, f);
        if (['node_modules', '.next'].includes(f)) return [];
        return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
      })
    : [];
const read = (f: string) => readFileSync(f, 'utf-8');
const rel = (f: string) => relative(OS, f);

console.log('\n🖥️  KACHMO OUTBOUND OS — APPLICATION SHELL');

// ─────────────────────────────────────────────────────────────────────────────
group('1. Every authenticated surface enforces access server-side');
{
  const protectedPages = walk(join(APP, '(app)')).filter(f => /\/(page|layout)\.tsx$/.test(f));
  assert(protectedPages.length >= 9, `the shell has its authenticated routes (${protectedPages.length} pages/layouts)`);
  const unguarded = protectedPages.filter(f => !/requirePermission\(|requireActor\(/.test(read(f)));
  assert(unguarded.length === 0, 'every authenticated page and layout calls requireActor or requirePermission', unguarded.map(rel));
  const layout = read(join(APP, '(app)/layout.tsx'));
  assert(/requireActor\(\)/.test(layout), 'the protected layout resolves the actor for every child route');
  const pagesWithPermission = protectedPages.filter(f => f.endsWith('page.tsx'));
  const missingPermission = pagesWithPermission.filter(f => !/requirePermission\('[a-z_]+\.[a-z_]+'\)/.test(read(f)));
  assert(missingPermission.length === 0, 'every page names the exact permission it requires', missingPermission.map(rel));
  assert(protectedPages.every(f => /export const dynamic = 'force-dynamic'/.test(read(f))), 'authenticated routes are never statically pre-rendered');
}

// ─────────────────────────────────────────────────────────────────────────────
group('2. Client/server boundary and secrets');
{
  const files = walk(OS).filter(f => !f.includes(`${'tests'}/`));
  const clientFiles = files.filter(f => /^['"]use client['"]/m.test(read(f)));
  assert(clientFiles.length >= 1, `client components exist (${clientFiles.length}) and are checked`);
  const leaky = clientFiles.filter(f => /@\/server\/(db|authz|audit)|server\/auth\/(instance|current-actor)/.test(read(f)));
  assert(leaky.length === 0, 'no client component imports the database, authz, audit or the auth instance', leaky.map(rel));
  const envInClient = clientFiles.filter(f => /process\.env\./.test(read(f)));
  assert(envInClient.length === 0, 'no client component reads environment variables', envInClient.map(rel));
  assert(files.every(f => !/NEXT_PUBLIC_/.test(read(f))), 'no NEXT_PUBLIC_ variable anywhere in the app');
  const serverOnly = [
    'server/auth/instance.ts',
    'server/auth/current-actor.ts',
    'server/repo/canonical.ts',
    'server/services/dashboard.ts',
    'server/services/leads.ts',
    'server/services/operations.ts',
    'server/services/admin.ts',
    'server/research/service.ts',
  ];
  assert(serverOnly.every(f => read(join(OS, f)).startsWith("import 'server-only';")), 'server-only modules are marked server-only');
}

// ─────────────────────────────────────────────────────────────────────────────
group('3. No engine logic in the interface');
{
  const appFiles = walk(APP);
  const computing = appFiles.filter(f => /evaluateLeadGates\(|calculateLeadScores\(|applyQualification\(|outreachBlock\(|callEligibility\(|PRIORITY_THRESHOLDS/.test(read(f)));
  assert(computing.length === 0, 'no page or component runs qualification, scoring or eligibility logic', computing.map(rel));
  const thresholds = appFiles.filter(f => /(kachmo_score|research_completeness_score|completeness)\s*[<>=]/.test(read(f)));
  assert(thresholds.length === 0, 'no page compares engine scores against its own thresholds', thresholds.map(rel));
  // The services DO call core/ — that is the point: one engine, used by both the CLI and the app. What must never
  // happen is a PAGE computing an engine result, which the two assertions above already forbid.
  const canonical = read(join(OS, 'server/repo/canonical.ts'));
  assert(/source: usePostgres \? 'POSTGRES' : 'GIT_JSON'/.test(canonical), 'the read layer records which store the data actually came from');
  assert(/refusing to display a partial database/.test(canonical), 'a malformed lead store fails closed rather than rendering a partial list');
  const layout = read(join(APP, '(app)/layout.tsx'));
  assert(/phaseBanner/.test(layout), 'every page states which store is canonical rather than implying it');
  const phase = read(join(OS, 'server/repo/phase.ts'));
  assert(/DEFAULT_PHASE: CutoverPhase = 'PRE_CUTOVER'/.test(phase), 'an undeclared cutover phase defaults to PRE_CUTOVER — the read-only, safe direction');
}

// ─────────────────────────────────────────────────────────────────────────────
group('4. Titan boundary and outbound safety in the UI');
{
  const appFiles = [...walk(APP), ...walk(join(OS, 'server'))];
  const mailers = appFiles.filter(f => /from '(nodemailer|imapflow)'|createTransport\(|sendMail\(/.test(read(f)));
  assert(mailers.length === 0, 'the application contains no email-sending code', mailers.map(rel));
  const forceControls = appFiles.filter(f => /--force|forceSend|bypassSuppression|skipSuppression/.test(read(f)));
  assert(forceControls.length === 0, 'no force / suppression-bypass control exists anywhere in the app', forceControls.map(rel));
  const emailPage = read(join(APP, '(app)/email/page.tsx'));
  assert(/Read-only/.test(emailPage) && !/<form/.test(emailPage), 'the email ledger page is read-only (no forms, no send controls)');
}

// ─────────────────────────────────────────────────────────────────────────────
group('5. Security headers, routing and sign-in');
{
  const config = read(join(OS, 'next.config.mjs'));
  for (const header of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'X-Robots-Tag']) {
    assert(config.includes(header), `security header configured: ${header}`);
  }
  assert(/frame-ancestors 'none'/.test(config) && /object-src 'none'/.test(config), 'CSP forbids framing and object embedding');
  assert(/poweredByHeader: false/.test(config), 'the framework fingerprint header is disabled');

  const proxy = read(join(OS, 'proxy.ts'));
  assert(/Optimistic redirect only/.test(proxy) && /pathname === '\/login' \|\| pathname.startsWith\('\/api\/auth'\)/.test(proxy), 'the proxy only performs optimistic redirects and exempts login and auth endpoints');
  assert(!/getSession|loadActor|assertPermission/.test(proxy), 'the proxy makes no authorization decision');

  const actions = read(join(OS, 'server/auth/actions.ts'));
  assert(/auth.handler\(/.test(actions), 'sign-in goes through the Better Auth handler, so rate limiting and origin checks apply');
  assert(/Invalid email or password/.test(actions) && !/no such user|unknown email|user not found/i.test(actions), 'the sign-in error never reveals whether an account exists');
  assert(/auth.sign_in_failed/.test(actions) && /hashIp\(/.test(actions), 'failed sign-ins are audited with a hashed IP, not a raw address');
  assert(/httpOnly: true/.test(actions), 'session cookies are set HttpOnly when forwarded from the handler');
  const loginForm = read(join(APP, 'login/login-form.tsx'));
  assert(loginForm.includes('minLength={12}') && loginForm.includes('autoComplete="current-password"'), 'the login form matches the password policy');
  assert(/There is no public sign-up/.test(loginForm), 'the login page states that accounts are created by an owner');
  assert(!existsSync(join(APP, 'signup')) && !existsSync(join(APP, 'register')), 'no sign-up route exists');
}

console.log(`\n${'='.repeat(60)}\nSHELL SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
