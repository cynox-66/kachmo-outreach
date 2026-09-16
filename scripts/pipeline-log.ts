import { LOST_REASONS } from './lib/schema.js';
import { loadLeads, loadSuppression, findLead, paths } from './lib/store.js';
import { applyDecision } from './lib/apply.js';
import { parseTracker } from './lib/email-state.js';
import { todayIst } from './lib/geo.js';
import { parseArgs, str, oneOf, fail, runCli } from './lib/cli.js';
import { decidePipelineTransition, pipelineLogInputProblem, PIPELINE_STAGES, PIPELINE_CHANNELS } from '../core/state/pipeline.js';

// The sales-stage state machine lives in core/state/pipeline.ts. Re-exported for existing callers.
export { decidePipelineTransition, pipelineLogInputProblem, PIPELINE_STAGES, PIPELINE_CHANNELS, ENGAGING_STAGES, STAGES_NEEDING_CHANNEL } from '../core/state/pipeline.js';

const USAGE =
  `Usage: npm run pipeline:log -- --lead=<target|lead_id> --stage=<${PIPELINE_STAGES.join('|')}> ` +
  `[--channel=${PIPELINE_CHANNELS.join('|')}] [--value="$4,000"] [--reason=${LOST_REASONS.join('|')}] [--date=YYYY-MM-DD] [--by=DEV|AADI] [--notes="..."]`;

/** Sales-stage transitions with enforced ordering: meeting → proposal → won. */
export function logPipeline(argv: string[]): void {
  const args = parseArgs(argv, ['lead', 'stage', 'channel', 'value', 'reason', 'date', 'by', 'notes']);
  const ident = str(args, 'lead');
  const stage = oneOf(str(args, 'stage'), PIPELINE_STAGES, 'stage');
  if (!ident || !stage) fail(USAGE);
  const by = oneOf(str(args, 'by') ?? 'DEV', ['DEV', 'AADI'] as const, 'by')!;

  const input = {
    stage,
    by,
    channel: oneOf(str(args, 'channel'), PIPELINE_CHANNELS, 'channel'),
    value: str(args, 'value') ?? null,
    reason: oneOf(str(args, 'reason'), LOST_REASONS, 'reason'),
    date: str(args, 'date') ?? null,
    notes: str(args, 'notes') ?? null,
  };
  // Flag-level rules are checked before any file is read, so a bad flag never depends on database state.
  const inputProblem = pipelineLogInputProblem(input);
  if (inputProblem) fail(inputProblem);

  const leads = loadLeads();
  const lead = findLead(leads, ident);
  if (!lead) fail(`No lead matches --lead=${ident}.`);

  const decision = decidePipelineTransition(lead, input, {
    today: todayIst(),
    now: new Date().toISOString(),
    suppression: loadSuppression(),
    ledgerStatus: parseTracker(paths().tracker).get(lead.target_number)?.status ?? null,
  });

  applyDecision(leads, lead, decision);
  console.log(`✅ ${decision.summary}`);
}

if (process.argv[1]?.endsWith('pipeline-log.ts')) {
  runCli(() => logPipeline(process.argv.slice(2)));
}
