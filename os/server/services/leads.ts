import 'server-only';
import type { QualificationGates, KachmoLead } from '@kachmo/core/leads/schema.js';
import { evaluateLeadGates } from '@kachmo/core/qualification/gates.js';
import { calculateLeadScores } from '@kachmo/core/scoring/score.js';
import { outreachBlock, checkSuppression } from '@kachmo/core/suppression/match.js';
import { phoneEligibility, emailRoute, whatsappEligibility, isUrl } from '@kachmo/core/contact/provenance.js';
import { callEligibility } from '@kachmo/core/queues/calls.js';
import { taskFor } from '@kachmo/core/research/tasks.js';
import { findDuplicates } from '@kachmo/core/leads/dedupe.js';
import { archetypeById, verticalFromLabel } from '@kachmo/core/config/taxonomy.js';
import { priorityLabel } from '@kachmo/core/util/text.js';
import type { Actor } from '../authz/authorize';
import { contactsFor, scrubContactValues, type LeadContacts } from './contacts';
import { loadCanonical, ledgerStatusOf, type CanonicalSnapshot } from '../repo/canonical';
import { presentedNextAction, presentedStage } from './ledger-view';
import { GATE_LABELS as OPERATOR_GATE_LABELS, operatorStatus, statusMatches, nextActionLabel, type OperatorStatus } from './operator';

/**
 * The lead read surface.
 *
 * Every derived value comes from `core/` — the same functions the CLI runs — so a number on screen and a number in
 * AADI_DAILY_CALLS.md can never disagree. Nothing is recomputed differently for the web.
 */

export const LEAD_SORTS = ['attention', 'priority', 'score', 'research', 'company', 'target', 'next_action'] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];

export interface LeadFilters {
  q?: string;
  archetype?: string;
  vertical?: string;
  country?: string;
  researchState?: string;
  priority?: string;
  /** 'callable' | 'emailable' | 'none' */
  contactability?: string;
  suppressed?: 'yes' | 'no';
  pipeline?: string;
  /** An operator status filter (operator.ts STATUS_FILTERS). */
  status?: string;
  sort?: LeadSort;
  page?: number;
  pageSize?: number;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** The operational projection: what an operator needs to triage a list, not every field on the record. */
export interface LeadRow {
  leadId: string;
  targetNumber: string;
  company: string;
  archetype: string;
  vertical: string | null;
  country: string;
  city: string;
  researchState: string;
  priority: string;
  priorityConfidence: string | null;
  priorityLabel: string;
  score: number | null;
  researchCompleteness: number;
  /** Whether this lead can actually be contacted today, and how. */
  contactability: { callable: boolean; emailable: boolean; whatsapp: boolean; summary: string };
  suppressed: boolean;
  /** Why it is blocked, when it is (core's outreachBlock reason). */
  blockReason: string | null;
  pipelineStage: string;
  emailLedgerStatus: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  owner: string | null;
  /** Where the company stands, in one operator label and sentence (ADR-035). */
  status: OperatorStatus;
  /** Whether it is in the automatic email queue right now. */
  queued: boolean;
}

const pipelineStageOf = (l: KachmoLead): string =>
  l.deal_stage ?? (l.proposal_status === 'SENT' ? 'PROPOSAL_SENT' : null) ?? (l.meeting_status ? `MEETING_${l.meeting_status}` : null) ?? l.response_status ?? l.lead_state ?? 'NONE';

const istDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

function toRow(lead: KachmoLead, snapshot: CanonicalSnapshot, today: string = istDay()): LeadRow {
  const ledger = ledgerStatusOf(snapshot)(lead.target_number);
  const block = outreachBlock(lead, snapshot.suppression, ledger);
  const blocked = block.blocked;
  const queued = snapshot.scheduled.some(s => s.targetNumber === lead.target_number);
  const callable = phoneEligibility(lead).ok && !blocked;
  const emailable = emailRoute(lead).quality === 'DIRECT' && !blocked;
  const whatsapp = whatsappEligibility(lead).ok && !blocked;
  const routes = [callable && 'call', emailable && 'email', whatsapp && 'WhatsApp'].filter(Boolean) as string[];
  return {
    leadId: lead.lead_id,
    targetNumber: lead.target_number,
    company: lead.company_name,
    archetype: lead.archetype_id,
    vertical: verticalFromLabel(lead.archetype_id, lead.archetype_label),
    country: lead.location_country,
    city: lead.location_city,
    researchState: lead.research_state,
    priority: lead.lead_priority ?? 'UNSCORED',
    priorityConfidence: lead.priority_confidence ?? null,
    priorityLabel: priorityLabel(lead.lead_priority, lead.priority_confidence),
    score: lead.kachmo_score,
    researchCompleteness: lead.research_completeness_score,
    contactability: { callable, emailable, whatsapp, summary: blocked ? 'suppressed' : routes.length ? routes.join(' · ') : 'no usable route' },
    suppressed: blocked,
    blockReason: block.reason,
    pipelineStage: presentedStage(pipelineStageOf(lead), ledger),
    emailLedgerStatus: ledger,
    nextAction: nextActionLabel(presentedNextAction(lead.next_action, ledger)),
    nextActionDate: lead.next_action_date,
    owner: lead.owner,
    status: operatorStatus({ lead, ledger: snapshot.tracker.get(lead.target_number) ?? null, blocked: block, queued, today }),
    queued,
  };
}

const PRIORITY_ORDER: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3, UNSCORED: 4, DISQUALIFIED: 5 };
/** "Needs you" first, then everything in motion, then closed, then do-not-contact last. */
const TONE_ORDER: Record<string, number> = { act: 0, neutral: 1, done: 2, stop: 3 };

