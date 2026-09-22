import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServer } from './instance';
import { loadActor, assertPermission, AuthorizationError, type Actor } from '../authz/authorize';
import type { Permission } from '../authz/permissions';
import { recordAudit } from '../audit/audit';

/**
 * Server-side identity for the current request. The session is validated by Better Auth against the database on
 * every call (cookie cache disabled), and roles are read from `user_role` — nothing the browser sends is trusted.
 */
export const getCurrentActor = cache(async (): Promise<Actor | null> => {
  // Cached per request only (React `cache`): the layout and the page resolve the same session once, and every new
  // request — every server action included — validates the session against the database afresh.
  const { auth, db } = getServer();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return loadActor(db, session.user.id);
});

/** For pages and layouts: unauthenticated visitors are sent to the login page. */
export async function requireActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect('/login');
  return actor;
}

/**
 * For every server action, route handler and data loader that touches protected data. Denials are audited.
 * Hidden UI is never a substitute for calling this.
 */
export async function requirePermission(permission: Permission): Promise<Actor> {
  const actor = await getCurrentActor();
  try {
    assertPermission(actor, permission);
  } catch (err) {
    if (err instanceof AuthorizationError && actor) {
      await recordAudit(getServer().db, { actor: { userId: actor.userId, label: actor.name }, action: 'authz.denied', target: { type: 'permission', id: permission } });
    }
    throw err;
  }
  return actor;
}
