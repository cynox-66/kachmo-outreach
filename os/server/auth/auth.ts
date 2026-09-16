import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema/index.js';

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Security policy for authentication. Changing any value here is a security decision; tests pin it. */
export const AUTH_POLICY = {
  cookiePrefix: 'kachmo',
  minPasswordLength: 12,
  maxPasswordLength: 128,
  sessionExpiresInSeconds: 60 * 60 * 12, // 12 hours
  sessionUpdateAgeSeconds: 60 * 60, // sliding refresh at most hourly
  rateLimit: {
    global: { window: 60, max: 100 },
    signIn: { window: 15 * 60, max: 5 },
    passwordResetRequest: { window: 60 * 60, max: 3 },
  },
} as const;

export interface AuthConfig {
  /** BETTER_AUTH_SECRET: at least 32 characters. */
  secret: string;
  /** BETTER_AUTH_URL: this deployment's base URL; also the only trusted origin. */
  baseURL: string;
  /** true in production (HTTPS): Secure + __Secure- prefixed cookies. */
  secureCookies: boolean;
  /** true only inside Next.js (sets cookies from server actions). */
  nextCookies: boolean;
}

export class AuthConfigError extends Error {}

/**
 * Better Auth configured for a private, invite-only internal system.
 * - No public sign-up: accounts are created by the owner bootstrap or by a user manager (users.manage).
 * - No email-based password reset: this application never sends email (Titan owns email). Owners reset passwords.
 * - Sessions live in Postgres; cookies are HttpOnly, SameSite=Lax, Secure in production; origin/CSRF checks stay on.
 * - Database-backed rate limits hold across serverless instances.
 * - Deactivated users cannot create sessions.
 */
export function createAuth(db: Db, config: AuthConfig) {
  if (!config.secret || config.secret.length < 32) throw new AuthConfigError('BETTER_AUTH_SECRET must be at least 32 characters.');
  let origin: string;
  try {
    origin = new URL(config.baseURL).origin;
  } catch {
    throw new AuthConfigError('BETTER_AUTH_URL must be a valid absolute URL.');
  }

  return betterAuth({
    appName: 'Kachmo Outbound OS',
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: [origin],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification, rateLimit: schema.rateLimit },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      requireEmailVerification: false,
      minPasswordLength: AUTH_POLICY.minPasswordLength,
      maxPasswordLength: AUTH_POLICY.maxPasswordLength,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: AUTH_POLICY.sessionExpiresInSeconds,
      updateAge: AUTH_POLICY.sessionUpdateAgeSeconds,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: AUTH_POLICY.rateLimit.global.window,
      max: AUTH_POLICY.rateLimit.global.max,
      customRules: {
        '/sign-in/email': AUTH_POLICY.rateLimit.signIn,
        '/sign-up/email': AUTH_POLICY.rateLimit.signIn,
        '/request-password-reset': AUTH_POLICY.rateLimit.passwordResetRequest,
      },
    },
    advanced: {
      cookiePrefix: AUTH_POLICY.cookiePrefix,
      useSecureCookies: config.secureCookies,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: config.secureCookies },
      disableCSRFCheck: false,
      disableOriginCheck: false,
    },
    databaseHooks: {
      session: {
        create: {
          before: async session => {
            const [u] = await db.select({ deactivatedAt: schema.user.deactivatedAt }).from(schema.user).where(eq(schema.user.id, session.userId));
            if (!u || u.deactivatedAt) throw new APIError('FORBIDDEN', { message: 'This account is deactivated.' });
          },
        },
      },
    },
    plugins: config.nextCookies ? [nextCookies()] : [],
  });
}

export type Auth = ReturnType<typeof createAuth>;