function sortRows(rows: LeadRow[], sort: LeadSort): LeadRow[] {
  const by = [...rows];
  const byPriority = (a: LeadRow, b: LeadRow) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) || (b.score ?? -1) - (a.score ?? -1) || a.targetNumber.localeCompare(b.targetNumber);
  switch (sort) {
    case 'attention':
      return by.sort((a, b) => (TONE_ORDER[a.status.tone] ?? 9) - (TONE_ORDER[b.status.tone] ?? 9) || byPriority(a, b));
    case 'score':
      return by.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.targetNumber.localeCompare(b.targetNumber));
    case 'research':
      return by.sort((a, b) => a.researchCompleteness - b.researchCompleteness || a.targetNumber.localeCompare(b.targetNumber));
    case 'company':
      return by.sort((a, b) => a.company.localeCompare(b.company));
    case 'target':
      return by.sort((a, b) => a.targetNumber.localeCompare(b.targetNumber));
    case 'next_action':
      // Leads with work due soonest first; leads with no date last.
      return by.sort((a, b) => (a.nextActionDate ?? '9999').localeCompare(b.nextActionDate ?? '9999') || a.targetNumber.localeCompare(b.targetNumber));
    case 'priority':
    default:
      return by.sort(
        (a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) || (b.score ?? -1) - (a.score ?? -1) || a.targetNumber.localeCompare(b.targetNumber)
      );
  }
}

export interface LeadListResult {
  rows: LeadRow[];
  total: number;
  matched: number;
  page: number;
  pageSize: number;
  pages: number;
  facets: {
    archetypes: Array<{ value: string; label: string; count: number }>;
    verticals: Array<{ value: string; count: number }>;
    countries: Array<{ value: string; count: number }>;
    researchStates: Array<{ value: string; count: number }>;
    priorities: Array<{ value: string; count: number }>;
    pipelineStages: Array<{ value: string; count: number }>;
  };
  snapshot: CanonicalSnapshot;
}

const tally = (values: Array<string | null>) => {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
};

/**
 * Filtered, sorted, paginated leads.
 *
 * Bounded by construction: `pageSize` is clamped, so no request can ask the server for the whole database at once.
 * Filtering happens server-side; the browser never receives rows it is not showing.
 */
