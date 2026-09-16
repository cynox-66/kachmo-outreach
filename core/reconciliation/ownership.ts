/**
 * SINGLE-WRITER MODEL — who may write what, and when.
 *
 * The system has three stores that all hold lead state:
 *   GIT_JSON   database/kachmo_leads.json, database/suppression.json, analytics/events.jsonl (committed)
 *   POSTGRES   the hosted Outbound OS database
 *   TITAN      OUTREACH_TRACKER.md + scheduled-queue.json, written by the GitHub Actions email cron
 *
 * The rule that makes this safe: EVERY FIELD HAS EXACTLY ONE WRITER IN EVERY PHASE. There is no bidirectional
 * sync anywhere in this design. Where a value must reach another store, it is PUBLISHED one way, with an explicit
 * audited step and a freshness guard — never merged.
 *
 * Nothing in this module changes Methodology v1.0. It governs where state lives, not how a lead is evaluated.
 */

/** Where lead state can live. */
export type Store = 'GIT_JSON' | 'POSTGRES' | 'TITAN';

/**
 * The cutover phases, in order. The phase is an explicit, recorded decision — never inferred from whether a
 * database happens to be reachable.
 */
export const CUTOVER_PHASES = ['PRE_CUTOVER', 'CUTOVER_WINDOW', 'POST_CUTOVER'] as const;
export type CutoverPhase = (typeof CUTOVER_PHASES)[number];

export interface PhaseDefinition {
  phase: CutoverPhase;
  /** The store that is authoritative for lead records in this phase. */
  canonicalLeadStore: Store;
  /** The store that is authoritative for the suppression list in this phase. */
  canonicalSuppressionStore: Store;
  /** Stores that may accept writes in this phase. Everything else is read-only. */
  writableStores: readonly Store[];
  summary: string;
}

/**
 * PRE_CUTOVER is where the system is today. POST_CUTOVER is the target. CUTOVER_WINDOW exists so the transition
 * is a state the system can be IN — with both stores loaded and compared — rather than an instant during which
 * nobody knows which store is right.
 *
 * TITAN is writable in every phase: it is a separate production subsystem that owns email send state, and the
 * Outbound OS reads its ledger rather than replacing it.
 */
export const PHASES: Record<CutoverPhase, PhaseDefinition> = {
  PRE_CUTOVER: {
    phase: 'PRE_CUTOVER',
    canonicalLeadStore: 'GIT_JSON',
    canonicalSuppressionStore: 'GIT_JSON',
    writableStores: ['GIT_JSON', 'TITAN'],
    summary:
      'The committed JSON store is the source of truth. Postgres holds no production data. The hosted app is read-only and must say so.',
  },
  CUTOVER_WINDOW: {
    phase: 'CUTOVER_WINDOW',
    canonicalLeadStore: 'GIT_JSON',
    canonicalSuppressionStore: 'GIT_JSON',
    writableStores: ['TITAN'],
    summary:
      'Both stores are loaded and reconciled. NEITHER accepts lead writes: the CLI is frozen and the app is read-only, so drift cannot appear mid-comparison. Only the Titan email subsystem keeps running. Rollback is free — nothing has changed.',
  },
  POST_CUTOVER: {
    phase: 'POST_CUTOVER',
    canonicalLeadStore: 'POSTGRES',
    canonicalSuppressionStore: 'POSTGRES',
    writableStores: ['POSTGRES', 'TITAN'],
    summary:
      'Postgres is the source of truth for leads and suppression. The JSON store is frozen evidence, never written again. Suppression reaches Titan by an audited one-way publish with a freshness guard.',
  },
};

/** Field groups, so ownership is stated once per group rather than per column. */
export type FieldGroup =
  | 'IDENTITY'
  | 'LEGACY_IMPORT'
  | 'RESEARCH'
  | 'CONTACT_PROVENANCE'
  | 'DERIVED'
  | 'CALL'
  | 'WHATSAPP'
  | 'SALES'
  | 'SUPPRESSION'
  | 'EMAIL_LEDGER'
  | 'OTHER_CHANNELS'
  | 'DEDUPE'
  | 'NEVER_ESTIMATED'
  | 'RECORD_METADATA';

export interface FieldOwnership {
  group: FieldGroup;
  /** Lead fields in this group. */
  fields: readonly string[];
  /** The single writer, per phase. */
  writer: Record<CutoverPhase, Store>;
  /**
   * IMMUTABLE fields are never rewritten after a lead is created — not by a migration, not by a re-import, not by
   * the app. A change to one is a defect, not an update.
   */
  immutable: boolean;
  why: string;
}

