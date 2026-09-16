import { CALL_OUTCOMES, OBJECTION_CATEGORIES } from './lib/schema.js';
import { loadLeads, loadSuppression, findLead, paths } from './lib/store.js';
import { applyDecision } from './lib/apply.js';
import { parseTracker } from './lib/email-state.js';
import { todayIst } from './lib/geo.js';
import { parseArgs, str, oneOf, fail, runCli } from './lib/cli.js';
import { generateCallingQueue } from './queue-calls.js';
import { decideCallOutcome, callLogInputProblem } from '../core/state/call.js';

// The call state machine lives in core/state/call.ts. Re-exported for existing callers.
export { decideCallOutcome, callLogInputProblem, isCallConnected, CALL_NOT_CONNECTED, CALL_UNANSWERED } from '../core/state/call.js';

const USAGE =
  'Usage: npm run calls:log -- --lead=<target|lead_id> --outcome=<' + CALL_OUTCOMES.join('|') + '> ' +
  '[--notes="..."] [--objection="..."] [--objection-category=' + OBJECTION_CATEGORIES.join('|') + '] ' +
  '[--callback-date=YYYY-MM-DD] [--by=AADI|DEV] [--whatsapp-ok] [--confirmed-identity]';

export function logCallOutcome(argv: string[]): void {
  const args = parseArgs(argv, ['lead', 'outcome', 'notes', 'objection', 'objection-category', 'callback-date', 'by', 'whatsapp-ok', 'confirmed-identity']);
  const ident = str(args, 'lead');
  const outcomeRaw = str(args, 'outcome');
  if (!ident || !outcomeRaw) fail(USAGE);
  const outcome = oneOf(outcomeRaw, CALL_OUTCOMES, 'outcome')!;
  const by = oneOf(str(args, 'by') ?? 'AADI', ['AADI', 'DEV'] as const, 'by')!;
  const objectionCategory = oneOf(str(args, 'objection-category'), OBJECTION_CATEGORIES, 'objection-category') ?? null;

  const input = {
    outcome,
    by,
    notes: str(args, 'notes') ?? null,
    objection: str(args, 'objection') ?? null,
    objectionCategory,
    callbackDate: str(args, 'callback-date') ?? null,
    whatsappOk: !!args['whatsapp-ok'],
    confirmedIdentity: !!args['confirmed-identity'],
  };
  // Flag-level rules are checked before any file is read, so a bad flag never depends on database state.
  const inputProblem = callLogInputProblem(input);
  if (inputProblem) fail(inputProblem);

  const leads = loadLeads();
  const lead = findLead(leads, ident);
  if (!lead) fail(`No lead matches --lead=${ident}. Use a target number (e.g. 111) or a lead_id.`);

  const decision = decideCallOutcome(lead, input, {
    today: todayIst(),
    now: new Date().toISOString(),
    suppression: loadSuppression(),
    ledgerStatus: parseTracker(paths().tracker).get(lead.target_number)?.status ?? null,
  });

  applyDecision(leads, lead, decision);
  console.log(`✅ ${decision.summary}`);
  generateCallingQueue();
}

if (process.argv[1]?.endsWith('call-log.ts')) {
  runCli(() => logCallOutcome(process.argv.slice(2)));
}