export async function listLeads(filters: LeadFilters, snapshot?: CanonicalSnapshot): Promise<LeadListResult> {
  const snap = snapshot ?? (await loadCanonical());
  const today = istDay();
  const all = snap.leads.map(l => toRow(l, snap, today));

  const q = filters.q?.trim().toLowerCase();
  const matchedRows = all.filter(r => {
    if (q && !(`${r.company} ${r.targetNumber} ${r.city} ${r.country} ${r.vertical ?? ''}`.toLowerCase().includes(q))) return false;
    if (filters.archetype && r.archetype !== filters.archetype) return false;
    if (filters.vertical && r.vertical !== filters.vertical) return false;
    if (filters.country && r.country !== filters.country) return false;
    if (filters.researchState && r.researchState !== filters.researchState) return false;
    if (filters.priority && r.priority !== filters.priority) return false;
    if (filters.pipeline && r.pipelineStage !== filters.pipeline) return false;
    if (filters.suppressed === 'yes' && !r.suppressed) return false;
    if (filters.suppressed === 'no' && r.suppressed) return false;
    if (filters.contactability === 'callable' && !r.contactability.callable) return false;
    if (filters.contactability === 'emailable' && !r.contactability.emailable) return false;
    if (filters.contactability === 'none' && (r.contactability.callable || r.contactability.emailable)) return false;
    if (filters.status && !statusMatches(filters.status, r.status)) return false;
    return true;
  });

  const pageSize = Math.min(Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(matchedRows.length / pageSize));
  const page = Math.min(Math.max(1, filters.page ?? 1), pages);
  const sorted = sortRows(matchedRows, filters.sort ?? 'priority');

  return {
    rows: sorted.slice((page - 1) * pageSize, page * pageSize),
    total: all.length,
    matched: matchedRows.length,
    page,
    pageSize,
    pages,
    facets: {
      archetypes: tally(all.map(r => r.archetype)).map(a => ({ ...a, label: archetypeById(a.value)?.name ?? a.value })),
      verticals: tally(all.map(r => r.vertical)),
      countries: tally(all.map(r => r.country)),
      researchStates: tally(all.map(r => r.researchState)),
      priorities: tally(all.map(r => r.priority)),
      pipelineStages: tally(all.map(r => r.pipelineStage)),
    },
    snapshot: snap,
  };
}

/** One recorded research source, with an honest statement of how far its evidence has actually been taken. */
export interface ProvenanceItem {
  field: string;
  sourceUrl: string | null;
  sourceType: string;
  recordedBy: string | null;
  recordedOn: string | null;
  confidence: string;
  /** Phase 1.5 evidence vocabulary: a URL nobody fetched is URL_SHAPED, not proof. */
  evidenceLevel: 'NONE' | 'CLAIMED' | 'URL_SHAPED';
  note: string;
}

export interface GateExplanation {
  gate: string;
  label: string;
  outcome: string;
  blocking: boolean;
  meaning: string;
}

// One gate-label table for the whole app, keyed by core's gate keys (ADR-035).
const GATE_LABELS = OPERATOR_GATE_LABELS as Record<string, string>;
const NON_BLOCKING_GATES = new Set(['gate_6_budget_probability', 'gate_7_buying_intent']);
const OUTCOME_MEANING: Record<string, string> = {
  PASS: 'satisfied, with a recorded source',
  UNVERIFIED: 'claimed but unsourced — does not block, but must not be stated as fact',
  PENDING: 'required information is missing — research needed',
  UNKNOWN: 'optional information, not researched — never blocks',
  FAIL: 'evidence that disqualifies',
};

export interface LeadDetail {
  lead: KachmoLead;
  /** The stored version (POST_CUTOVER), carried by every operator form so a stale write is refused. */
  version: number | null;
  /**
   * Where the STORED derived state disagrees with what the engine computes now from the stored inputs. Empty in a
   * healthy database: every Phase B write re-evaluates in the same transaction. Non-empty means a re-evaluation run
   * is due (or something wrote the record outside the applier) — shown, never silently papered over.
   */
  drift: string[];
  row: LeadRow;
  contacts: LeadContacts;
  gates: GateExplanation[];
  /** The gate outcomes as core produced them, for callers that measure against them (evidence coverage). */
  qualificationGates: QualificationGates;
  missingIntelligence: string[];
  reasons: string[];
  scores: ReturnType<typeof calculateLeadScores>;
  provenance: ProvenanceItem[];
  duplicates: Array<{ targetNumber: string; duplicateOf: string; reason: string }>;
  suppression: { suppressed: boolean; reason: string | null };
  callEligibility: { ok: boolean; reason: string };
  researchTasks: Array<{ field: string; task: string; evidenceNeeded: string; recordWith: string }>;
  emailLedger: { status: string | null; batch: string | null; sentDate: string | null; followUpDue: string | null };
  archetypeName: string;
  opportunity: { scope: string | null; value: string | null; channel: string | null; secondary: string | null; reason: string | null };
}

/**
 * Everything known about one lead, assembled for the detail page and the "why this lead?" explanation.
 *
 * Every gate outcome, score and reason is recomputed here by `core/` from the stored record, so the page shows the
 * engine's actual answer rather than a cached string. Nothing is inferred and no reasoning is narrated: the page
 * shows stored facts and deterministic rule outcomes only.
 */
