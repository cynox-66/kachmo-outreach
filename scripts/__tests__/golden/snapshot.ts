/**
 * Golden behaviour snapshot for Kachmo Methodology v1.0.
 *
 * Input is read from a PINNED git commit (never the working tree), copied into a throwaway workspace, and every
 * derived result the engine produces is recorded: per-lead pure results (8 gates, completeness, scores, tiers,
 * provenance, suppression, queue eligibility, research tasks) and the full CLI pipeline output (leads after
 * refresh, research / calling / WhatsApp queues, war room, weekly report, events).
 *
 * Values that contain contact data (emails, phones, message drafts, task text) are stored as SHA-256 hashes so the
 * committed baseline holds no prospect contact details. Timestamps generated at run time are stripped.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import type { KachmoLead, SuppressionEntry } from '../../lib/schema.js';

export const GOLDEN_COMMIT = '48cfbc0a8d3364fc95654c68b9764cc8af7013ab';
export const GOLDEN_TODAY = '2026-09-15';
export const GOLDEN_NOW = Date.parse('2026-09-15T06:00:00.000Z');
export const GOLDEN_INPUTS = [
  'database/kachmo_leads.json',
  'database/suppression.json',
  'database/research-queue.json',
  'analytics/events.jsonl',
  'OUTREACH_TRACKER.md',
  'scheduled-queue.json',
  'kachmo_targets.csv',
];

/** The pure functions under test. Supplied either by the legacy script modules or by core/ directly. */
export interface PureImpl {
  evaluateLeadGates: (lead: KachmoLead, suppression?: SuppressionEntry[], ledger?: string | null) => unknown & { missing: string[] };
  isGenericDecisionMaker: (name: string | null | undefined) => boolean;
  calculateLeadScores: (lead: KachmoLead) => unknown;
  phoneEligibility: (lead: KachmoLead) => unknown;
  emailRoute: (lead: KachmoLead) => unknown;
  whatsappEligibility: (lead: KachmoLead) => unknown;
  classifyEmail: (email?: string | null) => unknown;
  checkSuppression: (lead: KachmoLead, entries: SuppressionEntry[]) => unknown;
  outreachBlock: (lead: KachmoLead, suppression: SuppressionEntry[], ledger?: string | null) => unknown;
  callEligibility: (lead: KachmoLead, suppression: SuppressionEntry[], ledger: string | null, today: string, now?: number) => unknown;
  taskFor: (field: string, lead: KachmoLead) => { field: string } | null;
  buildCallCard: (lead: KachmoLead) => unknown;
  buildWhatsAppDraft: (lead: KachmoLead) => string;
  findInvariantViolations: (leads: KachmoLead[]) => string[];
  findDuplicates: (leads: KachmoLead[]) => Array<{ target_number: string; duplicate_of: string; reason: string }>;
  normalizeCompanyName: (name: string) => string;
  resolveTimezone: (city: string, country: string) => unknown;
  normalizeDomain: (input?: string | null) => string | null;
  normalizeEmail: (e?: string | null) => string | null;
  phoneKey: (p?: string | null) => string | null;
  isUrl: (s?: string | null) => boolean;
  parseTrackerContent: (content: string) => Map<string, { target_number: string; batch: string; email: string | null; phone: string | null; sent_date: string | null; follow_up_due: string | null; status: string }>;
}

/** The CLI pipeline entry points (always the script modules: they are what operators run). */
export interface PipelineImpl {
  refreshLeads: () => void;
  generateCallingQueue: () => unknown;
  generateWhatsAppQueue: () => unknown;
  checkEmailQueue: () => unknown;
  runWarRoom: () => unknown;
  generateWeeklyReport: () => unknown;
}

/** JSON with object keys sorted, so hashes compare meaning, not key insertion order. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map)
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))
      : v
  );
}
export const hash = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const stripIso = (s: string) => s.replace(ISO, '<ts>');
function omit<T extends Record<string, unknown>>(o: T, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
}

function quiet<T>(fn: () => T): T {
  const [log, warn] = [console.log, console.warn];
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

/** Materialises the pinned inputs into a fresh temp directory. The repository working tree is never read or written. */
export function goldenWorkspace(repo: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kachmo-golden-'));
  for (const f of GOLDEN_INPUTS) {
    const content = execFileSync('git', ['show', `${GOLDEN_COMMIT}:${f}`], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), content);
  }
  return dir;
}

