import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '../db/schema/index';
import { recordAudit } from '../audit/audit';
import type { Db } from './locks';

/**
 * ENGINE-ACTOR BINDING (ADR-021).
 *
 * core/'s write decisions record WHO acted as `DEV` or `AADI`. An application user is a named person with roles; the
 * binding says which engine actor that person acts as. It is set by an OWNER, never inferred from a name, and a user
 * with no active binding cannot write a lead. Both the user id and the engine actor are recorded on every write.
 */
export type EngineActor = (typeof schema.ENGINE_ACTOR_VALUES)[number];

export const isEngineActor = (v: unknown): v is EngineActor => typeof v === 'string' && (schema.ENGINE_ACTOR_VALUES as readonly string[]).includes(v);

export class BindingError extends Error {}

/** The user's active engine actor, or null. */
export async function activeEngineActor(db: Db, userId: string): Promise<EngineActor | null> {
  const [row] = await db
    .select({ engineActor: schema.userEngineActor.engineActor })
    .from(schema.userEngineActor)
    .where(and(eq(schema.userEngineActor.userId, userId), isNull(schema.userEngineActor.revokedAt)));
  return row && isEngineActor(row.engineActor) ? row.engineActor : null;
}

/** Throws unless the user has an active binding. The message tells the operator what to ask for. */
export async function requireEngineActor(db: Db, userId: string): Promise<EngineActor> {
  const bound = await activeEngineActor(db, userId);
  if (!bound) {
    throw new BindingError('Your account is not bound to an engine actor (DEV or AADI), so it cannot change leads. Ask an owner to run `npm --prefix os run actor:bind`.');
  }
  return bound;
}

/** Labels an automated identity would use. A binding is made by a named person, so these are refused. */
const NOT_A_PERSON = /^(system|llm|bot|agent|claude|gpt|gemini|automation|cron|bootstrap|migration)\b/i;

export function assertHumanLabel(label: string): void {
  if (!label.trim() || NOT_A_PERSON.test(label.trim())) throw new BindingError(`"${label}" is not a named person. Pass --actor="<your name>".`);
}

export interface BindInput {
  userEmail: string;
  engineActor: EngineActor;
  /** The named owner performing the binding. */
  ownerLabel: string;
}

/**
 * Binds a user to an engine actor, revoking any previous binding in the same transaction. Only a user holding the
 * OWNER role may be named as the binder — checked against the database, not trusted from the caller.
 */
export async function bindEngineActor(db: Db, input: BindInput): Promise<{ userId: string; previous: EngineActor | null; changed: boolean }> {
  assertHumanLabel(input.ownerLabel);
  if (!isEngineActor(input.engineActor)) throw new BindingError(`Engine actor must be one of ${schema.ENGINE_ACTOR_VALUES.join(', ')}.`);

  return db.transaction(async tx => {
    const [user] = await tx.select({ id: schema.user.id, deactivatedAt: schema.user.deactivatedAt }).from(schema.user).where(eq(schema.user.email, input.userEmail.trim().toLowerCase()));
    if (!user) throw new BindingError(`No user with email ${input.userEmail}.`);
    if (user.deactivatedAt) throw new BindingError('That user is deactivated.');

    const owners = await tx.select({ userId: schema.userRole.userId }).from(schema.userRole).where(eq(schema.userRole.role, 'OWNER'));
    if (!owners.length) throw new BindingError('No OWNER exists; bootstrap the owner first.');

    const previous = await activeEngineActor(tx, user.id);
    if (previous === input.engineActor) return { userId: user.id, previous, changed: false };

    if (previous) {
      await tx
        .update(schema.userEngineActor)
        .set({ revokedAt: new Date(), revokedByLabel: input.ownerLabel })
        .where(and(eq(schema.userEngineActor.userId, user.id), isNull(schema.userEngineActor.revokedAt)));
      await recordAudit(tx, {
        actor: { userId: null, label: input.ownerLabel },
        action: 'user.engine_actor_revoked',
        target: { type: 'user', id: user.id },
        metadata: { engineActor: previous, reason: 'rebound' },
      });
    }
    await tx.insert(schema.userEngineActor).values({ userId: user.id, engineActor: input.engineActor, boundByLabel: input.ownerLabel });
    await recordAudit(tx, {
      actor: { userId: null, label: input.ownerLabel },
      action: 'user.engine_actor_bound',
      target: { type: 'user', id: user.id },
      metadata: { engineActor: input.engineActor, previous },
    });
    return { userId: user.id, previous, changed: true };
  });
}

/** Ends a user's binding. The user can no longer write leads until bound again. */
export async function revokeEngineActor(db: Db, userEmail: string, ownerLabel: string): Promise<boolean> {
  assertHumanLabel(ownerLabel);
  return db.transaction(async tx => {
    const [user] = await tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, userEmail.trim().toLowerCase()));
    if (!user) throw new BindingError(`No user with email ${userEmail}.`);
    const previous = await activeEngineActor(tx, user.id);
    if (!previous) return false;
    await tx
      .update(schema.userEngineActor)
      .set({ revokedAt: new Date(), revokedByLabel: ownerLabel })
      .where(and(eq(schema.userEngineActor.userId, user.id), isNull(schema.userEngineActor.revokedAt)));
    await recordAudit(tx, { actor: { userId: null, label: ownerLabel }, action: 'user.engine_actor_revoked', target: { type: 'user', id: user.id }, metadata: { engineActor: previous } });
    return true;
  });
}
