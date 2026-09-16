import 'server-only';
import { createDatabase, type Database } from '../db/client';
import { createAuth, type Auth } from './auth';

/**
 * The application's single database pool and Better Auth instance (Next.js server only — `server-only` makes any
 * client-bundle import a build error). Created lazily so builds do not need runtime secrets.
 */
type Server = { db: Database; auth: Auth };
const globalForServer = globalThis as unknown as { __kachmoServer?: Server };

export function getServer(): Server {
  if (!globalForServer.__kachmoServer) {
    const { db } = createDatabase(process.env.DATABASE_URL ?? '');
    const auth = createAuth(db, {
      secret: process.env.BETTER_AUTH_SECRET ?? '',
      baseURL: process.env.BETTER_AUTH_URL ?? '',
      secureCookies: process.env.NODE_ENV === 'production',
      nextCookies: true,
    });
    globalForServer.__kachmoServer = { db, auth };
  }
  return globalForServer.__kachmoServer;
}