export function pureSnapshot(impl: PureImpl, workspace: string) {
  const leads: KachmoLead[] = JSON.parse(readFileSync(join(workspace, 'database/kachmo_leads.json'), 'utf-8'));
  const suppression: SuppressionEntry[] = JSON.parse(readFileSync(join(workspace, 'database/suppression.json'), 'utf-8'));
  const tracker = impl.parseTrackerContent(readFileSync(join(workspace, 'OUTREACH_TRACKER.md'), 'utf-8'));

  const perLead = leads.map(l => {
    const ledger = tracker.get(l.target_number)?.status ?? null;
    const q = impl.evaluateLeadGates(l, suppression, ledger);
    const tasks = q.missing.map(f => impl.taskFor(f, l));
    return {
      lead_id: l.lead_id,
      target_number: l.target_number,
      ledger_status: ledger,
      generic_decision_maker: impl.isGenericDecisionMaker(l.decision_maker_name),
      qualification: q,
      scores: impl.calculateLeadScores(l),
      phone_eligibility: impl.phoneEligibility(l),
      email_route: impl.emailRoute(l),
      email_class: impl.classifyEmail(l.decision_maker_email),
      whatsapp_eligibility: impl.whatsappEligibility(l),
      suppression: impl.checkSuppression(l, suppression),
      outreach_block: impl.outreachBlock(l, suppression, ledger),
      call_eligibility: impl.callEligibility(l, suppression, ledger, GOLDEN_TODAY, GOLDEN_NOW),
      research_task_fields: tasks.map(t => t?.field ?? null),
      research_tasks_sha: hash(tasks),
      call_card_sha: hash(impl.buildCallCard(l)),
      whatsapp_draft_sha: hash(impl.buildWhatsAppDraft(l)),
      invariant_violations: impl.findInvariantViolations([l]).length,
      timezone: impl.resolveTimezone(l.location_city, l.location_country),
      website_is_url: impl.isUrl(l.website_url),
      normalized_domain_sha: hash(String(impl.normalizeDomain(l.website_url))),
      normalized_email_sha: hash(String(impl.normalizeEmail(l.decision_maker_email))),
      phone_key_sha: hash(String(impl.phoneKey(l.decision_maker_phone))),
      company_name_key_sha: hash(impl.normalizeCompanyName(l.company_name)),
    };
  });

  // Synthetic suppression probes: every lead against each suppression identifier kind, built from its own data.
  const probes = leads.map(l => {
    const entry = (e: Partial<SuppressionEntry>): SuppressionEntry[] => [{ reason: 'golden probe', suppressed_at: '', source: 'golden', ...e }];
    return {
      target_number: l.target_number,
      by_lead_id: impl.outreachBlock(l, entry({ lead_id: l.lead_id })),
      by_target: impl.outreachBlock(l, entry({ target_number: l.target_number })),
      by_email: l.decision_maker_email ? impl.outreachBlock(l, entry({ email: l.decision_maker_email.toUpperCase() })) : null,
      by_domain: impl.outreachBlock(l, entry({ domain: `https://www.${l.website_url.replace(/^https?:\/\/(www\.)?/, '')}` })),
      by_phone: l.decision_maker_phone ? impl.outreachBlock(l, entry({ phone: l.decision_maker_phone })) : null,
      by_dnc_flag: impl.outreachBlock({ ...l, do_not_contact: true }, []),
      by_ledger_replied_no: impl.outreachBlock(l, [], 'REPLIED_NO'),
    };
  });

  return {
    lead_count: leads.length,
    per_lead: perLead,
    suppression_probes_sha: hash(probes),
    suppression_probe_blocked_counts: Object.fromEntries(
      (['by_lead_id', 'by_target', 'by_email', 'by_domain', 'by_phone', 'by_dnc_flag', 'by_ledger_replied_no'] as const).map(k => [
        k,
        probes.filter(p => (p[k] as { blocked?: boolean } | null)?.blocked).length,
      ])
    ),
    invariant_violations_all: impl.findInvariantViolations(leads).length,
    duplicates: impl.findDuplicates(leads).map(d => ({ target_number: d.target_number, duplicate_of: d.duplicate_of, kind: d.reason.split(' (')[0], reason_sha: hash(d.reason) })),
    tracker: [...tracker.values()].map(r => ({ ...omit(r, ['email', 'phone']), email_sha: hash(String(r.email)), phone_sha: hash(String(r.phone)) })),
  };
}

