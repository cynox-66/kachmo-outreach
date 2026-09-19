import { CALL_OUTCOMES, OBJECTION_CATEGORIES, LOST_REASONS, type CallOutcome, type ObjectionCategory, type LostReason } from '@kachmo/core/leads/schema.js';
import { decideCallOutcome, callLogInputProblem } from '@kachmo/core/state/call.js';
import { decideWhatsAppTransition, WHATSAPP_STATUSES, type WhatsAppLogStatus } from '@kachmo/core/state/whatsapp.js';
import { decidePipelineTransition, pipelineLogInputProblem, PIPELINE_STAGES, PIPELINE_CHANNELS, type PipelineStage, type PipelineChannel } from '@kachmo/core/state/pipeline.js';
import { decideResearchRecord, RECORDABLE_FIELDS, type RecordableField } from '@kachmo/core/state/research-record.js';
import type { Actor } from '../authz/authorize';
import type { Permission } from '../authz/permissions';
import { applyLeadMutation, type ApplyOptions, type MutationResult } from './mutate';
import { createSuppression } from './suppression';
import { requireEngineActor, BindingError } from './actor-binding';
import type { Db } from './locks';
import { insertEvidence, storableClaim } from '../evidence/store';

/**
 * OPERATOR COMMANDS (CAP-3) — what an operator can do to a canonical lead from the application.
 *
 * Each command maps one-to-one onto the core/ decision the legacy CLI ran, so the rules are core's and only the
 * persistence differs. Every command, in this order, without skipping a step:
 *
 *   permission (re-checked here, not only in the server action) → engine-actor binding → input validation at the
 *   boundary → the core decision, inside the applier's transaction → persist → audit
 *
 * These functions take an already-authenticated Actor so they can be tested directly; `actions.ts` is the thin
 * `'use server'` layer that resolves the actor from the session.
 */

export type CommandResult = { ok: true; message: string; warnings: string[]; version: number | null } | { ok: false; error: string };

