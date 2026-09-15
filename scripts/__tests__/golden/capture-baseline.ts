/**
 * Captures the Methodology v1.0 golden baseline. Run ONCE, on the pre-extraction code.
 *
 * The baseline is the definition of "unchanged behaviour". It must never be regenerated to make a failing
 * golden test pass. A deliberate methodology change gets a NEW baseline file for the NEW version.
 */
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildGoldenSnapshot } from './snapshot.js';
import { legacyPure, legacyPipeline } from './impl-legacy.js';

const REPO = process.cwd();
export const BASELINE_FILE = join(REPO, 'scripts/__tests__/golden/methodology-v1.0.baseline.json');

if (existsSync(BASELINE_FILE)) {
  console.error(`❌ ${BASELINE_FILE} already exists. The v1.0 baseline is immutable; it is never recaptured.`);
  process.exit(1);
}
const snapshot = buildGoldenSnapshot(REPO, legacyPure, legacyPipeline);
writeFileSync(BASELINE_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`✅ Golden baseline written: ${BASELINE_FILE}`);
console.log(`   ${snapshot.pure.lead_count} leads · pipeline leads ${snapshot.pipeline.leads.length} · research queue ${snapshot.pipeline.research_queue.count}`);