export function pipelineSnapshot(impl: PipelineImpl, workspace: string) {
  const prevCwd = process.cwd();
  const prevToday = process.env.KACHMO_TODAY;
  process.chdir(workspace);
  process.env.KACHMO_TODAY = GOLDEN_TODAY;
  try {
    quiet(() => {
      impl.refreshLeads();
      impl.generateCallingQueue();
      impl.generateWhatsAppQueue();
      impl.checkEmailQueue();
      impl.runWarRoom();
      impl.generateWeeklyReport();
    });
  } finally {
    process.chdir(prevCwd);
    if (prevToday === undefined) delete process.env.KACHMO_TODAY;
    else process.env.KACHMO_TODAY = prevToday;
  }

  const read = (f: string) => JSON.parse(readFileSync(join(workspace, f), 'utf-8'));
  const leads: KachmoLead[] = read('database/kachmo_leads.json');
  const researchQueue: any[] = read('database/research-queue.json');
  const calls = read('queues/calling-queue.json');
  const wa = read('queues/whatsapp-queue.json');
  const warRoom = read('queues/daily-war-room.json');
  const weekly = read('analytics/weekly-report.json');
  const events = readFileSync(join(workspace, 'analytics/events.jsonl'), 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const md = (f: string) => (existsSync(join(workspace, f)) ? hash(stripIso(readFileSync(join(workspace, f), 'utf-8'))) : null);

  const eventTypeCounts: Record<string, number> = {};
  for (const e of events) eventTypeCounts[e.event_type] = (eventTypeCounts[e.event_type] ?? 0) + 1;

  return {
    leads: leads.map(l => ({
      lead_id: l.lead_id,
      target_number: l.target_number,
      record_sha: hash(omit(l as unknown as Record<string, unknown>, ['updated_at'])),
      research_state: l.research_state,
      lead_priority: l.lead_priority,
      priority_confidence: l.priority_confidence ?? null,
      kachmo_score: l.kachmo_score,
      commercial_fit_score: l.commercial_fit_score,
      pain_score_normalized: l.pain_score_normalized,
      decision_maker_quality_score: l.decision_maker_quality_score,
      budget_score: l.budget_score,
      intent_trigger_score: l.intent_trigger_score,
      score_signals: l.score_signals ?? null,
      research_completeness_score: l.research_completeness_score,
      qualification_gates: l.qualification_gates,
      missing_intelligence: l.missing_intelligence,
      disqualification_reasons: l.disqualification_reasons ?? null,
      phone_status: l.phone_status,
      email_status: l.email_status,
      whatsapp_basis: l.whatsapp_basis ?? null,
      do_not_contact: l.do_not_contact ?? null,
      recommended_channel: l.recommended_channel,
      secondary_channel: l.secondary_channel,
      channel_reason_sha: hash(String(l.channel_reason)),
      owner: l.owner,
      next_action_sha: hash(String(l.next_action)),
      estimated_project_value: l.estimated_project_value,
    })),
    research_queue: {
      count: researchQueue.length,
      order: researchQueue.map(i => i.target_number),
      items: researchQueue.map(i => ({ target_number: i.target_number, priority: i.priority, status: i.status, owner: i.owner, missing_fields_sha: hash(i.missing_fields), task_fields: i.specific_research_tasks.map((t: any) => t.field) })),
      sha: hash(researchQueue.map(i => omit(i, ['created_at', 'updated_at']))),
    },
    calling_queue: {
      cards: calls.cards.map((c: any) => c.target_number),
      excluded: calls.excluded.map((x: any) => ({ target_number: x.target_number, reason_sha: hash(x.reason) })),
      sha: hash(omit(calls, ['generated_at'])),
    },
    whatsapp_queue: {
      items: wa.items.map((i: any) => ({ target_number: i.target_number, status: i.status })),
      excluded: wa.excluded.map((x: any) => ({ target_number: x.target_number, reason_sha: hash(x.reason) })),
      sha: hash(omit(wa, ['generated_at'])),
    },
    war_room: { alert_count: warRoom.alerts.length, lead_base: warRoom.lead_base, sha: hash(omit(warRoom, ['generated_at'])) },
    weekly_report: { funnel: weekly.funnel, sha: hash(omit(weekly, ['generated_at'])) },
    events: { count: events.length, by_type: eventTypeCounts, new_events_sha: hash(events.map(e => omit(e, ['event_id', 'timestamp']))) },
    markdown_sha: Object.fromEntries(['RESEARCH_QUEUE.md', 'AADI_DAILY_CALLS.md', 'WHATSAPP_QUEUE.md', 'DAILY_WAR_ROOM.md', 'WEEKLY_OUTBOUND_REPORT.md'].map(f => [f, md(f)])),
  };
}

export function buildGoldenSnapshot(repo: string, pure: PureImpl, pipeline: PipelineImpl) {
  const pureWs = goldenWorkspace(repo);
  const pipeWs = goldenWorkspace(repo);
  try {
    return {
      methodology_version: '1.0',
      input_commit: GOLDEN_COMMIT,
      today: GOLDEN_TODAY,
      now: new Date(GOLDEN_NOW).toISOString(),
      pure: pureSnapshot(pure, pureWs),
      pipeline: pipelineSnapshot(pipeline, pipeWs),
    };
  } finally {
    rmSync(pureWs, { recursive: true, force: true });
    rmSync(pipeWs, { recursive: true, force: true });
  }
}

/** Path-level differences between two JSON values (first `limit`). */
export function diffJson(a: unknown, b: unknown, limit = 40, path = '$', out: string[] = []): string[] {
  if (out.length >= limit) return out;
  if (canonical(a) === canonical(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) diffJson((a as any)[k], (b as any)[k], limit, `${path}.${k}`, out);
    return out;
  }
  out.push(`${path}: expected ${JSON.stringify(a)?.slice(0, 160)} but got ${JSON.stringify(b)?.slice(0, 160)}`);
  return out;
}
