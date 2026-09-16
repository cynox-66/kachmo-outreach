/**
 * WRITE-PATH GOLDEN SNAPSHOT — Kachmo Methodology v1.0.
 *
 * The v1.0 baseline (methodology-v1.0.baseline.json) pins what the engine DERIVES from stored data. This module
 * pins what the engine WRITES: the call, WhatsApp, pipeline, research-recording and suppression state machines,
 * the CSV export projection, and the events each transition produces.
 *
 * It is a SEPARATE artifact on purpose. The v1.0 baseline file is never reshaped, so an extraction that changed
 * derived behaviour and an extraction that changed write behaviour fail independently and are diagnosable apart.
 *
 * Determinism: the same pinned inputs (git 48cfbc0), a frozen clock, a seeded UUID source and a fixed script of
 * operator actions. Contact values, drafts and notes are hashed, never stored.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { canonical, hash, goldenWorkspace, GOLDEN_TODAY, GOLDEN_NOW } from './snapshot.js';
import type { KachmoLead, SuppressionEntry } from '../../lib/schema.js';

/** Fixed instant every write in the scenario is stamped with. */
export const WRITE_NOW_ISO = new Date(GOLDEN_NOW).toISOString();

/** The operator actions the scenario replays, in order. Each entry is (label, argv) for one CLI entry point. */
export interface ScriptedStep {
  label: string;
  run: (ops: WritePathOps) => void;
}

export interface WritePathOps {
  recordResearch: (argv: string[]) => void;
  logCall: (argv: string[]) => void;
  logWhatsApp: (argv: string[]) => void;
  logPipeline: (argv: string[]) => void;
  suppress: (argv: string[]) => void;
  refresh: () => void;
  exportCsv: (out: string) => string;
}

/**
 * Targets chosen from the pinned dataset for their starting state, not their identity:
 *   111 — has an unsourced phone (the normal "record the source, then call" path)
 *   112 — has an unsourced phone, used for the opt-out path
 *   001 — shows SENT in the production email ledger, so the single-bump follow-up protocol applies
 *   051 — has no phone at all, used to prove call refusals
 *   068 — never emailed, so the ledger cannot support a follow-up
 *   060 — an ordinary lead, used to prove suppression propagation
 */
