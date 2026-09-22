'use server';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '../auth/current-actor';
import { getServer } from '../auth/instance';
import { guarded } from '../auth/action-guard';
import { humanizeRefusal, humanizeSuccess } from '../services/operator';
import { logCall, transitionWhatsApp, transitionPipeline, recordResearch, recordSuppression, type CommandResult } from './commands';

/**
 * Server actions for operator writes to canonical leads (Phase B, CAP-3).
 *
 * Thin by design: authenticate and authorize from the session, then hand the form to the command layer, which
 * re-checks the permission, requires an engine-actor binding, validates, and runs the core decision inside the
 * applier's transaction. Nothing the browser sends is trusted — a form is a convenience, an HTTP request is what
 * arrives. Writes are refused unless KACHMO_APP_WRITES=on (ADR-027).
 *
 * This is also the boundary where the command layer's wording (written for the CLI, and pinned by its tests) becomes
 * operator language (ADR-035), and where an expired session or a failed database becomes a message rather than a
 * crashed page (`guarded`, audit C5).
 */

export interface LeadActionState {
  error: string | null;
  ok?: string | null;
  warnings?: string[];
  /** The version the lead now has, when something was written. */
  version?: number | null;
}

const field = (form: FormData, key: string): string | null => {
  const v = form.get(key);
  return typeof v === 'string' ? v : null;
};

/**
 * Re-renders every surface that shows lead state. The company page is addressed by target number (`/leads/101`), which
 * the form sends as `targetNumber`; the layout-wide revalidation also covers any other open view of the company.
 */
function refresh(form: FormData): void {
  const tn = field(form, 'targetNumber');
  if (tn && /^\d{1,4}$/.test(tn)) revalidatePath(`/leads/${tn}`);
  revalidatePath('/', 'layout');
}

function finish(form: FormData, r: CommandResult): LeadActionState {
  if (!r.ok) return { error: humanizeRefusal(r.error) };
  refresh(form);
  // "Queued for email: …" is a suppression warning the success sentence already explains in full.
  const warnings = r.warnings.filter(w => !/^Queued for email:/.test(w)).map(w => humanizeRefusal(w));
  return { error: null, ok: humanizeSuccess(r.message), warnings, version: r.version };
}

export async function logCallAction(_prev: LeadActionState, form: FormData): Promise<LeadActionState> {
  return guarded(async () => {
    const actor = await requirePermission('outreach.call');
    return finish(
      form,
      await logCall(getServer().db, actor, {
        leadId: field(form, 'leadId'),
        expectedVersion: field(form, 'expectedVersion'),
        outcome: field(form, 'outcome'),
        notes: field(form, 'notes'),
        objection: field(form, 'objection'),
        objectionCategory: field(form, 'objectionCategory') || null,
        callbackDate: field(form, 'callbackDate') || null,
        whatsappOk: field(form, 'whatsappOk'),
        confirmedIdentity: field(form, 'confirmedIdentity'),
      })
    );
  });
}

export async function whatsappTransitionAction(_prev: LeadActionState, form: FormData): Promise<LeadActionState> {
  return guarded(async () => {
    const actor = await requirePermission('outreach.whatsapp');
    return finish(
      form,
      await transitionWhatsApp(getServer().db, actor, { leadId: field(form, 'leadId'), expectedVersion: field(form, 'expectedVersion'), status: field(form, 'status'), notes: field(form, 'notes') })
    );
  });
}

export async function pipelineTransitionAction(_prev: LeadActionState, form: FormData): Promise<LeadActionState> {
  return guarded(async () => {
    const actor = await requirePermission('pipeline.update');
    return finish(
      form,
      await transitionPipeline(getServer().db, actor, {
        leadId: field(form, 'leadId'),
        expectedVersion: field(form, 'expectedVersion'),
        stage: field(form, 'stage'),
        channel: field(form, 'channel') || null,
        value: field(form, 'value'),
        reason: field(form, 'reason') || null,
        date: field(form, 'date') || null,
        notes: field(form, 'notes'),
      })
    );
  });
}

export async function recordResearchAction(_prev: LeadActionState, form: FormData): Promise<LeadActionState> {
  return guarded(async () => {
    const actor = await requirePermission('lead.edit');
    return finish(
      form,
      await recordResearch(getServer().db, actor, {
        leadId: field(form, 'leadId'),
        expectedVersion: field(form, 'expectedVersion'),
        field: field(form, 'field'),
        value: field(form, 'value'),
        status: field(form, 'status'),
        source: field(form, 'source'),
        sourceType: field(form, 'sourceType'),
        basis: field(form, 'basis'),
        title: field(form, 'title'),
        date: field(form, 'date'),
      })
    );
  });
}

export async function createSuppressionAction(_prev: LeadActionState, form: FormData): Promise<LeadActionState> {
  return guarded(async () => {
    const actor = await requirePermission('suppression.create');
    // A do-not-contact is hard to undo, so the form sends an explicit confirmation; a request without one is refused
    // rather than trusted (the confirmation step is not only a client-side nicety).
    if (field(form, 'confirm') !== 'yes') return { error: 'Confirm the do-not-contact before it is recorded. Nothing was saved.' };
    return finish(
      form,
      await recordSuppression(getServer().db, actor, {
        leadId: field(form, 'leadId') || null,
        email: field(form, 'email') || null,
        phone: field(form, 'phone') || null,
        domain: field(form, 'domain') || null,
        reason: field(form, 'reason'),
      })
    );
  });
}
