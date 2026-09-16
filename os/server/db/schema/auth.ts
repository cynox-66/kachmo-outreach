import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, boolean, integer, bigint, index, primaryKey, check } from 'drizzle-orm/pg-core';

/**
 * Better Auth core tables (user, session, account, verification) in the layout its Drizzle adapter expects, plus
 * Kachmo's own role assignments. Users are never deleted: access is removed with `deactivated_at` and role revocation,
 * so audit history always resolves to a real account.
 */
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').$onUpdate(() => new Date()).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  },
  t => [index('session_user_id_idx').on(t.userId)]
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').$onUpdate(() => new Date()).notNull(),
  },
  t => [index('account_user_id_idx').on(t.userId)]
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  t => [index('verification_identifier_idx').on(t.identifier)]
);

/**
 * Better Auth's database-backed rate-limit counters (sign-in and other auth endpoints). Stored in Postgres rather than
 * memory so limits hold across serverless instances.
 */
export const rateLimit = pgTable('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

/** Kept in sync with os/server/authz/permissions.ts (asserted by tests). */
export const ROLE_VALUES = ['OWNER', 'ADMIN', 'RESEARCHER', 'OUTREACH', 'INTERN', 'VIEWER'] as const;

/** Roles are read from here on every request — never from anything the client sends. */
export const userRole = pgTable(
  'user_role',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'restrict' }),
    role: text('role').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
    grantedByUserId: text('granted_by_user_id'),
  },
  t => [
    primaryKey({ columns: [t.userId, t.role] }),
    check('user_role_role_check', sql`${t.role} in ('OWNER', 'ADMIN', 'RESEARCHER', 'OUTREACH', 'INTERN', 'VIEWER')`),
  ]
);