const MAX_TEXT = 2000;
const clean = (v: unknown, max = MAX_TEXT): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  return s ? s.slice(0, max) : null;
};
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null => {
  const s = clean(v, 64)?.toUpperCase();
  return s && (allowed as readonly string[]).includes(s) ? (s as T) : null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Target {
  leadId: string;
  /** The version the operator saw. Required: the app never writes blind. */
  expectedVersion: number;
}

function target(input: { leadId?: unknown; expectedVersion?: unknown }): Target | string {
  const leadId = clean(input.leadId, 64);
  if (!leadId || !UUID.test(leadId)) return 'Missing or invalid lead.';
  const v = Number(input.expectedVersion);
  if (!Number.isInteger(v) || v < 1) return 'Missing lead version — reload the page before acting.';
  return { leadId, expectedVersion: v };
}

function missing(actor: Actor, ...permissions: Permission[]): string | null {
  const lacking = permissions.filter(p => !actor.permissions.has(p));
  return lacking.length ? `Not permitted: ${lacking.join(', ')}.` : null;
}

async function bound(db: Db, actor: Actor): Promise<'DEV' | 'AADI' | string> {
  try {
    return await requireEngineActor(db, actor.userId);
  } catch (e) {
    if (e instanceof BindingError) return `!${e.message}`;
    throw e;
  }
}

const done = (r: MutationResult): CommandResult =>
  r.outcome === 'APPLIED' ? { ok: true, message: r.summary, warnings: r.warnings, version: r.version } : { ok: false, error: r.reason };

// ── Calls ────────────────────────────────────────────────────────────────────

export interface LogCallInput {
  leadId: unknown;
  expectedVersion: unknown;
  outcome: unknown;
  notes?: unknown;
  objection?: unknown;
  objectionCategory?: unknown;
  callbackDate?: unknown;
  whatsappOk?: unknown;
  confirmedIdentity?: unknown;
}

export async function logCall(db: Db, actor: Actor, raw: LogCallInput, opts: ApplyOptions = {}): Promise<CommandResult> {
  const denied = missing(actor, 'outreach.call');
  if (denied) return { ok: false, error: denied };
  const by = await bound(db, actor);
  if (by.startsWith('!')) return { ok: false, error: by.slice(1) };
  const t = target(raw);
  if (typeof t === 'string') return { ok: false, error: t };
  const outcome = pick<CallOutcome>(raw.outcome, CALL_OUTCOMES);
  if (!outcome) return { ok: false, error: `Choose a call outcome (${CALL_OUTCOMES.join(', ')}).` };
  const objectionCategory = raw.objectionCategory ? pick<ObjectionCategory>(raw.objectionCategory, OBJECTION_CATEGORIES) : null;
  if (raw.objectionCategory && !objectionCategory) return { ok: false, error: 'Unknown objection category.' };

  const input = {
    outcome,
    by: by as 'DEV' | 'AADI',
    notes: clean(raw.notes),
    objection: clean(raw.objection, 500),
    objectionCategory,
    callbackDate: clean(raw.callbackDate, 10),
    whatsappOk: raw.whatsappOk === true || raw.whatsappOk === 'on' || raw.whatsappOk === 'true',
    confirmedIdentity: raw.confirmedIdentity === true || raw.confirmedIdentity === 'on' || raw.confirmedIdentity === 'true',
  };
  const problem = callLogInputProblem(input);
  if (problem) return { ok: false, error: problem };

  return done(
    await applyLeadMutation(
      db,
      { ...t, action: 'lead.call_logged', actor: { userId: actor.userId, label: actor.name, engineActor: input.by }, decide: (lead, ctx) => decideCallOutcome(lead, input, ctx), metadata: { outcome } },
      opts
    )
  );
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────

export async function transitionWhatsApp(db: Db, actor: Actor, raw: { leadId: unknown; expectedVersion: unknown; status: unknown; notes?: unknown }, opts: ApplyOptions = {}): Promise<CommandResult> {
  const denied = missing(actor, 'outreach.whatsapp');
  if (denied) return { ok: false, error: denied };
  const by = await bound(db, actor);
  if (by.startsWith('!')) return { ok: false, error: by.slice(1) };
  const t = target(raw);
  if (typeof t === 'string') return { ok: false, error: t };
  const status = pick<WhatsAppLogStatus>(raw.status, WHATSAPP_STATUSES);
  if (!status) return { ok: false, error: `Choose a WhatsApp status (${WHATSAPP_STATUSES.join(', ')}).` };
  const input = { status, by: by as 'DEV' | 'AADI', notes: clean(raw.notes) };
  return done(
    await applyLeadMutation(
      db,
      { ...t, action: 'lead.whatsapp_transitioned', actor: { userId: actor.userId, label: actor.name, engineActor: input.by }, decide: (lead, ctx) => decideWhatsAppTransition(lead, input, ctx), metadata: { status } },
      opts
    )
  );
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * FOLLOW_UP_SENT is an EMAIL follow-up. Titan sends it and Titan's ledger records it (ADR-009, ADR-019); the
 * applier's ownership check would refuse the field it writes anyway. Refusing here says why, in operator language.
 */
export const APP_PIPELINE_STAGES = PIPELINE_STAGES.filter(s => s !== 'FOLLOW_UP_SENT');

export async function transitionPipeline(
  db: Db,
  actor: Actor,
  raw: { leadId: unknown; expectedVersion: unknown; stage: unknown; channel?: unknown; value?: unknown; reason?: unknown; date?: unknown; notes?: unknown },
  opts: ApplyOptions = {}
): Promise<CommandResult> {
  const denied = missing(actor, 'pipeline.update');
  if (denied) return { ok: false, error: denied };
  const by = await bound(db, actor);
  if (by.startsWith('!')) return { ok: false, error: by.slice(1) };
  const t = target(raw);
  if (typeof t === 'string') return { ok: false, error: t };
  const stage = pick<PipelineStage>(raw.stage, PIPELINE_STAGES);
  if (!stage) return { ok: false, error: `Choose a stage (${APP_PIPELINE_STAGES.join(', ')}).` };
  if (stage === 'FOLLOW_UP_SENT') return { ok: false, error: 'Email follow-ups are sent and recorded by Titan (OUTREACH_TRACKER.md), not by the app.' };
  const channel = raw.channel ? pick<PipelineChannel>(raw.channel, PIPELINE_CHANNELS) : null;
  if (raw.channel && !channel) return { ok: false, error: 'Unknown channel.' };
  const reason = raw.reason ? pick<LostReason>(raw.reason, LOST_REASONS) : null;
  if (raw.reason && !reason) return { ok: false, error: 'Unknown lost reason.' };
  const input = { stage, by: by as 'DEV' | 'AADI', channel, value: clean(raw.value, 40), reason, date: clean(raw.date, 10), notes: clean(raw.notes) };
  const problem = pipelineLogInputProblem(input);
  if (problem) return { ok: false, error: problem };
  return done(
    await applyLeadMutation(
      db,
      { ...t, action: 'lead.pipeline_transitioned', actor: { userId: actor.userId, label: actor.name, engineActor: input.by }, decide: (lead, ctx) => decidePipelineTransition(lead, input, ctx), metadata: { stage, channel } },
      opts
    )
  );
}

// ── Research ─────────────────────────────────────────────────────────────────

const isKnownTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export async function recordResearch(
  db: Db,
  actor: Actor,
  raw: { leadId: unknown; expectedVersion: unknown; field: unknown; value?: unknown; status?: unknown; source?: unknown; sourceType?: unknown; basis?: unknown; title?: unknown; date?: unknown },
  opts: ApplyOptions = {}
): Promise<CommandResult> {
  const field = clean(raw.field, 32)?.toLowerCase() as RecordableField | undefined;
  if (!field || !(RECORDABLE_FIELDS as readonly string[]).includes(field)) return { ok: false, error: `Choose what you are recording (${RECORDABLE_FIELDS.join(', ')}).` };
  // Kachmo fit is gate 8's human judgement: an approval, not an edit. A contact value is only recorded by someone
  // allowed to see contact values — you cannot vouch for a number you are not permitted to read.
  const needed: Permission[] = ['lead.edit', ...(field === 'fit' ? (['lead.approve'] as const) : []), ...(field === 'email' || field === 'phone' ? (['lead.view_contacts'] as const) : [])];
  const denied = missing(actor, ...needed);
  if (denied) return { ok: false, error: denied };
  const by = await bound(db, actor);
  if (by.startsWith('!')) return { ok: false, error: by.slice(1) };
  const t = target(raw);
  if (typeof t === 'string') return { ok: false, error: t };

  const input = {
    field,
    by: by as 'DEV' | 'AADI',
    // A bound person is always an explicit, named identity — the CLI's `--by` requirement for fit is met.
    byExplicit: true,
    value: clean(raw.value, 1000),
    status: clean(raw.status, 32),
    source: clean(raw.source, 1000),
    sourceType: clean(raw.sourceType, 40),
    basis: clean(raw.basis, 1000),
    title: clean(raw.title, 200),
    date: clean(raw.date, 10),
  };
  return done(
    await applyLeadMutation(
      db,
      {
        ...t,
        action: 'lead.research_recorded',
        actor: { userId: actor.userId, label: actor.name, engineActor: input.by },
        decide: (lead, ctx) => decideResearchRecord(lead, input, { today: ctx.today, now: ctx.now, isKnownTimezone }),
        metadata: { field, hasSource: !!input.source, status: input.status },
        // The source a person cites becomes claim-level evidence the fetcher can retrieve and a reviewer can check.
        afterWrite: async (tx, lead) => {
          if (!input.source) return;
          const leadField = RECORDED_FIELD[field];
          await insertEvidence(tx, [
            {
              leadId: lead.lead_id,
              field: leadField,
              claimValue: storableClaim(leadField, (lead as unknown as Record<string, unknown>)[leadField] as string | null),
              sourceUrl: input.source,
              sourceType: input.sourceType ?? 'other',
              observedAt: null,
              origin: 'HUMAN_RECORD',
              validator: 'SYNTAX_CHECK',
              recordedByUserId: actor.userId,
              recordedByLabel: actor.name,
            },
          ]);
        },
      },
      opts
    )
  );
}

/** The lead field each recordable research field writes — the field its evidence is about. */
export const RECORDED_FIELD: Record<RecordableField, string> = {
  email: 'decision_maker_email',
  phone: 'decision_maker_phone',
  'decision-maker': 'decision_maker_name',
  'whatsapp-basis': 'whatsapp_basis',
  'commercial-source': 'commercial_validation_signal',
  'friction-source': 'observable_friction',
  trigger: 'trigger_event',
  budget: 'budget_probability',
  tech: 'current_framework',
  'frontend-team': 'frontend_team_status',
  fit: 'kachmo_fit_confirmed_by',
  timezone: 'timezone',
};

// ── Suppression ──────────────────────────────────────────────────────────────

export async function recordSuppression(
  db: Db,
  actor: Actor,
  raw: { leadId?: unknown; email?: unknown; phone?: unknown; domain?: unknown; reason: unknown },
  opts: ApplyOptions = {}
): Promise<CommandResult> {
  const denied = missing(actor, 'suppression.create');
  if (denied) return { ok: false, error: denied };
  const by = await bound(db, actor);
  if (by.startsWith('!')) return { ok: false, error: by.slice(1) };
  const reason = clean(raw.reason, 500);
  if (!reason) return { ok: false, error: 'Say why this contact must not be contacted.' };
  const leadId = clean(raw.leadId, 64);
  if (leadId && !UUID.test(leadId)) return { ok: false, error: 'Invalid lead.' };
  const r = await createSuppression(
    db,
    { userId: actor.userId, label: actor.name, engineActor: by as 'DEV' | 'AADI' },
    { reason, leadId, email: clean(raw.email, 254), phone: clean(raw.phone, 40), domain: clean(raw.domain, 253) },
    opts
  );
  return r.outcome === 'APPLIED' ? { ok: true, message: r.message, warnings: r.scheduledConflicts.length ? [`Queued for email: ${r.scheduledConflicts.join(', ')}`] : [], version: null } : { ok: false, error: r.reason };
}
