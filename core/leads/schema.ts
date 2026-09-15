export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

/**
 * Contact provenance. Only PUBLICLY_LISTED (with a source URL) and VERIFIED (with a
 * verification basis) may be used for calls or WhatsApp.
 *
 * UNKNOWN          nothing on file
 * INFERRED         derived by software or pattern-guessing (e.g. first@domain) — never usable
 * UNVERIFIED       a value is on file from legacy research but nobody recorded where it came from
 * PUBLICLY_LISTED  published by the business/person; phone_source/email_source holds the URL
 * VERIFIED         a human confirmed it (e.g. the person answered and confirmed identity)
 * INVALID          bounced / wrong number
 */
export type ContactProvenance = 'UNKNOWN' | 'INFERRED' | 'UNVERIFIED' | 'PUBLICLY_LISTED' | 'VERIFIED' | 'INVALID';

/**
 * PASS        satisfied with a recorded source (or structurally checkable, e.g. timezone)
 * UNVERIFIED  claim on file but no source recorded — does not block, but must not be stated as fact
 * PENDING     required information missing — research required
 * UNKNOWN     optional information not researched (budget, trigger) — never blocks
 * FAIL        evidence that disqualifies
 */
export type GateOutcome = 'PASS' | 'UNVERIFIED' | 'PENDING' | 'UNKNOWN' | 'FAIL';
export type LeadPriority = 'A+' | 'A' | 'B' | 'C' | 'DISQUALIFIED';
export type ResearchState =
  | 'DISCOVERED'
  | 'QUALIFICATION_PENDING'
  | 'RESEARCH_REQUIRED'
  | 'ENRICHED'
  | 'QUALIFIED'
  | 'DISQUALIFIED'
  | 'OUTREACH_READY';

export type ChannelType = 'EMAIL' | 'WHATSAPP' | 'CALL' | 'LINKEDIN' | 'INSTAGRAM' | 'MULTI_CHANNEL';
export type ResearchQueueStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED' | 'NOT_REQUIRED';
export type Actor = 'DEV' | 'AADI' | 'SYSTEM';

