import { eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema/index';
import { isRole, permissionsFor, type Permission, type Role } from './permissions';

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export class AuthenticationRequiredError extends Error {
  constructor() {
    super('Authentication required.');
  }
}

export class AuthorizationError extends Error {
  constructor(public readonly permission: Permission) {
    super(`Not permitted: ${permission}`);
  }
}

/** The authenticated person performing a request, with roles and permissions resolved from the database. */
export interface Actor {
  userId: string;
  name: string;
  email: string;
  roles: Role[];
  permissions: ReadonlySet<Permission>;
}

/**
 * Loads the actor for a verified session's user id. Returns null for unknown or deactivated users.
 * Roles come only from `user_role`; a user with no roles has no permissions (deny by default).
 */
export async function loadActor(db: Db, userId: string): Promise<Actor | null> {
  const [u] = await db
    .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, deactivatedAt: schema.user.deactivatedAt })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  if (!u || u.deactivatedAt) return null;
  const rows = await db.select({ role: schema.userRole.role }).from(schema.userRole).where(eq(schema.userRole.userId, userId));
  const roles = rows.map(r => r.role).filter(isRole);
  return { userId: u.id, name: u.name, email: u.email, roles, permissions: permissionsFor(roles) };
}

/** Throws unless the actor exists and holds the permission. Call inside every server action and route handler. */
export function assertPermission(actor: Actor | null, permission: Permission): asserts actor is Actor {
  if (!actor) throw new AuthenticationRequiredError();
  if (!actor.permissions.has(permission)) throw new AuthorizationError(permission);
}