export const SCENARIO: ScriptedStep[] = [
  {
    label: 'record a publicly listed phone with a source',
    run: o => o.recordResearch(['--lead=111', '--field=phone', '--status=PUBLICLY_LISTED', '--source=https://example.com/111/contact', '--by=AADI']),
  },
  {
    label: 'refuse PUBLICLY_LISTED without a source',
    run: o => o.recordResearch(['--lead=112', '--field=phone', '--status=PUBLICLY_LISTED']),
  },
  {
    label: 'refuse a fabricated, non-URL source',
    run: o => o.recordResearch(['--lead=112', '--field=phone', '--status=PUBLICLY_LISTED', '--source=probably-their-site-dot-com']),
  },
  {
    label: 'refuse VERIFIED without a verification basis',
    run: o => o.recordResearch(['--lead=112', '--field=phone', '--status=VERIFIED']),
  },
  {
    label: 'record the decision maker with a source',
    run: o => o.recordResearch(['--lead=111', '--field=decision-maker', '--value=Jane Roe', '--title=Founder', '--source=https://example.com/111/about', '--by=DEV']),
  },
  {
    label: 'record a commercial signal with a source',
    run: o => o.recordResearch(['--lead=111', '--field=commercial-source', '--source=https://example.com/111/clients', '--by=DEV']),
  },
  {
    label: 'refuse an unknown IANA timezone',
    run: o => o.recordResearch(['--lead=111', '--field=timezone', '--value=Mars/Olympus', '--by=DEV']),
  },
  { label: 're-qualify and re-score', run: o => o.refresh() },
  { label: 'log an unanswered call', run: o => o.logCall(['--lead=111', '--outcome=NO_ANSWER', '--by=AADI']) },
  {
    label: 'log a connected call granting WhatsApp permission and confirming identity',
    run: o => o.logCall(['--lead=111', '--outcome=CALLBACK', '--by=AADI', '--whatsapp-ok', '--confirmed-identity', '--notes=asked to call Thursday']),
  },
  { label: 'refuse --whatsapp-ok on a call nobody answered', run: o => o.logCall(['--lead=111', '--outcome=NO_ANSWER', '--whatsapp-ok']) },
  { label: 'refuse a malformed callback date', run: o => o.logCall(['--lead=111', '--outcome=CALLBACK', '--callback-date=22-09-2026']) },
  { label: 'refuse a call on a lead with no phone', run: o => o.logCall(['--lead=051', '--outcome=NO_ANSWER']) },
  { label: 'refuse SENT before APPROVED', run: o => o.logWhatsApp(['--lead=111', '--status=SENT']) },
  { label: 'approve a WhatsApp draft', run: o => o.logWhatsApp(['--lead=111', '--status=APPROVED', '--by=DEV']) },
  { label: 'log the human send', run: o => o.logWhatsApp(['--lead=111', '--status=SENT', '--by=AADI']) },
  { label: 'refuse a duplicate send', run: o => o.logWhatsApp(['--lead=111', '--status=SENT', '--by=AADI']) },
  { label: 'log the reply', run: o => o.logWhatsApp(['--lead=111', '--status=REPLIED', '--by=AADI']) },
  { label: 'refuse a proposal with no meeting', run: o => o.logPipeline(['--lead=111', '--stage=PROPOSAL_SENT']) },
  { label: 'refuse a reply stage with no channel attribution', run: o => o.logPipeline(['--lead=111', '--stage=REPLIED_POSITIVE']) },
  { label: 'book a meeting', run: o => o.logPipeline(['--lead=111', '--stage=MEETING_BOOKED', '--channel=WHATSAPP', '--date=2026-09-22', '--by=DEV']) },
  { label: 'refuse WON before a proposal', run: o => o.logPipeline(['--lead=111', '--stage=WON']) },
  { label: 'complete the meeting', run: o => o.logPipeline(['--lead=111', '--stage=MEETING_DONE', '--by=DEV']) },
  { label: 'send the proposal', run: o => o.logPipeline(['--lead=111', '--stage=PROPOSAL_SENT', '--value=$6,000', '--by=DEV']) },
  { label: 'win the deal', run: o => o.logPipeline(['--lead=111', '--stage=WON', '--by=DEV']) },
  { label: 'refuse any further stage on a closed deal', run: o => o.logPipeline(['--lead=111', '--stage=LOST', '--reason=BUDGET']) },
  { label: 'log the single email follow-up the ledger supports', run: o => o.logPipeline(['--lead=001', '--stage=FOLLOW_UP_SENT', '--by=DEV']) },
  { label: 'refuse a second bump (single-bump protocol)', run: o => o.logPipeline(['--lead=001', '--stage=FOLLOW_UP_SENT', '--by=DEV']) },
  { label: 'refuse a follow-up the email ledger does not support', run: o => o.logPipeline(['--lead=068', '--stage=FOLLOW_UP_SENT']) },
  { label: 'suppress a lead by target number', run: o => o.suppress(['--lead=060', '--reason=asked to be removed', '--by=DEV']) },
  { label: 'refuse pipeline engagement on the suppressed lead', run: o => o.logPipeline(['--lead=060', '--stage=REPLIED_POSITIVE', '--channel=EMAIL']) },
  { label: 'suppress a bare domain', run: o => o.suppress(['--domain=example-suppressed.com', '--reason=blanket opt-out', '--by=DEV']) },
  { label: 'refuse a freemail domain suppression', run: o => o.suppress(['--domain=gmail.com', '--reason=nope', '--by=DEV']) },
  { label: 'refuse a suppression with no identifier', run: o => o.suppress(['--reason=nothing to match']) },
  { label: 'record an opt-out from a call', run: o => o.logCall(['--lead=112', '--outcome=DO_NOT_CONTACT', '--by=AADI']) },
  { label: 're-qualify after every write', run: o => o.refresh() },
];