const jsonThenPostgres: Record<CutoverPhase, Store> = { PRE_CUTOVER: 'GIT_JSON', CUTOVER_WINDOW: 'GIT_JSON', POST_CUTOVER: 'POSTGRES' };
const alwaysTitan: Record<CutoverPhase, Store> = { PRE_CUTOVER: 'TITAN', CUTOVER_WINDOW: 'TITAN', POST_CUTOVER: 'TITAN' };

export const FIELD_OWNERSHIP: readonly FieldOwnership[] = [
  {
    group: 'IDENTITY',
    fields: ['lead_id', 'target_number', 'created_at', 'migrated_from_csv'],
    writer: jsonThenPostgres,
    immutable: true,
    why: 'Identity is what makes the two stores comparable at all. A lead_id that changes makes every reconciliation meaningless.',
  },
  {
    group: 'LEGACY_IMPORT',
    fields: ['company_name', 'website_url', 'archetype_id', 'archetype_label', 'raw_archetype_id', 'raw_contact_route', 'location_city', 'location_country', 'estimated_scale', 'industry', 'kachmo_solution_angle', 'personalized_outreach_hook'],
    writer: jsonThenPostgres,
    immutable: false,
    why: 'Derived from kachmo_targets.csv. Re-importable before cutover; afterwards the CSV is evidence, not an input.',
  },
  {
    group: 'RESEARCH',
    fields: ['decision_maker_name', 'decision_maker_title', 'decision_maker_source', 'decision_maker_confidence', 'commercial_validation_signal', 'commercial_signal_source', 'commercial_signal_confidence', 'observable_friction', 'website_friction_source', 'website_friction_confidence', 'budget_probability', 'budget_probability_reason', 'budget_probability_source', 'trigger_event', 'trigger_date', 'trigger_source', 'trigger_confidence', 'why_now', 'current_framework', 'technology_source', 'technology_confidence', 'frontend_team_status', 'frontend_team_evidence', 'kachmo_fit_confirmed_by', 'kachmo_fit_rejected_reason', 'timezone', 'timezone_basis', 'research_sources', 'research_last_verified_at', 'current_website_status', 'cms', 'hosting', 'performance_signal', 'mobile_experience', 'technical_quality', 'ux_quality', 'visual_quality', 'pain_type', 'pain_score', 'intent_score', 'overall_research_confidence'],
    writer: jsonThenPostgres,
    immutable: false,
    why: 'Recorded by humans through leads:record (before) or the hosted app (after). Each entry appends provenance; research_sources is append-only in practice.',
  },
  {
    group: 'CONTACT_PROVENANCE',
    fields: ['decision_maker_email', 'decision_maker_phone', 'email_status', 'email_source', 'email_verification_basis', 'email_verified_at', 'phone_status', 'phone_source', 'phone_verification_basis', 'phone_verified_at', 'decision_maker_whatsapp', 'decision_maker_linkedin', 'decision_maker_instagram', 'contact_confidence'],
    writer: jsonThenPostgres,
    immutable: false,
    why: 'The most safety-sensitive group: it decides who may be called. Only one writer may ever touch it, and a downgrade must propagate immediately.',
  },
  {
    group: 'DERIVED',
    fields: ['qualification_gates', 'missing_intelligence', 'disqualification_reasons', 'research_state', 'research_completeness_score', 'kachmo_score', 'commercial_fit_score', 'budget_score', 'pain_score_normalized', 'decision_maker_quality_score', 'intent_trigger_score', 'score_signals', 'score_basis', 'lead_priority', 'priority_confidence', 'recommended_channel', 'secondary_channel', 'channel_reason', 'opportunity_description', 'recommended_scope', 'estimated_project_value', 'estimated_project_value_basis', 'owner', 'next_action', 'next_action_date', 'estimated_deal_value', 'expected_value_confidence', 'referral_potential', 'network_value'],
    writer: jsonThenPostgres,
    immutable: false,
    why: 'Computed by core/ from the fields above. Never hand-edited in either store: a difference here means the inputs differ, or the engine version differs.',
  },
  {
    group: 'CALL',
    fields: ['call_attempts', 'call_status', 'call_outcome', 'objection', 'lead_temperature'],
    writer: jsonThenPostgres,
    immutable: false,
    why: 'call_attempts is an append-only history. A shorter array in either store is data loss, not an update.',
  },
  {
    group: 'WHATSAPP',
    fields: ['whatsapp_outreach_status', 'whatsapp_basis', 'whatsapp_basis_source', 'whatsapp_eligible', 'whatsapp_number', 'whatsapp_number_source', 'whatsapp_eligibility_reason', 'whatsapp_confidence'],
    writer: jsonThenPostgres,
    immutable: false,
    why: 'Human review and human send. Never written by any automated process in either store.',
  },
  {
    group: 'SALES',
    fields: ['response_status', 'meeting_status', 'proposal_status', 'deal_stage', 'deal_value', 'lost_reason', 'notes', 'last_contacted_at'],
    writer: jsonThenPostgres,
    immutable: false,
    why: 'Sales stage transitions are ordered and terminal; two writers could reopen a closed deal.',
  },
  {
    group: 'SUPPRESSION',
    fields: ['do_not_contact', 'suppression_reason'],
    writer: jsonThenPostgres,
    immutable: false,
    why:
      'The one group where a stale reader is actively harmful: a suppression that has not reached Titan means a real person is emailed after opting out. Governed by the publish contract, never by sync.',
  },
  {
    group: 'OTHER_CHANNELS',
    fields: ['linkedin_status', 'instagram_status'],
    writer: jsonThenPostgres,
    immutable: false,
    why: 'LinkedIn and Instagram are manual channels with no automation behind them; the record simply notes where a human got to.',
  },
  {
    group: 'DEDUPE',
    fields: ['possible_duplicate_of', 'duplicate_reason'],
    writer: jsonThenPostgres,
    immutable: false,
    why: 'Duplicate flags are advisory: they mark a lead for human review and never merge or delete anything by themselves.',
  },
  {
    group: 'NEVER_ESTIMATED',
    fields: ['conversion_probability', 'expected_revenue'],
    writer: jsonThenPostgres,
    immutable: true,
    why:
      'These are frozen at the literal UNKNOWN. Methodology v1.0 produces no conversion probability and no expected revenue, and marking them immutable means no store can quietly start estimating them.',
  },
  {
    group: 'RECORD_METADATA',
    fields: ['updated_at'],
    writer: jsonThenPostgres,
    immutable: false,
    why: 'Stamped by whichever store owns the record in the current phase. Never compared for drift on its own — it changes on every write.',
  },
  {
    group: 'EMAIL_LEDGER',
    fields: ['lead_state', 'email_outreach_status', 'email_follow_up_sent_at', 'batch_history'],
    writer: alwaysTitan,
    immutable: false,
    why:
      'Titan owns email send state in every phase. Postgres mirrors it as a READ-ONLY projection of OUTREACH_TRACKER.md; the Outbound OS never writes it and never sends email.',
  },
] as const;

