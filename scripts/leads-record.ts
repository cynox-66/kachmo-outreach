import { loadLeads, findLead } from './lib/store.js';
import { applyDecision } from './lib/apply.js';
import { todayIst } from './lib/geo.js';
import { parseArgs, str, oneOf, fail, runCli } from './lib/cli.js';
import { decideResearchRecord, RECORDABLE_FIELDS, CONTACT_PROVENANCE_VALUES, type RecordableField } from '../core/state/research-record.js';

// Research-recording provenance rules live in core/state/research-record.ts. Re-exported for existing callers.
export { decideResearchRecord, RECORDABLE_FIELDS } from '../core/state/research-record.js';

const USAGE =
  `Usage: npm run leads:record -- --lead=<target> --field=<${RECORDABLE_FIELDS.join('|')}> ` +
  `[--value=...] [--status=${CONTACT_PROVENANCE_VALUES.join('|')}] [--source=<https url>] [--basis="..."] [--title="..."] [--by=DEV|AADI]`;

/** Node's Intl is the authority on IANA zone names; core/ stays free of platform assumptions. */
const isKnownTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** How humans record research. Provenance rules are enforced here and again by saveLeads() invariants. */
export function recordResearch(argv: string[]): void {
  const args = parseArgs(argv, ['lead', 'field', 'value', 'status', 'source', 'source-type', 'basis', 'title', 'by', 'date']);
  const ident = str(args, 'lead');
  const field = str(args, 'field')?.toLowerCase();
  if (!ident || !field || !(RECORDABLE_FIELDS as readonly string[]).includes(field)) fail(USAGE);
  const by = oneOf(str(args, 'by') ?? 'DEV', ['DEV', 'AADI'] as const, 'by')!;

  const leads = loadLeads();
  const lead = findLead(leads, ident);
  if (!lead) fail(`No lead matches --lead=${ident}.`);

  const decision = decideResearchRecord(
    lead,
    {
      field: field as RecordableField,
      by,
      byExplicit: !!args.by,
      value: str(args, 'value') ?? null,
      status: str(args, 'status') ?? null,
      source: str(args, 'source') ?? null,
      sourceType: str(args, 'source-type') ?? null,
      basis: str(args, 'basis') ?? null,
      title: str(args, 'title') ?? null,
      date: str(args, 'date') ?? null,
    },
    { today: todayIst(), now: new Date().toISOString(), isKnownTimezone }
  );

  applyDecision(leads, lead, decision);
  console.log(`✅ ${decision.summary}`);
}

if (process.argv[1]?.endsWith('leads-record.ts')) {
  runCli(() => recordResearch(process.argv.slice(2)));
}
