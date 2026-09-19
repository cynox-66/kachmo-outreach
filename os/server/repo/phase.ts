/**
 * WHICH STORE IS CANONICAL RIGHT NOW.
 *
 * ADR-009 makes the cutover phase an explicit recorded decision, never something inferred from whether a database
 * happens to be reachable. This module is where the application reads that decision.
 *
 * The default is PRE_CUTOVER. A deployment that forgets to declare a phase therefore treats the committed JSON
 * store as canonical and itself as read-only — the safe direction.
 */
import { CUTOVER_PHASES, PHASES, type CutoverPhase } from '@kachmo/core/reconciliation/ownership.js';

export const DEFAULT_PHASE: CutoverPhase = 'PRE_CUTOVER';

export function resolveCutoverPhase(env: Record<string, string | undefined> = process.env): CutoverPhase {
  const declared = env.KACHMO_CUTOVER_PHASE?.trim();
  if (!declared) return DEFAULT_PHASE;
  return (CUTOVER_PHASES as readonly string[]).includes(declared) ? (declared as CutoverPhase) : DEFAULT_PHASE;
}

/** True when the application may accept lead writes at all. False in PRE_CUTOVER and during the cutover window. */
export function leadWritesEnabled(phase: CutoverPhase): boolean {
  return PHASES[phase].writableStores.includes('POSTGRES');
}

/**
 * THE APPLICATION WRITE KILL SWITCH (ADR-027).
 *
 * `os/.env.local` points a local `next dev` at the production database, so the moment the app can write leads, any
 * developer machine becomes a production writer. Writes are therefore OFF unless `KACHMO_APP_WRITES=on` is set
 * explicitly in the one environment the owner designates. Anything else — unset, empty, "true", "yes" — is off.
 * It is also the instant rollback lever: turning it off stops every application write without touching data.
 */
export function appWritesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.KACHMO_APP_WRITES?.trim() === 'on';
}

/** The host of DATABASE_URL, or null when it is absent or unparseable. */
export function databaseHost(env: Record<string, string | undefined> = process.env): string | null {
  try {
    return env.DATABASE_URL ? new URL(env.DATABASE_URL).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Why the application refuses to write right now, or null when it may. Every condition must hold:
 *
 *   1. Postgres is canonical (POST_CUTOVER);
 *   2. KACHMO_APP_WRITES is exactly "on";
 *   3. the target is either a loopback database (a local test database — never production), OR the app is running
 *      as a production build (NODE_ENV=production) AND KACHMO_APP_WRITES_HOST names exactly the DATABASE_URL host.
 *
 * Condition 3 is what stops an accidental production writer: `os/.env.local` points `next dev` at the production
 * database, and `next dev` always runs with NODE_ENV=development, so a development server can never write to a
 * non-loopback database no matter what else is set. A production build must still name the exact host it is allowed
 * to write, so a stray switch copied into another environment's settings writes nowhere.
 */
export function writeRefusal(env: Record<string, string | undefined> = process.env): string | null {
  const phase = resolveCutoverPhase(env);
  if (!leadWritesEnabled(phase)) return `The application accepts no lead writes in ${phase}; the canonical store is not Postgres.`;
  if (!appWritesEnabled(env)) return 'Application writes are switched off (KACHMO_APP_WRITES is not "on"). Nothing was written.';
  const host = databaseHost(env);
  if (!host) return 'Application writes are refused: DATABASE_URL is missing or unreadable, so the write target cannot be verified.';
  if (LOOPBACK.has(host)) return null;
  if (env.NODE_ENV !== 'production') {
    return `Application writes are refused: this is not a production build (NODE_ENV=${env.NODE_ENV ?? 'unset'}) and ${host} is not a local database. A development server never writes to a hosted database.`;
  }
  if (env.KACHMO_APP_WRITES_HOST?.trim().toLowerCase() !== host) {
    return `Application writes are refused: KACHMO_APP_WRITES_HOST must name exactly the database host this deployment may write (${host}).`;
  }
  return null;
}

/** A one-line, honest statement of what the app is currently doing, shown in the UI rather than hidden. */
export function phaseBanner(phase: CutoverPhase): { level: 'info' | 'warn'; title: string; detail: string } {
  switch (phase) {
    case 'PRE_CUTOVER':
      return {
        level: 'info',
        title: 'Read-only: the committed JSON store is canonical',
        detail:
          'Leads are read from database/kachmo_leads.json, which the CLI still writes. The hosted database holds no lead data. ' +
          'Record changes with the CLI until the migration is approved and run.',
      };
    case 'CUTOVER_WINDOW':
      return {
        level: 'warn',
        title: 'Cutover in progress — nothing accepts lead writes',
        detail: 'Both stores are being reconciled. The CLI is frozen and this app is read-only, so no drift can appear mid-comparison.',
      };
    case 'POST_CUTOVER':
      return {
        level: 'info',
        title: 'Postgres is canonical',
        detail: 'The JSON store is frozen evidence and is never written again. Email send state still belongs to Titan.',
      };
  }
}

export type { CutoverPhase };
