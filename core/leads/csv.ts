import type { KachmoLead } from './schema.js';
import type { TrackerRow } from '../email-ledger/tracker.js';
import { EMAIL_SENT_STATUSES } from '../email-ledger/tracker.js';
import { isUrl } from '../contact/provenance.js';
import { resolveTimezone } from '../geo/timezone.js';

/** The legacy 15-column interchange shape. Both the importer and the exporter are defined against it. */
export const CSV_COLUMNS = [
  'target_number',
  'archetype_id',
  'archetype_label',
  'company_name',
  'website_url',
  'location_city',
  'location_country',
  'estimated_scale',
  'decision_maker_name',
  'decision_maker_title',
  'contact_route',
  'commercial_validation_signal',
  'observable_friction',
  'kachmo_solution_angle',
  'personalized_outreach_hook',
] as const;

/** RFC-4180 parser (quoted commas, escaped quotes, quoted newlines). Blank lines are ignored. */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

export function escapeCsvField(val: string | null | undefined): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The exported projection of one lead, in CSV_COLUMNS order. Contact data collapses back into `contact_route`. */
export function csvExportCells(l: KachmoLead): string[] {
  return [
    l.target_number,
    l.raw_archetype_id || l.archetype_id,
    l.archetype_label,
    l.company_name,
    l.website_url,
    l.location_city,
    l.location_country,
    l.estimated_scale,
    l.decision_maker_name,
    l.decision_maker_title,
    l.raw_contact_route || l.decision_maker_email || l.decision_maker_phone || '',
    l.commercial_validation_signal,
    l.observable_friction,
    l.kachmo_solution_angle,
    l.personalized_outreach_hook,
  ].map(v => escapeCsvField(v as string | null | undefined));
}

export function renderLeadsCsv(leads: KachmoLead[]): string {
  return [CSV_COLUMNS.join(','), ...leads.map(l => csvExportCells(l).join(','))].join('\n') + '\n';
}

/** Operational / human-entered fields that a re-migration must never overwrite. */
export const PRESERVE_IF_SET: (keyof KachmoLead)[] = [
  'decision_maker_linkedin',
  'decision_maker_instagram',
  'whatsapp_basis',
  'whatsapp_basis_source',
  'whatsapp_outreach_status',
  'call_attempts',
  'response_status',
  'lead_temperature',
  'objection',
  'meeting_status',
  'proposal_status',
  'deal_stage',
  'deal_value',
  'lost_reason',
  'notes',
  'next_action_date',
  'do_not_contact',
  'suppression_reason',
  'email_follow_up_sent_at',
  'kachmo_fit_confirmed_by',
  'kachmo_fit_rejected_reason',
  'research_last_verified_at',
  'possible_duplicate_of',
  'duplicate_reason',
  'budget_probability',
  'budget_probability_reason',
  'budget_probability_source',
  'trigger_event',
  'trigger_date',
  'trigger_source',
  'trigger_confidence',
  'why_now',
  'current_framework',
  'cms',
  'hosting',
  'technology_source',
  'technology_confidence',
  'frontend_team_status',
  'frontend_team_evidence',
  'linkedin_status',
  'instagram_status',
];

const isSet = (v: unknown) =>
  v !== null && v !== undefined && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0) && v !== 'UNKNOWN' && v !== 'NOT_RESEARCHED';

/**
 * Merges a freshly derived record with what humans have since established about the lead.
 *
 * Re-running the CSV import must be safe: identity (lead_id, created_at), sourced contact provenance, named human
 * judgements, call history and sales state always win over anything re-derived from the spreadsheet. Only
 * unsourced legacy fields are refreshed.
 */
export function preserveHumanData(fresh: KachmoLead, old: KachmoLead): KachmoLead {
  const out = { ...fresh, lead_id: old.lead_id, created_at: old.created_at } as Record<string, unknown>;
  for (const k of PRESERVE_IF_SET) if (isSet(old[k])) out[k] = old[k];
  if ((old.call_attempts?.length ?? 0) > 0) {
    out.call_status = old.call_status;
    out.call_outcome = old.call_outcome;
    out.next_action = old.next_action;
  }
  for (const kind of ['phone', 'email'] as const) {
    const status = old[`${kind}_status`];
    if (status === 'PUBLICLY_LISTED' || status === 'VERIFIED' || status === 'INVALID') {
      for (const f of [`decision_maker_${kind}`, `${kind}_status`, `${kind}_source`, `${kind}_verification_basis`, `${kind}_verified_at`]) {
        out[f] = (old as unknown as Record<string, unknown>)[f];
      }
    }
  }
  if (isUrl(old.decision_maker_source)) {
    for (const f of ['decision_maker_name', 'decision_maker_title', 'decision_maker_source', 'decision_maker_confidence']) {
      out[f] = (old as unknown as Record<string, unknown>)[f];
    }
  }
  if (isUrl(old.commercial_signal_source)) {
    for (const f of ['commercial_validation_signal', 'commercial_signal_source', 'commercial_signal_confidence']) {
      out[f] = (old as unknown as Record<string, unknown>)[f];
    }
  }
  if (isUrl(old.website_friction_source)) {
    for (const f of ['observable_friction', 'website_friction_source', 'website_friction_confidence']) {
      out[f] = (old as unknown as Record<string, unknown>)[f];
    }
  }
  if (old.timezone_basis?.startsWith('recorded')) {
    out.timezone = old.timezone;
    out.timezone_basis = old.timezone_basis;
  }
  if (old.do_not_contact) {
    out.research_state = 'DISQUALIFIED';
    out.lead_priority = 'DISQUALIFIED';
  }
  out.research_sources = (old.research_sources ?? []).filter(s => s.recorded_by);
  out.last_contacted_at = old.last_contacted_at && (old.call_attempts?.length || old.whatsapp_outreach_status) ? old.last_contacted_at : fresh.last_contacted_at;
  return out as unknown as KachmoLead;
}