const omit = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

/**
 * Replays SCENARIO in a throwaway workspace and records everything it wrote.
 *
 * `ops` binds the CLI entry points; `withFrozenClock` lets the caller pin Date and randomUUID. Refusals are
 * captured as messages, not thrown: a refusal is part of the pinned behaviour.
 */
export function buildWritePathSnapshot(repo: string, ops: WritePathOps, withFrozenClock: <T>(fn: () => T) => T) {
  const workspace = goldenWorkspace(repo);
  const prevCwd = process.cwd();
  const prevToday = process.env.KACHMO_TODAY;
  const steps: Array<{ label: string; outcome: 'applied' | 'refused'; message_sha: string | null }> = [];

  process.chdir(workspace);
  process.env.KACHMO_TODAY = GOLDEN_TODAY;
  const [log, warn, error] = [console.log, console.warn, console.error];
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  let exportedCsv = '';
  try {
    withFrozenClock(() => {
      ops.refresh();
      for (const step of SCENARIO) {
        try {
          step.run(ops);
          steps.push({ label: step.label, outcome: 'applied', message_sha: null });
        } catch (e) {
          steps.push({ label: step.label, outcome: 'refused', message_sha: hash((e as Error).message) });
        }
      }
      ops.exportCsv('export.csv');
      exportedCsv = readFileSync(join(workspace, 'export.csv'), 'utf-8');
    });
  } finally {
    console.log = log;
    console.warn = warn;
    console.error = error;
    process.chdir(prevCwd);
    if (prevToday === undefined) delete process.env.KACHMO_TODAY;
    else process.env.KACHMO_TODAY = prevToday;
  }

  const read = (f: string) => JSON.parse(readFileSync(join(workspace, f), 'utf-8'));
  const leads: KachmoLead[] = read('database/kachmo_leads.json');
  const suppression: SuppressionEntry[] = read('database/suppression.json');
  const eventsFile = join(workspace, 'analytics/events.jsonl');
  const events = existsSync(eventsFile)
    ? readFileSync(eventsFile, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    : [];

  const eventTypeCounts: Record<string, number> = {};
  for (const e of events) eventTypeCounts[e.event_type] = (eventTypeCounts[e.event_type] ?? 0) + 1;

  return {
    methodology_version: '1.0',
    today: GOLDEN_TODAY,
    now: WRITE_NOW_ISO,
    steps,
    leads: leads.map(l => ({
      target_number: l.target_number,
      record_sha: hash(omit(l as unknown as Record<string, unknown>, [])),
      research_state: l.research_state,
      lead_priority: l.lead_priority,
      phone_status: l.phone_status,
      email_status: l.email_status,
      whatsapp_basis: l.whatsapp_basis ?? null,
      whatsapp_outreach_status: l.whatsapp_outreach_status,
      call_status: l.call_status,
      call_attempt_outcomes: (l.call_attempts ?? []).map(a => a.outcome),
      response_status: l.response_status,
      lead_temperature: l.lead_temperature,
      meeting_status: l.meeting_status,
      proposal_status: l.proposal_status,
      deal_stage: l.deal_stage,
      deal_value: l.deal_value,
      do_not_contact: l.do_not_contact ?? null,
      next_action_sha: hash(String(l.next_action)),
      next_action_date: l.next_action_date,
      notes_sha: hash(String(l.notes)),
      research_source_fields: (l.research_sources ?? []).map(s => s.field_covered),
      email_follow_up_sent_at: l.email_follow_up_sent_at ?? null,
    })),
    suppression: {
      count: suppression.length,
      entries: suppression.map(s => ({ target_number: s.target_number ?? null, source: s.source, reason_sha: hash(s.reason), identifiers: Object.keys(s).sort() })),
    },
    events: { count: events.length, by_type: eventTypeCounts, sha: hash(events.map(e => omit(e, ['event_id', 'timestamp']))) },
    csv_export: { bytes: exportedCsv.length, lines: exportedCsv.split('\n').length, sha: hash(exportedCsv) },
  };
}

export { canonical };
