/**
 * FIRST-OWNER BOOTSTRAP. `npm run owner:bootstrap`
 *
 * Creates the first OWNER account for a fresh deployment. No credentials live in source code or in environment
 * variables: the email and name come from KACHMO_BOOTSTRAP_OWNER_EMAIL / KACHMO_BOOTSTRAP_OWNER_NAME, and the password
 * is typed interactively (hidden, twice) or piped on stdin. The password is never printed or logged.
 *
 * Refuses when any OWNER already exists, so it cannot be used to add an owner to a live system — further users are
 * created by an owner through the application (users.manage), with an audit trail.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { count, eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema/index.js';
import { recordAudit } from '../audit/audit.js';
import { AUTH_POLICY, createAuth, type Auth } from './auth.js';

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export class BootstrapRefusedError extends Error {}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function bootstrapOwner(db: Db, auth: Auth, input: { email: string; name: string; password: string }): Promise<{ userId: string }> {
  const email = input.email?.trim().toLowerCase();
  const name = input.name?.trim();
  const password = input.password ?? '';
  if (!email || !EMAIL.test(email)) throw new BootstrapRefusedError('A valid owner email is required.');
  if (!name) throw new BootstrapRefusedError('An owner name is required.');
  if (password.length < AUTH_POLICY.minPasswordLength || password.length > AUTH_POLICY.maxPasswordLength) {
    throw new BootstrapRefusedError(`The password must be ${AUTH_POLICY.minPasswordLength}–${AUTH_POLICY.maxPasswordLength} characters.`);
  }
  if (password.toLowerCase().includes(email.split('@')[0])) throw new BootstrapRefusedError('The password must not contain the email name.');

  const [{ owners }] = await db.select({ owners: count() }).from(schema.userRole).where(eq(schema.userRole.role, 'OWNER'));
  if (owners > 0) throw new BootstrapRefusedError('An OWNER already exists. Bootstrap only initialises a new deployment; add users from inside the application.');
  const [existing] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email));
  if (existing) throw new BootstrapRefusedError('A user with this email already exists.');

  const ctx = await auth.$context;
  // `admin` provisioning: created by an operator, not by a public sign-up flow.
  const user = await ctx.internalAdapter.createUser({ email, name, emailVerified: true }, { method: 'admin' });
  const hash = await ctx.password.hash(password);
  await ctx.internalAdapter.linkAccount({ providerId: 'credential', accountId: user.id, userId: user.id, password: hash });
  await db.insert(schema.userRole).values({ userId: user.id, role: 'OWNER', grantedByUserId: null });
  await recordAudit(db, { actor: { userId: null, label: 'BOOTSTRAP' }, action: 'user.bootstrap_owner', target: { type: 'user', id: user.id }, metadata: { role: 'OWNER' } });
  return { userId: user.id };
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf-8').replace(/\r?\n$/, '');
  }
  const ask = (prompt: string) =>
    new Promise<string>((res, rej) => {
      process.stdout.write(prompt);
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      let value = '';
      const onData = (buf: Buffer) => {
        for (const ch of buf.toString('utf-8')) {
          if (ch === '\r' || ch === '\n') {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.off('data', onData);
            process.stdout.write('\n');
            return res(value);
          }
          if (ch === '') {
            stdin.setRawMode(false);
            return rej(new Error('Cancelled.'));
          }
          value = ch === '' ? value.slice(0, -1) : value + ch;
        }
      };
      stdin.on('data', onData);
    });
  const first = await ask('Owner password (hidden): ');
  const second = await ask('Repeat password: ');
  if (first !== second) throw new Error('The passwords do not match.');
  return first;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    const { createDatabase } = await import('../db/client.js');
    const { db, pool } = createDatabase(process.env.DATABASE_URL ?? '');
    try {
      const auth = createAuth(db, { secret: process.env.BETTER_AUTH_SECRET ?? '', baseURL: process.env.BETTER_AUTH_URL ?? '', secureCookies: true, nextCookies: false });
      const password = await readPassword();
      const { userId } = await bootstrapOwner(db, auth, { email: process.env.KACHMO_BOOTSTRAP_OWNER_EMAIL ?? '', name: process.env.KACHMO_BOOTSTRAP_OWNER_NAME ?? '', password });
      console.log(`✅ First OWNER created (user id ${userId}). Remove KACHMO_BOOTSTRAP_OWNER_* from the environment now.`);
    } finally {
      await pool.end();
    }
  })().catch(err => {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  });
}