export const CALL_OUTCOMES = [
  'NO_ANSWER',
  'VOICEMAIL',
  'WRONG_NUMBER',
  'GATEKEEPER',
  'CALLBACK',
  'INTERESTED',
  'NOT_NOW',
  'NOT_INTERESTED',
  'MEETING_BOOKED',
  'DO_NOT_CONTACT',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const OBJECTION_CATEGORIES = [
  'HAS_AGENCY_OR_TEAM',
  'BUDGET',
  'TIMING',
  'NO_NEED',
  'TRUST_OR_LOCATION',
  'SEND_INFO',
  'OTHER',
] as const;
export type ObjectionCategory = (typeof OBJECTION_CATEGORIES)[number];

export const LOST_REASONS = ['BUDGET', 'TIMING', 'WENT_WITH_OTHER', 'NO_NEED', 'NO_RESPONSE', 'NOT_A_FIT', 'OTHER'] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export interface CallAttempt {
  at: string;
  by: Actor;
  outcome: CallOutcome;
  notes: string | null;
  objection: string | null;
  objection_category: ObjectionCategory | null;
}

export interface ResearchSource {
  source_url: string | null;
  source_type: string; // "official_website", "linkedin", "google_business_profile", "press", ...
  source_date: string | null;
  field_covered: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  recorded_by?: Actor;
}

export interface QualificationGates {
  gate_1_decision_maker: GateOutcome;
  gate_2_contactability: GateOutcome;
  gate_3_commercial_proof: GateOutcome;
  gate_4_digital_friction: GateOutcome;
  gate_5_location_timezone: GateOutcome;
  gate_6_budget_probability: GateOutcome;
  gate_7_buying_intent: GateOutcome;
  gate_8_kachmo_fit: GateOutcome;
}

export interface KachmoLead {
  // ── Identity ──
  lead_id: string; // UUID, stable across re-migration
  target_number: string; // Legacy 3-digit number e.g. "001"
  company_name: string;
  website_url: string;
  industry: string;
  archetype_id: string; // "1" … "6"
  archetype_label: string;
  raw_archetype_id?: string;
  raw_contact_route?: string;
  location_city: string;
  location_country: string;
  timezone: string | null; // IANA timezone, null when it cannot be resolved without guessing
  timezone_basis?: string;
  estimated_scale: string;

  // ── Decision Maker ──
  decision_maker_name: string;
  decision_maker_title: string;
  decision_maker_email: string | null;
  decision_maker_phone: string | null;
  decision_maker_whatsapp: string | null;
  decision_maker_linkedin: string | null;
  decision_maker_instagram: string | null;
  decision_maker_source: string;
  decision_maker_confidence: ConfidenceLevel;

  // ── Contact Provenance ──
  email_status: ContactProvenance;
  email_source: string | null;
  email_verification_basis?: string | null;
  email_verified_at?: string | null;
  phone_status: ContactProvenance;
  phone_source: string | null;
  phone_verification_basis?: string | null;
  phone_verified_at?: string | null;
  /** Why WhatsApp is appropriate at all. Without a basis the lead never enters the WhatsApp queue. */
  whatsapp_basis?: 'BUSINESS_LISTED_WHATSAPP' | 'PERMISSION_GIVEN_ON_CALL' | null;
  whatsapp_basis_source?: string | null;
  whatsapp_eligible: 'YES' | 'NO' | 'UNCLEAR';
  whatsapp_number: string | null;
  whatsapp_number_source: string | null;
  whatsapp_eligibility_reason: string | null;
  whatsapp_confidence: ConfidenceLevel;
  contact_confidence: ConfidenceLevel;

  // ── Commercial Qualification ──
  commercial_validation_signal: string;
  commercial_signal_source: string | null;
  commercial_signal_confidence: ConfidenceLevel;
  budget_probability: 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  budget_probability_reason: string | null;
  budget_probability_source: string | null;
  estimated_deal_value: string | null;
  expected_value_confidence: ConfidenceLevel;
  referral_potential: number | null;
  network_value: string | null;

  // ── Website / Technical Research ──
  current_website_status: string | null;
  current_framework: string | null;
  cms: string | null;
  hosting: string | null;
  performance_signal: string | null;
  mobile_experience: string | null;
  technical_quality: string | null;
  ux_quality: string | null;
  visual_quality: string | null;
  technology_source: string | null;
  technology_confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' | 'NOT_RESEARCHED';

  // ── Agency-Specific Intelligence (Arch-1) ──
  frontend_team_status: 'NO_FRONTEND_TEAM' | 'SMALL_INTERNAL_TEAM' | 'LARGE_INTERNAL_TEAM' | 'UNCLEAR' | 'NOT_RESEARCHED';
  frontend_team_evidence: string | null;

  // ── Pain ──
  observable_friction: string;
  pain_type: string | null;
  pain_score: number | null;
  website_friction_source: string | null;
  website_friction_confidence: ConfidenceLevel;

  // ── Intent / Trigger (urgency — never part of kachmo_score) ──
  intent_score: number | null;
  trigger_event: string | null; // free text, 'NO_CLEAR_TRIGGER' once researched and none found, null if not researched
  trigger_date: string | null;
  trigger_source: string | null;
  trigger_confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' | 'NOT_RESEARCHED';
  why_now: string | null;

  // ── Kachmo Opportunity ──
  kachmo_solution_angle: string;
  personalized_outreach_hook: string;
  opportunity_description: string | null;
  recommended_scope: string | null;
  estimated_project_value: string | null;
  estimated_project_value_basis?: string | null;
  recommended_channel: ChannelType | null;
  secondary_channel: ChannelType | null;
  channel_reason: string | null;
  kachmo_fit_confirmed_by?: Actor | null;
  kachmo_fit_rejected_reason?: string | null;

  // ── Scoring & Transparency ──
  commercial_fit_score: number | null;
  budget_score: number | null;
  pain_score_normalized: number | null;
  decision_maker_quality_score: number | null;
  intent_trigger_score: number | null; // urgency 0–100, separate from kachmo_score
  kachmo_score: number | null; // 0–100 heuristic commercial attractiveness over KNOWN dimensions only
  score_basis?: string;
  score_signals?: string[];
  research_completeness_score: number; // 0–100 share of required intelligence that is on file AND sourced
  lead_priority: LeadPriority | null;
  priority_confidence?: 'CONFIRMED' | 'PROVISIONAL' | null;

  // ── Lead Quality State ──
  research_state: ResearchState;
  missing_intelligence: string[];
  disqualification_reasons?: string[];
  research_last_verified_at?: string | null;

  // ── 8-Gate Qualification ──
  qualification_gates: QualificationGates | null;

  // ── Outreach State ──
  lead_state: string; // email-ledger state mirrored from OUTREACH_TRACKER.md at migration time
  email_outreach_status: string | null;
  whatsapp_outreach_status: string | null; // null | APPROVED | REJECTED | SENT | REPLIED | OPT_OUT
  call_status: string | null;
  call_attempts?: CallAttempt[];
  linkedin_status: string | null;
  instagram_status: string | null;
  last_contacted_at: string | null;
  email_follow_up_sent_at?: string | null; // single-bump protocol: set once via pipeline:log FOLLOW_UP_SENT
  next_action: string | null;
  next_action_date: string | null;
  owner: 'DEV' | 'AADI' | null;

  // ── Suppression ──
  do_not_contact?: boolean;
  suppression_reason?: string | null;

  // ── Sales ──
  response_status: string | null;
  lead_temperature: 'HOT' | 'WARM' | 'COLD' | 'DEAD' | null;
  call_outcome: string | null;
  objection: string | null;
  meeting_status: string | null; // null | BOOKED | DONE
  proposal_status: string | null; // null | SENT
  deal_stage: string | null; // null | WON | LOST
  deal_value: string | null;
  lost_reason: string | null;
  notes: string | null;

  // ── Dedupe ──
  possible_duplicate_of?: string | null;
  duplicate_reason?: string | null;

  // ── Research Evidence ──
  research_sources: ResearchSource[];
  overall_research_confidence: ConfidenceLevel;

  // ── Conversion (never estimated without historical data) ──
  conversion_probability: 'UNKNOWN';
  expected_revenue: 'UNKNOWN';

  // ── Metadata ──
  created_at: string;
  updated_at: string;
  migrated_from_csv: boolean;
  batch_history: string[];
}

export interface ResearchQueueItem {
  lead_id: string;
  target_number: string;
  company: string;
  priority: LeadPriority | 'UNSCORED';
  priority_confidence: 'CONFIRMED' | 'PROVISIONAL' | null;
  kachmo_score: number | null;
  research_completeness_score: number;
  missing_fields: string[];
  specific_research_tasks: ResearchTask[];
  owner: 'DEV' | 'AADI';
  status: ResearchQueueStatus;
  created_at: string;
  updated_at: string;
}

export interface ResearchTask {
  field: string;
  task: string;
  evidence_needed: string;
  record_with: string;
}

export interface SuppressionEntry {
  lead_id?: string;
  target_number?: string;
  company_name?: string;
  email?: string;
  phone?: string;
  domain?: string;
  reason: string;
  suppressed_at: string;
  source: string;
}

export interface CallingCard {
  lead_id: string;
  target_number: string;
  company_name: string;
  website_url: string;
  decision_maker_name: string;
  decision_maker_title: string;
  phone_number: string;
  phone_status: ContactProvenance;
  phone_source: string | null;
  location_city: string;
  timezone: string | null;
  priority: LeadPriority | null;
  priority_confidence: 'CONFIRMED' | 'PROVISIONAL' | null;
  kachmo_score: number | null;
  score_signals: string[];
  research_completeness_score: number;
  archetype: string;
  commercial_signal: string;
  commercial_signal_verified: boolean;
  observable_friction: string;
  friction_verified: boolean;
  kachmo_angle: string;
  why_now: string | null;
  call_objective: string;
  recommended_opening: string;
  bridge: string;
  discovery_questions: string[];
  objections: Array<{ objection: string; response: string }>;
  what_not_to_say: string[];
  verify_before_call: string[];
  previous_attempts: number;
  log_command: string;
}

export interface WhatsAppQueueItem {
  lead_id: string;
  target_number: string;
  company_name: string;
  decision_maker_name: string;
  whatsapp_number: string;
  whatsapp_basis: 'BUSINESS_LISTED_WHATSAPP' | 'PERMISSION_GIVEN_ON_CALL';
  priority: LeadPriority | null;
  kachmo_score: number | null;
  message_draft: string;
  word_count: number;
  outreach_angle: string;
  status: 'PENDING_HUMAN_REVIEW' | 'APPROVED' | 'REJECTED';
}

export type EventType =
  | 'LEAD_DISCOVERED'
  | 'QUALIFICATION_CHANGED'
  | 'PRIORITY_CHANGED'
  | 'RESEARCH_RECORDED'
  | 'CONTACT_PROVENANCE_UPDATED'
  | 'CALL_ATTEMPTED'
  | 'CALL_CONNECTED'
  | 'WHATSAPP_APPROVED'
  | 'WHATSAPP_REJECTED'
  | 'WHATSAPP_SENT'
  | 'REPLY_RECEIVED'
  | 'FOLLOW_UP_SCHEDULED'
  | 'FOLLOW_UP_SENT'
  | 'OPT_OUT'
  | 'SUPPRESSION_ADDED'
  | 'MEETING_BOOKED'
  | 'MEETING_DONE'
  | 'PROPOSAL_SENT'
  | 'DEAL_WON'
  | 'DEAL_LOST'
  | 'DUPLICATE_FLAGGED';

export interface AnalyticsEvent {
  event_id: string;
  lead_id: string | null;
  target_number: string | null;
  company_name: string | null;
  event_type: EventType;
  channel: ChannelType | 'OTHER' | 'SYSTEM';
  actor: Actor;
  timestamp: string;
  /** Never put credentials or raw contact values (phone/email) here. */
  payload: Record<string, unknown>;
}
