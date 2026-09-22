import { AuthenticationRequiredError, AuthorizationError } from '../authz/authorize';

/**
 * Server actions never throw at an operator (audit C5) — the logic, free of any framework import so it can be tested
 * directly. `action-guard.ts` binds it to Next's own `unstable_rethrow`.
 *
 * A thrown server action replaces the whole page with an error screen and discards what the person typed. The three
 * things that can go wrong outside the domain rules are turned into a message the form shows instead, each one honest
 * about whether anything was saved:
 *
 *   - the session ended while the page was open  → nothing was saved; sign in again
 *   - the role does not allow it                  → nothing was saved
 *   - the database (or anything else) failed      → we cannot be sure: reload and check before retrying. A failure
 *                                                   during COMMIT leaves the outcome unknown, and the version guard
 *                                                   makes a retry after reloading safe.
 *
 * Next's own control flow (redirect, notFound) is re-thrown untouched by `rethrow`.
 */
export const SIGNED_OUT_MESSAGE = 'You have been signed out, so nothing was saved. Sign in again in another tab, then submit this again — your text is still here.';
export const NOT_PERMITTED_MESSAGE = 'Your role cannot do this, so nothing was saved.';
export const UNCONFIRMED_MESSAGE = 'The database did not confirm this. Reload the page to see whether it was saved before trying again.';

export function makeGuarded(rethrow: (error: unknown) => void) {
  return async function guarded<S extends { error: string | null }>(run: () => Promise<S>): Promise<S> {
    try {
      return await run();
    } catch (e) {
      rethrow(e);
      if (e instanceof AuthenticationRequiredError) return { error: SIGNED_OUT_MESSAGE } as S;
      if (e instanceof AuthorizationError) return { error: NOT_PERMITTED_MESSAGE } as S;
      // The operator gets a plain message; the detail goes to the server log, where the owner can find it.
      console.error('[kachmo] server action failed:', e instanceof Error ? e.message : e);
      return { error: UNCONFIRMED_MESSAGE } as S;
    }
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID. Checked before any query, so a malformed id is a clean refusal, never a database error. */
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v.trim());
