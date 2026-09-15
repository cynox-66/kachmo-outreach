import type { EventType } from './lib/schema.js';
import { loadLeads, saveLeads, logEvent, findLead } from './lib/store.js';
import { isUrl, normalizeEmail, phoneKey, OUTREACH_USABLE } from './lib/contact.js';
import { todayIst } from './lib/geo.js';
import { parseArgs, str, oneOf, fail, runCli } from './lib/cli.js';

const FIELDS = ['email', 'phone', 'decision-maker', 'whatsapp-basis', 'commercial-source', 'friction-source', 'trigger', 'budget', 'tech', 'frontend-team', 'fit', 'timezone'];
const PROVENANCE = ['UNKNOWN', 'INFERRED', 'UNVERIFIED', 'PUBLICLY_LISTED', 'VERIFIED', 'INVALID'] as const;
const USAGE =
  `Usage: npm run leads:record -- --lead=<target> --field=<${FIELDS.join('|')}> ` +
  `[--value=...] [--status=${PROVENANCE.join('|')}] [--source=<https url>] [--basis="..."] [--title="..."] [--by=DEV|AADI]`;

/** How humans record research. Provenance rules are enforced here and again by saveLeads() invariants. */
export function recordResearch(argv: string[]): void {
  const args = parseArgs(argv, ['lead', 'field', 'value', 'status', 'source', 'source-type', 'basis', 'title', 'by', 'date']);
  const ident = str(args, 'lead');
  const field = str(args, 'field')?.toLowerCase();
  if (!ident || !field || !FIELDS.includes(field)) fail(USAGE);
  const by = oneOf(str(args, 'by') ?? 'DEV', ['DEV', 'AADI'] as const, 'by')!;
  const value = str(args, 'value');
  const source = str(args, 'source');
  const basis = str(args, 'basis');
  if (source && !isUrl(source)) fail(`--source must be a full http(s) URL, got "${source}"`);

  const leads = loadLeads();
  const lead = findLead(leads, ident);
  if (!lead) fail(`No lead matches --lead=${ident}.`);
  const tn = lead.target_number;
  const now = new Date().toISOString();
  const today = todayIst();
  let eventType: EventType = 'RESEARCH_RECORDED';
  const payload: Record<string, unknown> = { field, has_source: !!source };

  const contact = (kind: 'email' | 'phone') => {
    const status = oneOf(str(args, 'status'), PROVENANCE, 'status');
    if (!status) fail(`--field=${kind} requires --status=${PROVENANCE.join('|')}`);
    if (value && kind === 'email' && !normalizeEmail(value)) fail(`Not a valid email: ${value}`);
    if (value && kind === 'phone' && !phoneKey(value)) fail(`Not a valid phone number (needs at least 10 digits): ${value}`);
    const current = kind === 'email' ? lead.decision_maker_email : lead.decision_maker_phone;
    if (!value && !current) fail(`${tn} has no ${kind} on file; pass --value.`);
    if (status === 'PUBLICLY_LISTED' && !source) fail('PUBLICLY_LISTED requires --source=<the https source URL where it is published>');
    if (status === 'VERIFIED' && !basis) fail('VERIFIED requires --basis="how it was verified"');
    if (kind === 'email') {
      if (value) lead.decision_maker_email = normalizeEmail(value);
      lead.email_status = status;
      lead.email_source = source ?? basis ?? lead.email_source;
      lead.email_verification_basis = status === 'VERIFIED' ? basis! : null;
      lead.email_verified_at = status === 'VERIFIED' ? now : null;
    } else {
      if (value) lead.decision_maker_phone = value;
      lead.phone_status = status;
      lead.phone_source = source ?? basis ?? lead.phone_source;
      lead.phone_verification_basis = status === 'VERIFIED' ? basis! : null;
      lead.phone_verified_at = status === 'VERIFIED' ? now : null;
      if (!OUTREACH_USABLE.has(status)) {
        lead.whatsapp_basis = null;
        lead.whatsapp_basis_source = null;
      }
    }
    eventType = 'CONTACT_PROVENANCE_UPDATED';
    payload.status = status;
  };

  switch (field) {
    case 'email':
      contact('email');
      break;
    case 'phone':
      contact('phone');
      break;
    case 'decision-maker': {
      if (!source) fail('--field=decision-maker requires --source=<url showing the person and role>');
      if (value) lead.decision_maker_name = value;
      const title = str(args, 'title');
      if (title) lead.decision_maker_title = title;
      lead.decision_maker_source = source;
      lead.decision_maker_confidence = 'MEDIUM';
      break;
    }
    case 'whatsapp-basis': {
      const v = oneOf(value, ['BUSINESS_LISTED_WHATSAPP', 'PERMISSION_GIVEN_ON_CALL', 'NONE'] as const, 'value');
      if (!v) fail('--field=whatsapp-basis requires --value=BUSINESS_LISTED_WHATSAPP|PERMISSION_GIVEN_ON_CALL|NONE');
      if (v === 'NONE') {
        lead.whatsapp_basis = null;
        lead.whatsapp_basis_source = null;
      } else {
        if (!phoneKey(lead.decision_maker_phone)) fail(`${tn} has no phone on file; record the phone first.`);
        if (v === 'BUSINESS_LISTED_WHATSAPP' && !source) fail('BUSINESS_LISTED_WHATSAPP requires --source=<url where the business advertises WhatsApp on this number>');
        if (v === 'PERMISSION_GIVEN_ON_CALL' && !basis) fail('PERMISSION_GIVEN_ON_CALL requires --basis="when/how permission was given"');
        lead.whatsapp_basis = v;
        lead.whatsapp_basis_source = v === 'BUSINESS_LISTED_WHATSAPP' ? source! : basis!;
      }
      break;
    }
    case 'commercial-source':
      if (!source) fail('--field=commercial-source requires --source=<url>');
      if (value) lead.commercial_validation_signal = value;
      lead.commercial_signal_source = source;
      lead.commercial_signal_confidence = 'MEDIUM';
      break;
    case 'friction-source':
      if (!source) fail('--field=friction-source requires --source=<page url you checked>');
      if (value) lead.observable_friction = value;
      lead.website_friction_source = source;
      lead.website_friction_confidence = 'MEDIUM';
      break;
    case 'trigger':
      if (!value) fail('--field=trigger requires --value="<what happened>" or --value=NO_CLEAR_TRIGGER');
      if (value.toUpperCase() === 'NO_CLEAR_TRIGGER') {
        lead.trigger_event = 'NO_CLEAR_TRIGGER';
        lead.trigger_source = source ?? null;
        lead.trigger_date = null;
        lead.trigger_confidence = 'MEDIUM';
        lead.why_now = null;
      } else {
        lead.trigger_event = value;
        lead.trigger_source = source ?? null;
        lead.trigger_date = str(args, 'date') ?? null;
        lead.trigger_confidence = source ? 'MEDIUM' : 'LOW';
        lead.why_now = value;
      }
      break;
    case 'budget': {
      const v = oneOf(value, ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const, 'value');
      if (!v) fail('--field=budget requires --value=VERY_HIGH|HIGH|MEDIUM|LOW|UNKNOWN');
      if (v !== 'UNKNOWN' && !basis) fail('--field=budget requires --basis="<the evidence>"');
      lead.budget_probability = v;
      lead.budget_probability_reason = v === 'UNKNOWN' ? null : basis!;
      lead.budget_probability_source = v === 'UNKNOWN' ? null : source ?? null;
      break;
    }
    case 'tech':
      if (!value) fail('--field=tech requires --value="<CMS / framework>"');
      lead.current_framework = value;
      lead.technology_source = source ?? null;
      lead.technology_confidence = source ? 'MEDIUM' : 'LOW';
      break;
    case 'frontend-team': {
      const v = oneOf(value, ['NO_FRONTEND_TEAM', 'SMALL_INTERNAL_TEAM', 'LARGE_INTERNAL_TEAM', 'UNCLEAR'] as const, 'value');
      if (!v) fail('--field=frontend-team requires --value=NO_FRONTEND_TEAM|SMALL_INTERNAL_TEAM|LARGE_INTERNAL_TEAM|UNCLEAR');
      lead.frontend_team_status = v;
      lead.frontend_team_evidence = source ?? basis ?? null;
      break;
    }
    case 'fit': {
      const v = oneOf(value, ['CONFIRMED', 'REJECTED'] as const, 'value');
      if (!v) fail('--field=fit requires --value=CONFIRMED|REJECTED');
      if (!args.by) fail('--field=fit requires --by=DEV|AADI (fit is a named human judgement)');
      if (v === 'CONFIRMED') {
        lead.kachmo_fit_confirmed_by = by;
        lead.kachmo_fit_rejected_reason = null;
        if (basis && (lead.kachmo_solution_angle || '').trim().length < 10) lead.kachmo_solution_angle = basis;
      } else {
        if (!basis) fail('--value=REJECTED requires --basis="why it is not a fit"');
        lead.kachmo_fit_rejected_reason = basis;
        lead.kachmo_fit_confirmed_by = null;
      }
      break;
    }
    case 'timezone':
      if (!value) fail('--field=timezone requires --value=<IANA timezone>');
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
      } catch {
        fail(`Unknown IANA timezone: ${value}`);
      }
      lead.timezone = value;
      lead.timezone_basis = `recorded by ${by} ${today}${source ? ` (${source})` : ''}`;
      break;
  }

  lead.research_sources = [
    ...(lead.research_sources ?? []),
    { source_url: source ?? null, source_type: str(args, 'source-type') ?? (source ? 'web' : 'human_note'), source_date: today, field_covered: field, confidence: source ? 'MEDIUM' : 'LOW', recorded_by: by },
  ];
  lead.research_last_verified_at = now;
  lead.updated_at = now;
  saveLeads(leads);
  logEvent({ lead_id: lead.lead_id, target_number: tn, company_name: lead.company_name, event_type: eventType, channel: 'SYSTEM', actor: by, payload });
  console.log(`✅ Recorded ${field} for ${tn} ${lead.company_name}. Run "npm run leads:refresh" to re-qualify and re-score.`);
}

if (process.argv[1]?.endsWith('leads-record.ts')) {
  runCli(() => recordResearch(process.argv.slice(2)));
}