/**
 * Builds a lead from one CSV row plus whatever the production email ledger already knows about that target.
 *
 * Nothing here is inferred beyond what the row states: contact provenance starts at UNVERIFIED (a value exists but
 * nobody recorded where it came from), never at PUBLICLY_LISTED, and the timezone is resolved only when it can be
 * derived without guessing.
 */
export function leadFromCsvRow(c: Record<string, string>, row: TrackerRow | undefined, leadId: string, now: string): KachmoLead {
  const route = c.contact_route;
  const csvEmail = route.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0] ?? null;
  const csvPhone = route.match(/\+?\d[\d\s()-]{8,}\d/)?.[0]?.trim() ?? null;
  const email = csvEmail ?? row?.email ?? null;
  const phone = row?.phone ?? csvPhone;
  const isEmailLedger = !!row && (row.email !== null || ['DRAFTED', 'SCHEDULED', 'DISQUALIFIED'].includes(row.status) || EMAIL_SENT_STATUSES.has(row.status));
  const archetype_id = c.archetype_id.match(/^(\d+)/)?.[1] ?? c.archetype_id;
  const tz = resolveTimezone(c.location_city, c.location_country);

  return {
    lead_id: leadId,
    target_number: c.target_number,
    company_name: c.company_name,
    website_url: c.website_url,
    industry: c.archetype_label,
    archetype_id,
    archetype_label: c.archetype_label,
    raw_archetype_id: c.archetype_id,
    raw_contact_route: route,
    location_city: c.location_city,
    location_country: c.location_country,
    timezone: tz.timezone,
    timezone_basis: tz.basis,
    estimated_scale: c.estimated_scale,

    decision_maker_name: c.decision_maker_name,
    decision_maker_title: c.decision_maker_title,
    decision_maker_email: email,
    decision_maker_phone: phone,
    decision_maker_whatsapp: null,
    decision_maker_linkedin: null,
    decision_maker_instagram: null,
    decision_maker_source: 'kachmo_targets.csv (legacy research, no source recorded)',
    decision_maker_confidence: 'LOW',

    email_status: email ? 'UNVERIFIED' : 'UNKNOWN',
    email_source: csvEmail
      ? 'kachmo_targets.csv contact_route (no source URL recorded)'
      : email
        ? `OUTREACH_TRACKER.md ${row?.batch} (no source URL recorded)`
        : null,
    email_verification_basis: null,
    email_verified_at: null,
    phone_status: phone ? 'UNVERIFIED' : 'UNKNOWN',
    phone_source: row?.phone
      ? `OUTREACH_TRACKER.md ${row.batch} (no source URL recorded)`
      : csvPhone
        ? 'kachmo_targets.csv contact_route (no source URL recorded)'
        : null,
    phone_verification_basis: null,
    phone_verified_at: null,
    whatsapp_basis: null,
    whatsapp_basis_source: null,
    whatsapp_eligible: 'UNCLEAR',
    whatsapp_number: null,
    whatsapp_number_source: null,
    whatsapp_eligibility_reason: null,
    whatsapp_confidence: 'UNKNOWN',
    contact_confidence: 'LOW',

    commercial_validation_signal: c.commercial_validation_signal,
    commercial_signal_source: 'kachmo_targets.csv (legacy research, no source URL)',
    commercial_signal_confidence: 'LOW',
    budget_probability: 'UNKNOWN',
    budget_probability_reason: null,
    budget_probability_source: null,
    estimated_deal_value: null,
    expected_value_confidence: 'UNKNOWN',
    referral_potential: null,
    network_value: null,

    current_website_status: null,
    current_framework: null,
    cms: null,
    hosting: null,
    performance_signal: null,
    mobile_experience: null,
    technical_quality: null,
    ux_quality: null,
    visual_quality: null,
    technology_source: null,
    technology_confidence: 'NOT_RESEARCHED',

    frontend_team_status: 'NOT_RESEARCHED',
    frontend_team_evidence: null,

    observable_friction: c.observable_friction,
    pain_type: null,
    pain_score: null,
    website_friction_source: 'kachmo_targets.csv (legacy research, no source URL)',
    website_friction_confidence: 'LOW',

    intent_score: null,
    trigger_event: null,
    trigger_date: null,
    trigger_source: null,
    trigger_confidence: 'NOT_RESEARCHED',
    why_now: null,

    kachmo_solution_angle: c.kachmo_solution_angle,
    personalized_outreach_hook: c.personalized_outreach_hook,
    opportunity_description: null,
    recommended_scope: null,
    estimated_project_value: null,
    estimated_project_value_basis: null,
    recommended_channel: null,
    secondary_channel: null,
    channel_reason: null,
    kachmo_fit_confirmed_by: null,
    kachmo_fit_rejected_reason: null,

    commercial_fit_score: null,
    budget_score: null,
    pain_score_normalized: null,
    decision_maker_quality_score: null,
    intent_trigger_score: null,
    kachmo_score: null,
    research_completeness_score: 0,
    lead_priority: null,
    priority_confidence: null,

    research_state: 'QUALIFICATION_PENDING',
    missing_intelligence: [],
    disqualification_reasons: [],
    research_last_verified_at: null,
    qualification_gates: null,

    lead_state: isEmailLedger ? row!.status : 'DISCOVERED',
    email_outreach_status: isEmailLedger ? row!.status : null,
    whatsapp_outreach_status: null,
    call_status: null,
    call_attempts: [],
    linkedin_status: null,
    instagram_status: null,
    last_contacted_at: isEmailLedger && EMAIL_SENT_STATUSES.has(row!.status) ? row!.sent_date : null,
    next_action: null,
    next_action_date: null,
    owner: archetype_id === '6' ? 'AADI' : 'DEV',

    do_not_contact: false,
    suppression_reason: null,

    response_status: null,
    lead_temperature: null,
    call_outcome: null,
    objection: null,
    meeting_status: null,
    proposal_status: null,
    deal_stage: null,
    deal_value: null,
    lost_reason: null,
    notes: null,

    possible_duplicate_of: null,
    duplicate_reason: null,

    research_sources: [],
    overall_research_confidence: 'LOW',

    conversion_probability: 'UNKNOWN',
    expected_revenue: 'UNKNOWN',

    created_at: now,
    updated_at: now,
    migrated_from_csv: true,
    batch_history: row?.batch ? [row.batch] : [],
  };
}