export async function getLeadDetail(identifier: string, actor: Actor, snapshot?: CanonicalSnapshot): Promise<LeadDetail | null> {
  const snap = snapshot ?? (await loadCanonical());
  const id = identifier.trim();
  const tn = /^\d{1,3}$/.test(id) ? id.padStart(3, '0') : id;
  const lead = snap.leads.find(l => l.target_number === tn || l.lead_id === id);
  if (!lead) return null;

  const ledger = ledgerStatusOf(snap)(lead.target_number);
  const q = evaluateLeadGates(lead, snap.suppression, ledger);
  const gateEntries = Object.entries(q.gates) as Array<[string, string]>;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const trackerRow = snap.tracker.get(lead.target_number);

  const provenance: ProvenanceItem[] = (lead.research_sources ?? []).map(s => {
    const shaped = isUrl(s.source_url);
    return {
      field: s.field_covered,
      sourceUrl: s.source_url,
      sourceType: s.source_type,
      recordedBy: s.recorded_by ?? null,
      recordedOn: s.source_date,
      confidence: s.confidence,
      evidenceLevel: shaped ? 'URL_SHAPED' : s.source_url ? 'CLAIMED' : 'CLAIMED',
      note: shaped
        ? 'A valid URL is recorded. Nobody has fetched it, so it has not been shown to exist or to support the claim.'
        : 'A source was described but no URL was recorded.',
    };
  });

  const drift: string[] = [];
  for (const [gate, outcome] of gateEntries) {
    const stored = (lead.qualification_gates as unknown as Record<string, string> | null)?.[gate];
    if (stored !== outcome) drift.push(`${GATE_LABELS[gate] ?? gate}: stored ${stored ?? 'none'}, engine says ${outcome}`);
  }
  // OUTREACH_READY is QUALIFIED plus readiness, which the opportunity step derives — not a disagreement.
  const storedState = lead.research_state === 'OUTREACH_READY' ? 'QUALIFIED' : lead.research_state;
  if (storedState !== q.state) drift.push(`Research state: stored ${lead.research_state}, engine says ${q.state}`);
  if (lead.research_completeness_score !== q.completenessScore) drift.push(`Research completeness: stored ${lead.research_completeness_score}%, engine says ${q.completenessScore}%`);

  return {
    lead,
    version: snap.versions.get(lead.lead_id) ?? null,
    drift,
    row: toRow(lead, snap),
    contacts: contactsFor(lead, actor),
    qualificationGates: q.gates,
    gates: gateEntries.map(([gate, outcome]) => ({
      gate,
      label: GATE_LABELS[gate] ?? gate,
      outcome,
      blocking: !NON_BLOCKING_GATES.has(gate),
      meaning: OUTCOME_MEANING[outcome] ?? outcome,
    })),
    missingIntelligence: q.missing,
    reasons: q.reasons ?? [],
    scores: calculateLeadScores(lead),
    provenance,
    duplicates: findDuplicates(snap.leads)
      .filter(d => d.target_number === lead.target_number || d.duplicate_of === lead.target_number)
      .map(d => ({ targetNumber: d.target_number, duplicateOf: d.duplicate_of, reason: d.reason })),
    suppression: checkSuppression(lead, snap.suppression),
    callEligibility: callEligibility(lead, snap.suppression, ledger, today),
    researchTasks: q.missing
      .map(f => taskFor(f, lead))
      .filter((t): t is NonNullable<typeof t> => t !== null)
      // core quotes the record in its instructions; an actor who may not see a contact value must not read it here.
      .map(t => {
        const scrub = (text: string) => (actor.permissions.has('lead.view_contacts') ? text : scrubContactValues(text, lead));
        return { field: t.field, task: scrub(t.task), evidenceNeeded: scrub(t.evidence_needed), recordWith: scrub(t.record_with) };
      }),
    emailLedger: {
      status: ledger,
      batch: trackerRow?.batch ?? null,
      sentDate: trackerRow?.sent_date ?? null,
      followUpDue: trackerRow?.follow_up_due ?? null,
    },
    archetypeName: archetypeById(lead.archetype_id)?.name ?? lead.archetype_label,
    opportunity: {
      scope: lead.recommended_scope,
      value: lead.estimated_project_value,
      channel: lead.recommended_channel,
      secondary: lead.secondary_channel,
      reason: lead.channel_reason,
    },
  };
}
