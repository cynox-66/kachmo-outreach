'use server';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '../auth/current-actor';
import { getServer } from '../auth/instance';
import { logCall, transitionWhatsApp, transitionPipeline, recordResearch, recordSuppression, type CommandResult } from './commands';

/**
 * Server actions for operator writes to canonical leads (Phase B, CAP-3).
 *
 * Thin by design: authenticate and authorize from the session, then hand the form to the command layer, which
 * re-checks the permission, requires an engine-actor binding, validates, and runs the core decision inside the
 * applier's transaction. Nothing the browser sends is trusted — a form is a convenience, an HTTP request is what
 * arrives. Writes are refused unless KACHMO_APP_WRITES=on (ADR-027).
 */

export interface LeadActionState {
  error: string | null;
  ok?: string | null;
  warnings?: string[];
}

const field = (form: FormData, key: string): string | null => {
  const v = form.get(key);
  return typeof v === 'string' ? v : null;
};

function refresh(form: FormData): void {
  const leadId = field(form, 'leadId');
  revalidatePath('/');
  revalidatePath('/leads');
  if (leadId) revalidatePath(`/leads/${leadId}`);
  revalidatePath('/calls');
  revalidatePath('/whatsapp');
  revalidatePath('/pipeline');
}

function finish(form: FormData, r: CommandResult): LeadActionState {
  if (!r.ok) return { error: r.error };
  refresh(form);
  return { error: null, ok: r.message, warnings: r.warnings };
}

export async function logCallAction(_prev: LeadActionState, form: FormData): Promise<LeadActionState> {
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
}

export async function whatsappTransitionAction(_prev: LeadActionState, form: FormData): Promise<LeadActionState> {
  const actor = await requirePermission('outreach.whatsapp');
  return finish(
    form,
    await transitionWhatsApp(getServer().db, actor, { leadId: field(form, 'leadId'), expectedVersion: field(form, 'expectedVersion'), status: field(form, 'status'), notes: field(form, 'notes') })
  );
}

export async function pipelineTransitionAction(_prev: LeadActionState, form: FormData): Promise<LeadActionState> {
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
}

export async function recordResearchAction(_prev: LeadActionState, form: FormData): Promise<LeadActionState> {
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
}

export async function createSuppressionAction(_prev: LeadActionState, form: FormData): Promise<LeadActionState> {
  const actor = await requirePermission('suppression.create');
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
}
