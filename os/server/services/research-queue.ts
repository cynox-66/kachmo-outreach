import 'server-only';
import { buildResearchQueue, FIELD_ORDER } from '@kachmo/core/research/tasks.js';
import type { RecordableField } from '@kachmo/core/state/research-record.js';
import type { Actor } from '../authz/authorize';
import { loadCanonical, ledgerStatusOf, type CanonicalSnapshot } from '../repo/canonical';
import { activeEngineActor } from '../leads/actor-binding';
import { scrubContactValues } from './contacts';
import { getServer } from '../auth/instance';

/**
 * THE IN-APP RESEARCH LOOP (Phase C).
 *
 * core/'s research tasks (golden-pinned) name the legacy CLI command that records each finding, and that command is
 * refused after cutover. This maps every core task field to the research-record form field that records the same
 * finding through the Phase B write path — so a task on the lead page opens a prefilled form instead of a dead
 * command. The mapping is presentation only: which rule the finding satisfies is still decided by core.
 */
export const RECORD_FIELD_FOR_TASK: Record<(typeof FIELD_ORDER)[number], RecordableField> = {
  direct_contact_route: 'email',
  phone_source: 'phone',
  email_source: 'email',
  decision_maker_name: 'decision-maker',
  decision_maker_source: 'decision-maker',
  observable_friction: 'friction-source',
  website_friction_source: 'friction-source',
  commercial_validation_signal: 'commercial-source',
  commercial_signal_source: 'commercial-source',
  kachmo_solution_angle: 'fit',
  kachmo_fit_review: 'fit',
  location_timezone: 'timezone',
  trigger_event: 'trigger',
  trigger_source: 'trigger',
  budget_probability: 'budget',
  budget_probability_source: 'budget',
  technology_stack: 'tech',
  technology_source: 'tech',
  frontend_team_status: 'frontend-team',
};

export const recordFieldForTask = (field: string): RecordableField | null => RECORD_FIELD_FOR_TASK[field as keyof typeof RECORD_FIELD_FOR_TASK] ?? null;

export interface ResearchQueueView {
  source: 'GIT_JSON' | 'POSTGRES';
  me: 'DEV' | 'AADI' | null;
  items: Array<{
    targetNumber: string;
    company: string;
    priority: string;
    confidence: string | null;
    score: number | null;
    completeness: number;
    owner: 'DEV' | 'AADI';
    tasks: Array<{ field: string; task: string; recordField: RecordableField | null }>;
  }>;
  /** Research fields blocking the most leads — what to work on first. */
  topFields: Array<{ field: string; leads: number }>;
}

/** Every lead with open research, in core's own order (priority, then completeness). Contact values never appear. */
export async function getResearchQueue(actor: Actor, opts: { mine?: boolean; snapshot?: CanonicalSnapshot } = {}): Promise<ResearchQueueView> {
  const snap = opts.snapshot ?? (await loadCanonical());
  const items = buildResearchQueue(snap.leads, snap.suppression, ledgerStatusOf(snap), new Map(), new Date().toISOString());
  const me = snap.source === 'POSTGRES' ? await activeEngineActor(getServer().db, actor.userId).catch(() => null) : null;
  const visible = items.filter(i => !opts.mine || !me || i.owner === me);
  const sees = actor.permissions.has('lead.view_contacts');
  const byId = new Map(snap.leads.map(l => [l.lead_id, l]));
  const counts = new Map<string, number>();
  for (const i of visible) for (const t of i.specific_research_tasks) counts.set(t.field, (counts.get(t.field) ?? 0) + 1);
  return {
    source: snap.source,
    me,
    items: visible.map(i => ({
      targetNumber: i.target_number,
      company: i.company,
      priority: i.priority,
      confidence: i.priority_confidence,
      score: i.kachmo_score,
      completeness: i.research_completeness_score,
      owner: i.owner,
      // Task text can quote the lead's own phone or email ("find where +44… is published"), so it is scrubbed for
      // anyone who may not see contact values — exactly as the lead page does.
      tasks: i.specific_research_tasks.map(t => ({ field: t.field, task: sees ? t.task : scrubContactValues(t.task, byId.get(i.lead_id)!), recordField: recordFieldForTask(t.field) })),
    })),
    topFields: [...counts.entries()].map(([field, leads]) => ({ field, leads })).sort((a, b) => b.leads - a.leads || a.field.localeCompare(b.field)).slice(0, 8),
  };
}
