import 'server-only';
import { getServer } from '../auth/instance';
import type { Actor } from '../authz/authorize';
import { writeRefusal, resolveCutoverPhase } from '../repo/phase';
import { activeEngineActor, type EngineActor } from '../leads/actor-binding';

/**
 * Whether THIS actor can record operator actions right now, and if not, why — so a page can say so plainly
 * instead of offering a form that will only be refused. Presentation only: every write re-checks all of it.
 */
export interface WriteStatus {
  /** True only when the app may write AND the actor is bound to an engine actor. */
  canWrite: boolean;
  /** Why not, in operator language. Null when writes are possible. */
  reason: string | null;
  engineActor: EngineActor | null;
  phase: string;
}

export async function writeStatusFor(actor: Actor): Promise<WriteStatus> {
  const phase = resolveCutoverPhase();
  const refused = writeRefusal();
  if (refused) return { canWrite: false, reason: refused, engineActor: null, phase };
  const engineActor = await activeEngineActor(getServer().db, actor.userId);
  if (!engineActor) {
    return { canWrite: false, reason: 'Your account is not bound to an engine actor (DEV or AADI), so it cannot record changes. Ask an owner to bind it.', engineActor: null, phase };
  }
  return { canWrite: true, reason: null, engineActor, phase };
}
