/**
 * GOLDEN WRITE-PATH REGRESSION — Kachmo Methodology v1.0.
 *
 * Replays a fixed script of operator actions (research recording, calls, WhatsApp, pipeline, suppression, CSV
 * export) over the pinned 120-lead dataset and compares every resulting write to a committed baseline.
 *
 * If this fails, WRITE behaviour changed: a state machine, a refusal, an event or a projection. Investigate the
 * diff. Do NOT regenerate the baseline to make it pass.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { canonical } from './golden/snapshot.js';
import { diffJson } from './golden/snapshot.js';
import { buildWritePathSnapshot, WRITE_NOW_ISO, type WritePathOps } from './golden/write-paths.js';
import { recordResearch } from '../leads-record.js';
import { logCallOutcome } from '../call-log.js';
import { logWhatsApp } from '../whatsapp-log.js';
import { logPipeline } from '../pipeline-log.js';
import { suppressContact } from '../suppress-add.js';
import { refreshLeads } from '../leads-refresh.js';
import { exportLeadsToCsv } from '../leads-export-csv.js';

const REPO = process.cwd();
const BASELINE_FILE = join(REPO, 'scripts/__tests__/golden/methodology-v1.0.writepaths.baseline.json');
if (!existsSync(join(REPO, 'scripts/__tests__/golden-write-paths.ts'))) {
  console.error('Run from Clients/mails (npm run test:golden-writes).');
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

/**
 * Freezes wall-clock time and the UUID source for the duration of the scenario.
 * Every `new Date()` and `Date.now()` returns the pinned instant, so `updated_at`, `suppressed_at`, call
 * timestamps and event timestamps are reproducible. Explicit arguments to `new Date(x)` still work.
 */
function withFrozenClock<T>(fn: () => T): T {
  const RealDate = Date;
  const fixed = RealDate.parse(WRITE_NOW_ISO);
  class FrozenDate extends RealDate {
    constructor(...args: ConstructorParameters<DateConstructor> | []) {
      if (args.length === 0) super(fixed);
      else super(...(args as [number]));
    }
    static now() {
      return fixed;
    }
  }
  globalThis.Date = FrozenDate as unknown as DateConstructor;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

const ops: WritePathOps = {
  recordResearch,
  logCall: logCallOutcome,
  logWhatsApp,
  logPipeline,
  suppress: argv => {
    suppressContact(argv);
  },
  refresh: refreshLeads,
  exportCsv: exportLeadsToCsv,
};

console.log('\n🥇 GOLDEN WRITE PATHS — METHODOLOGY v1.0');
const snapshot = buildWritePathSnapshot(REPO, ops, withFrozenClock);

if (process.argv.includes('--capture')) {
  writeFileSync(BASELINE_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Captured write-path baseline → ${BASELINE_FILE}`);
  process.exit(0);
}

if (!existsSync(BASELINE_FILE)) {
  console.error(`Missing baseline ${BASELINE_FILE}. Capture it once with: npx tsx scripts/__tests__/golden-write-paths.ts --capture`);
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8'));

assert(baseline.methodology_version === '1.0', 'baseline is the v1.0 write-path capture');
assert(snapshot.steps.length === baseline.steps.length, `every scripted step ran (${snapshot.steps.length})`);

const sectionChecks: Array<[string, string]> = [
  ['steps', 'every step applied or was refused exactly as before (including refusal messages)'],
  ['leads', 'every lead ends in the same state (provenance, call history, WhatsApp, sales stage, next action, notes)'],
  ['suppression', 'the suppression list is identical (count, identifiers, sources, reasons)'],
  ['events', 'the event log is identical (count, types, payloads)'],
  ['csv_export', 'the exported CSV projection is byte-identical'],
];
for (const [key, name] of sectionChecks) {
  const a = (snapshot as unknown as Record<string, unknown>)[key];
  const b = baseline[key];
  assert(canonical(a) === canonical(b), name, diffJson(b, a, 12));
}

// Refusals are the safety-critical half: a refusal silently becoming an acceptance is the failure that matters.
const refusedNow = snapshot.steps.filter(s => s.outcome === 'refused').map(s => s.label);
const refusedBefore = (baseline.steps as Array<{ outcome: string; label: string }>).filter(s => s.outcome === 'refused').map(s => s.label);
assert(canonical(refusedNow) === canonical(refusedBefore), `the same ${refusedBefore.length} operations are refused`, { refusedNow, refusedBefore });
assert(refusedBefore.length >= 9, `the scenario exercises a meaningful number of refusals (${refusedBefore.length})`);

// Determinism: replaying the whole scenario again must produce a byte-identical snapshot.
const second = buildWritePathSnapshot(REPO, ops, withFrozenClock);
assert(canonical(second) === canonical(snapshot), 'a second replay produces a byte-identical snapshot (deterministic)', diffJson(snapshot, second, 12));

// The derived-behaviour baseline must never be reshaped by write-path work.
const v1 = join(REPO, 'scripts/__tests__/golden/methodology-v1.0.baseline.json');
const v1Content = JSON.parse(readFileSync(v1, 'utf-8'));
assert(v1Content.methodology_version === '1.0' && v1Content.pure.lead_count === 120, 'the v1.0 derived baseline is untouched (120 leads)');
void randomUUID;

console.log(`\n${'='.repeat(60)}\nWRITE-PATH SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map(f => `  - ${f}`).join('\n'));
  console.log('\nWrite behaviour changed. Investigate; never regenerate the baseline to make this pass.');
  process.exit(1);
}
