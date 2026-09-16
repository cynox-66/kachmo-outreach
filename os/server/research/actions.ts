'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '../auth/current-actor';
import { createBrief, uploadReport, reviewCandidate, ResearchError } from './service';
import { RESEARCH_PROVIDERS, REPORT_FORMATS, MAX_REPORT_BYTES, type ReportFormat } from '@kachmo/core/research/report.js';
import { REVIEW_DECISIONS, type ReviewDecision } from '@kachmo/core/research/candidate.js';
import { ARCHETYPE_IDS } from '@kachmo/core/config/taxonomy.js';
import { RESEARCH_DEPTHS, type ResearchDepth } from '@kachmo/core/research/prompt.js';

/**
 * Server actions for the research pipeline.
 *
 * Every one follows the same order and none of them skips a step:
 *   authenticate → authorize → validate input at the boundary → core domain operation → persist → audit.
 *
 * The browser never reaches the database. Input is re-validated here even when the form already constrained it,
 * because a form is a convenience and an HTTP request is what actually arrives.
 */

const str = (form: FormData, key: string, max = 500): string => String(form.get(key) ?? '').slice(0, max).trim();

export interface ActionState {
  error: string | null;
  details?: string[];
  ok?: string | null;
}

export async function createBriefAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requirePermission('research.create');

  const archetypeId = str(form, 'archetypeId', 8);
  if (!ARCHETYPE_IDS.includes(archetypeId)) return { error: 'Choose one of the declared archetypes. A brief never invents one.' };
  const depth = str(form, 'depth', 16) as ResearchDepth;
  if (!(RESEARCH_DEPTHS as readonly string[]).includes(depth)) return { error: 'Choose a research depth.' };
  const geographies = str(form, 'geographies', 400)
    .split(',')
    .map(g => g.trim())
    .filter(Boolean)
    .slice(0, 12);
  const targetCount = Number(str(form, 'targetCount', 5));
  if (!Number.isFinite(targetCount)) return { error: 'Target count must be a number.' };
  const contactability = str(form, 'requiredContactability', 8);
  if (!['EMAIL', 'PHONE', 'EITHER'].includes(contactability)) return { error: 'Choose a contactability requirement.' };

  try {
    const { brief } = await createBrief(actor, {
      archetypeId,
      vertical: str(form, 'vertical', 120) || null,
      geographies,
      decisionMakerRole: str(form, 'decisionMakerRole', 200),
      requiredContactability: contactability as 'EMAIL' | 'PHONE' | 'EITHER',
      knownFriction: str(form, 'knownFriction', 500),
      depth,
      targetCount,
      notes: str(form, 'notes', 2000) || null,
    });
    revalidatePath('/research');
    redirect(`/research/briefs?created=${brief.id}`);
  } catch (e) {
    if (e instanceof ResearchError) return { error: e.message, details: e.problems.map(p => p.message) };
    throw e;
  }
}

export async function uploadReportAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requirePermission('research.upload');

  const format = str(form, 'format', 16) as ReportFormat;
  if (!(REPORT_FORMATS as readonly string[]).includes(format)) return { error: 'Choose a supported format. Nothing else is ever parsed.' };
  const provider = str(form, 'provider', 40);
  if (!(RESEARCH_PROVIDERS as readonly string[]).includes(provider)) return { error: 'Choose where this research came from.' };

  const file = form.get('file');
  const pasted = String(form.get('content') ?? '');
  let filename = str(form, 'filename', 200);
  let content = pasted;

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_REPORT_BYTES) return { error: `That file is ${file.size} bytes; the limit is ${MAX_REPORT_BYTES}.` };
    content = await file.text();
    filename = filename || file.name;
  }
  if (!content.trim()) return { error: 'Paste the report or choose a file.' };
  if (!filename) filename = `pasted-${new Date().toISOString().slice(0, 10)}.${format === 'markdown' ? 'md' : format}`;

  try {
    const result = await uploadReport(actor, { filename, content, format, provider, briefId: str(form, 'briefId', 64) || null });
    revalidatePath('/research');
    const errors = result.problems.filter(p => p.severity === 'ERROR');
    return {
      error: null,
      ok:
        `Stored ${result.sourceReportId}: ${result.candidates} candidate(s) extracted` +
        (errors.length ? `, ${errors.length} rejected` : '') +
        `. ${Object.entries(result.byStatus).map(([k, v]) => `${v} ${k.toLowerCase().replace(/_/g, ' ')}`).join(', ') || 'none to review'}.`,
      details: result.problems.slice(0, 20).map(p => `${p.severity}: ${p.message}`),
    };
  } catch (e) {
    if (e instanceof ResearchError) return { error: e.message, details: e.problems.map(p => p.message) };
    throw e;
  }
}

export async function reviewCandidateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  // Approving a candidate is a different permission from uploading one: a researcher may not approve their own work.
  const actor = await requirePermission('research.approve');

  const decision = str(form, 'decision', 32) as ReviewDecision;
  if (!(REVIEW_DECISIONS as readonly string[]).includes(decision)) return { error: 'Unknown review decision.' };
  const candidateId = str(form, 'candidateId', 64);
  if (!candidateId) return { error: 'Missing candidate.' };

  try {
    const result = await reviewCandidate(actor, {
      candidateId,
      decision,
      note: str(form, 'note', 2000) || null,
      mergeIntoLeadId: str(form, 'mergeIntoLeadId', 64) || null,
    });
    revalidatePath('/research');
    revalidatePath(`/research/candidates/${candidateId}`);
    return { error: null, ok: result.message };
  } catch (e) {
    if (e instanceof ResearchError) return { error: e.message };
    throw e;
  }
}