export interface CsvMigrationPlan {
  /** Non-empty means nothing may be written: the whole import is refused. */
  errors: string[];
  leads: KachmoLead[];
  created: number;
  /** Leads created by this run, for LEAD_DISCOVERED events. */
  newTargetNumbers: string[];
}

/**
 * Plans a full CSV import without writing anything.
 *
 * Fail-closed and all-or-nothing: a bad header, a malformed row, a duplicate target number or a company name that
 * disagrees with the stored lead aborts the entire import. Leads present in the database but absent from the CSV
 * are kept untouched — the CSV can add leads, never remove them.
 */
export function planCsvMigration(
  csvContent: string,
  existing: KachmoLead[],
  tracker: Map<string, TrackerRow>,
  ctx: { now: string; newLeadId: () => string }
): CsvMigrationPlan {
  const rows = parseCsv(csvContent);
  const header = rows[0]?.map(h => h.trim());
  if (!header || CSV_COLUMNS.some((c, i) => header[i] !== c)) {
    return { errors: [`Unexpected CSV header. Expected: ${CSV_COLUMNS.join(',')}`], leads: [], created: 0, newTargetNumbers: [] };
  }

  const existingByTn = new Map(existing.map(l => [l.target_number, l]));
  const errors: string[] = [];
  const seen = new Set<string>();
  const leads: KachmoLead[] = [];
  const newTargetNumbers: string[] = [];

  rows.slice(1).forEach((cells, idx) => {
    const rowNo = idx + 2;
    if (cells.length !== CSV_COLUMNS.length) {
      errors.push(`row ${rowNo}: expected ${CSV_COLUMNS.length} columns, got ${cells.length}`);
      return;
    }
    const c = Object.fromEntries(CSV_COLUMNS.map((k, i) => [k, cells[i].trim()])) as Record<string, string>;
    if (!/^\d{3}$/.test(c.target_number)) errors.push(`row ${rowNo}: invalid target_number "${c.target_number}"`);
    if (!c.company_name) errors.push(`row ${rowNo}: empty company_name`);
    if (seen.has(c.target_number)) errors.push(`row ${rowNo}: duplicate target_number ${c.target_number}`);
    seen.add(c.target_number);

    const fresh = leadFromCsvRow(c, tracker.get(c.target_number), ctx.newLeadId(), ctx.now);
    const old = existingByTn.get(c.target_number);
    if (old) {
      if (old.company_name !== c.company_name) {
        errors.push(`row ${rowNo}: target ${c.target_number} is "${old.company_name}" in the database but "${c.company_name}" in the CSV`);
      }
      leads.push(preserveHumanData(fresh, old));
    } else {
      leads.push(fresh);
      newTargetNumbers.push(fresh.target_number);
    }
  });

  if (errors.length) return { errors, leads: [], created: 0, newTargetNumbers: [] };

  // Leads that exist only in the database (never in the CSV) are kept, untouched.
  for (const old of existing) if (!seen.has(old.target_number)) leads.push(old);

  return { errors: [], leads, created: newTargetNumbers.length, newTargetNumbers };
}
