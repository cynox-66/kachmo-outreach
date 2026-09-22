import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { makeGuarded } from './action-guard-core';

/**
 * `guarded(run)` — every server action's outer wrapper (audit C5). The logic and its messages live in
 * `action-guard-core.ts`; this binds them to Next's `unstable_rethrow`, so a redirect or notFound from inside an
 * action passes through untouched. The permission check stays inside each action as `requirePermission(...)`, where
 * the tests look for it.
 */
export const guarded = makeGuarded(unstable_rethrow);

export { isUuid, SIGNED_OUT_MESSAGE, NOT_PERMITTED_MESSAGE, UNCONFIRMED_MESSAGE } from './action-guard-core';