/** Every lead field the ownership table governs. */
export const OWNED_FIELDS: readonly string[] = FIELD_OWNERSHIP.flatMap(g => g.fields);

export const IMMUTABLE_FIELDS: readonly string[] = FIELD_OWNERSHIP.filter(g => g.immutable).flatMap(g => g.fields);

export function ownerOf(field: string, phase: CutoverPhase): Store | null {
  return FIELD_OWNERSHIP.find(g => g.fields.includes(field))?.writer[phase] ?? null;
}

export const isImmutableField = (field: string): boolean => IMMUTABLE_FIELDS.includes(field);

/**
 * Whether a store may write a field in a phase. Deny-by-default: an unknown field has no owner and therefore no
 * writer, so a field added without being classified cannot be written by anyone until it is.
 */
export function mayWrite(store: Store, field: string, phase: CutoverPhase): { allowed: boolean; reason: string } {
  const group = FIELD_OWNERSHIP.find(g => g.fields.includes(field));
  if (!group) return { allowed: false, reason: `"${field}" has no declared owner; classify it in FIELD_OWNERSHIP before writing it` };
  if (group.immutable) return { allowed: false, reason: `"${field}" is immutable (${group.group}): it is set once at creation and never rewritten` };
  const owner = group.writer[phase];
  if (owner !== store) return { allowed: false, reason: `in ${phase} the writer for ${group.group} is ${owner}, not ${store}` };
  if (!PHASES[phase].writableStores.includes(store)) return { allowed: false, reason: `${store} accepts no writes in ${phase}` };
  return { allowed: true, reason: `${store} owns ${group.group} in ${phase}` };
}
