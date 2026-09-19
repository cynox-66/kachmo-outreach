/**
 * `npm --prefix os run actor:bind -- --user=<email> --as=DEV|AADI --actor="<owner name>"`
 * `npm --prefix os run actor:bind -- --user=<email> --revoke --actor="<owner name>"`
 *
 * Binds an application user to the core engine actor they write leads as (ADR-021). An owner decision, made from the
 * command line like every other identity change in this system; audited. Without a binding a user cannot write.
 */
import { openOperatorDatabase } from './operator-db';
import { bindEngineActor, revokeEngineActor, isEngineActor } from './actor-binding';

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const user = arg('user') ?? '';
const as = (arg('as') ?? '').toUpperCase();
const actor = arg('actor') ?? '';
const revoke = process.argv.includes('--revoke');

if (!user || !actor || (!revoke && !isEngineActor(as))) {
  console.error('Usage: actor:bind -- --user=<email> (--as=DEV|AADI | --revoke) --actor="<owner name>"');
  process.exit(2);
}

const { db, close, label } = openOperatorDatabase();
(async () => {
  console.log(`\n🪪 Engine-actor binding — target ${label}`);
  if (revoke) {
    const done = await revokeEngineActor(db, user, actor);
    console.log(done ? `   ✅ binding revoked for ${user}; they can no longer write leads` : `   ${user} had no active binding; nothing changed`);
    return;
  }
  const r = await bindEngineActor(db, { userEmail: user, engineActor: as as 'DEV' | 'AADI', ownerLabel: actor });
  console.log(r.changed ? `   ✅ ${user} now writes as ${as}${r.previous ? ` (was ${r.previous})` : ''}` : `   ${user} is already bound to ${as}; nothing changed`);
})()
  .then(() => close().then(() => process.exit(0)))
  .catch(err => {
    console.error(`\n❌ ${(err as Error).message}`);
    close().finally(() => process.exit(1));
  });
