/**
 * GOLDEN REGRESSION TEST — Kachmo Methodology v1.0.
 *
 * Proves that the qualification / scoring / provenance / suppression / queue behaviour over the real 120-lead
 * dataset (pinned at a git commit, materialised into a temp workspace) is exactly what it was before core/ was
 * extracted. Deterministic: fixed date and clock, no network, no LLM, never touches the working tree.
 *
 * If this fails, behaviour changed. Investigate the diff. Do NOT regenerate the baseline to make it pass.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve, dirname, sep } from 'path';
import { buildGoldenSnapshot, diffJson, canonical } from './golden/snapshot.js';
import { legacyPure, legacyPipeline } from './golden/impl-legacy.js';
import { corePure } from './golden/impl-core.js';

const REPO = process.cwd();
const BASELINE_FILE = join(REPO, 'scripts/__tests__/golden/methodology-v1.0.baseline.json');
if (!existsSync(join(REPO, 'scripts/__tests__/golden-v1.ts'))) {
  console.error('Run from Clients/mails (npm run test:golden).');
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
    console.error(`  ❌ ${name}${detail !== undefined ? `\n     ${Array.isArray(detail) ? detail.join('\n     ') : JSON.stringify(detail)}` : ''}`);
  }
}

console.log('\n🥇 GOLDEN BEHAVIOUR — METHODOLOGY v1.0');
const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8'));
assert(baseline.methodology_version === '1.0' && baseline.pure.lead_count === 120, 'baseline is the v1.0 capture over 120 leads', { v: baseline.methodology_version, n: baseline.pure.lead_count });

const sections = (label: string, expected: any, actual: any) => {
  const ids = (x: any) => x.pure.per_lead.map((l: any) => l.lead_id);
  assert(canonical(ids(actual)) === canonical(ids(expected)), `${label}: lead IDs identical (${ids(actual).length})`);
  const perLeadKeys: Array<[string, string]> = [
    ['qualification', 'qualification (8 gates, missing intelligence, completeness, state, reasons)'],
    ['scores', 'scores, tiers and priority confidence'],
    ['phone_eligibility', 'phone provenance eligibility'],
    ['email_route', 'email route quality'],
    ['whatsapp_eligibility', 'WhatsApp eligibility'],
    ['suppression', 'suppression match'],
    ['outreach_block', 'outreach block'],
    ['call_eligibility', 'call queue eligibility'],
    ['research_tasks_sha', 'research tasks'],
    ['call_card_sha', 'call cards'],
    ['whatsapp_draft_sha', 'WhatsApp drafts'],
  ];
  for (const [key, name] of perLeadKeys) {
    const pick = (x: any) => x.pure.per_lead.map((l: any) => ({ tn: l.target_number, v: l[key] }));
    assert(canonical(pick(actual)) === canonical(pick(expected)), `${label}: ${name} identical for all leads`, diffJson(pick(expected), pick(actual), 10));
  }
  const rest = (x: any) => ({ ...x.pure, per_lead: x.pure.per_lead.map((l: any) => ({ ...l })) });
  assert(canonical(rest(actual)) === canonical(rest(expected)), `${label}: every pure result identical (provenance keys, timezone, dedupe, invariants, tracker, suppression probes)`, diffJson(rest(expected), rest(actual), 15));
};

// 1. CLI entry points (what operators run) → full pipeline + pure functions.
const viaCli = buildGoldenSnapshot(REPO, legacyPure, legacyPipeline);
sections('CLI modules', baseline, viaCli);
const pipeKeys: Array<[string, string]> = [
  ['leads', 'leads after refresh (states, gates, scores, tiers, channels, full record hash)'],
  ['research_queue', 'research queue (order, tasks, status)'],
  ['calling_queue', 'calling queue'],
  ['whatsapp_queue', 'WhatsApp queue'],
  ['war_room', 'war room'],
  ['weekly_report', 'weekly report'],
  ['events', 'event log (types and payloads)'],
  ['markdown_sha', 'operator markdown files'],
];
for (const [key, name] of pipeKeys) {
  assert(canonical(viaCli.pipeline[key as keyof typeof viaCli.pipeline]) === canonical(baseline.pipeline[key]), `CLI pipeline: ${name} identical`, diffJson(baseline.pipeline[key], viaCli.pipeline[key as keyof typeof viaCli.pipeline], 10));
}

// 2. core/ directly (what the hosted app will call) → pure functions must equal the same baseline.
const viaCore = { ...viaCli, pure: buildGoldenSnapshot(REPO, corePure, legacyPipeline).pure };
sections('core/', baseline, viaCore);

// 3. Determinism.
assert(canonical(buildGoldenSnapshot(REPO, corePure, legacyPipeline)) === canonical(viaCore), 'a second run produces a byte-identical snapshot (deterministic)');

// 4. core/ dependency boundary: pure domain logic, no I/O, nothing imported from outside core/.
console.log('\ncore/ dependency boundary');
{
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(f => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
  const coreDir = join(REPO, 'core');
  const files = walk(coreDir);
  const offenders = (re: RegExp) => files.filter(f => re.test(readFileSync(f, 'utf-8'))).map(f => relative(REPO, f));
  assert(files.length >= 15, `core/ holds the extracted domain modules (${files.length} files)`);
  assert(offenders(/from ['"](node:)?(fs|path|os|child_process|crypto|http|https|net|tls|dns|worker_threads)(\/[\w/]+)?['"]/).length === 0, 'core/ imports no Node I/O modules', offenders(/from ['"](node:)?(fs|path|os|child_process|crypto|http|https|net|tls|dns|worker_threads)/));
  assert(offenders(/from ['"](dotenv|nodemailer|imapflow|pg|drizzle-orm|better-auth|next)['"]|require\(/).length === 0, 'core/ imports no persistence, mail, auth or framework packages');
  assert(offenders(/\bprocess\.|\bfetch\(|XMLHttpRequest|localStorage|document\./).length === 0, 'core/ reads no environment and makes no network or browser calls', offenders(/\bprocess\.|\bfetch\(/));
  const escapes = files.flatMap(f =>
    [...readFileSync(f, 'utf-8').matchAll(/from ['"](\.[^'"]+)['"]/g)]
      .map(m => resolve(dirname(f), m[1]))
      .filter(target => !target.startsWith(coreDir + sep))
      .map(target => `${relative(REPO, f)} → ${relative(REPO, target)}`)
  );
  assert(escapes.length === 0, 'core/ never imports from scripts/, os/ or anything outside core/', escapes);
  const scriptSrc = walk(join(REPO, 'scripts')).filter(f => !f.includes('__tests__'));
  const dupGates = scriptSrc.filter(f => /gate_1_decision_maker:\s*gate1|COMMERCIAL_SIGNALS\s*[:=]|function\s+evaluateLeadGates|function\s+calculateLeadScores|function\s+callEligibility|function\s+outreachBlock/.test(readFileSync(f, 'utf-8')));
  assert(dupGates.length === 0, 'scripts/ contains no second copy of qualification, scoring, call eligibility or suppression logic', dupGates.map(f => relative(REPO, f)));
}

console.log(`\n${'='.repeat(60)}\nGOLDEN SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map(f => `  - ${f}`).join('\n'));
  console.log('\nBehaviour changed. Investigate; never regenerate the v1.0 baseline to make this pass.');
  process.exit(1);
}
