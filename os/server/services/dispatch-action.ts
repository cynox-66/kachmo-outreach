'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '../auth/current-actor';
import { guarded } from '../auth/action-guard';
import { triggerOutreachDispatch, type DispatchResult } from './dispatch';

export interface DispatchActionState {
  error: string | null;
  ok?: string | null;
  runUrl?: string;
}

export async function dispatchQueueAction(
  _prev: DispatchActionState,
  formData: FormData
): Promise<DispatchActionState> {
  return guarded(async () => {
    await requirePermission('outreach.email');
    const force = formData.get('force') === 'true';
    const result: DispatchResult = await triggerOutreachDispatch(force);
    if (!result.ok) {
      return { error: result.message, runUrl: result.runUrl };
    }
    revalidatePath('/email');
    revalidatePath('/');
    return { error: null, ok: result.message, runUrl: result.runUrl };
  });
}
