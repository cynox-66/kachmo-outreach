'use server';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '../auth/current-actor';
import { getServer } from '../auth/instance';
import { guarded, isUuid } from '../auth/action-guard';
import { reviewEvidence } from './review';

/**
 * The evidence review server action (CAP-7). Authorizes from the session; the review itself re-checks both
 * permissions, requires a real retrieval and a verbatim excerpt, and never changes the lead.
 */

export interface EvidenceActionState {
  error: string | null;
  ok?: string | null;
}

export async function reviewEvidenceAction(_prev: EvidenceActionState, form: FormData): Promise<EvidenceActionState> {
  return guarded(async () => {
    const actor = await requirePermission('evidence.review');
    if (!isUuid(form.get('evidenceId'))) return { error: 'That source could not be found. Reload the page.' };
    const r = await reviewEvidence(getServer().db, actor, {
      evidenceId: form.get('evidenceId'),
      verdict: form.get('verdict'),
      excerpt: form.get('excerpt'),
      note: form.get('note'),
    });
    if (!r.ok) return { error: r.error };
    const tn = form.get('targetNumber');
    if (typeof tn === 'string' && /^\d{1,4}$/.test(tn)) revalidatePath(`/leads/${tn}`);
    revalidatePath('/', 'layout');
    return { error: null, ok: r.message };
  });
}
