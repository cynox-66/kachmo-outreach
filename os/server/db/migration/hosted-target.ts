/**
 * HOSTED REHEARSAL AUTHORISATION — pure, so every refusal is testable without a database.
 *
 * `npm run db:rehearse` stays PGlite-only and needs no authorisation at all. Running a rehearsal against a REAL
 * hosted Postgres is a different act, and this module is the gate.
 *
 * The central rule: **the presence of DATABASE_URL is not authorisation.** A developer whose shell happens to hold
 * a connection string must not be able to point a rehearsal at it by accident. Authorisation requires naming the
 * exact host AND acknowledging that the target is disposable.
 */

export const DISPOSABLE_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_IS_DISPOSABLE' as const;

export type HostedRefusalCode =
  | 'NO_DATABASE_URL'
  | 'MALFORMED_DATABASE_URL'
  | 'NO_CONFIRMATION'
  | 'WRONG_CONFIRMATION'
  | 'NO_DISPOSABLE_ACKNOWLEDGEMENT'
  | 'NO_DISPOSABLE_PROJECT'
  | 'PROJECT_LOOKS_LIKE_PRODUCTION'
  | 'TARGET_ON_PRODUCTION_DENYLIST'
  | 'TARGET_LOOKS_LIKE_PRODUCTION';

export interface HostedAuthorization {
  authorized: boolean;
  code: HostedRefusalCode | null;
  /** Safe to print and to log: host only, never the credentials. */
  host: string | null;
  database: string | null;
  /** The throwaway project the operator named, recorded so the cleanup obligation is auditable. */
  project: string | null;
  message: string;
}

/**
 * Host or database names that must never be a rehearsal target. A rehearsal imports 120 real leads and then
 * deliberately provokes constraint failures; doing that against production would be catastrophic.
 *
 * This is a backstop, not the primary control — the primary control is that the operator must name the host
 * explicitly. It exists because a typo in a branch name is more likely than a typo in the word "production".
 */
const PRODUCTION_MARKERS = [/(^|[-_.])prod(uction)?([-_.]|$)/i, /(^|[-_.])live([-_.]|$)/i, /(^|[-_.])main([-_.]|$)/i];

const looksLikeProduction = (value: string): boolean => PRODUCTION_MARKERS.some(re => re.test(value));

/**
 * Hosts that must NEVER be a rehearsal target, however the environment is configured.
 *
 * This is the one check no acknowledgement can satisfy: the markers above are a heuristic over names, but a real
 * production endpoint should be refused by identity. Populate KACHMO_PRODUCTION_HOSTS with the real hosts once they
 * exist, and this gate stops depending on anybody spelling "production" in a branch name.
 */
function denylistedHosts(env: HostedEnvironment): string[] {
  return (env.KACHMO_PRODUCTION_HOSTS ?? '')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);
}

/** Only the three variables that matter are read; anything else in the environment is ignored. */
export type HostedEnvironment = Record<string, string | undefined>;

/**
 * Decides whether a hosted rehearsal may proceed. Fails closed on every missing or mismatched precondition and
 * never includes the connection string (or any credential) in its message.
 */
export function authorizeHostedRehearsal(env: HostedEnvironment): HostedAuthorization {
  const deny = (code: HostedRefusalCode, message: string, host: string | null = null, database: string | null = null): HostedAuthorization => ({
    authorized: false,
    code,
    host,
    database,
    project: null,
    message,
  });

  const url = env.DATABASE_URL?.trim();
  if (!url) {
    return deny('NO_DATABASE_URL', 'DATABASE_URL is not set. A hosted rehearsal needs a disposable database to run against.');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return deny('MALFORMED_DATABASE_URL', 'DATABASE_URL is not a valid URL. Nothing was contacted.');
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol) || !parsed.hostname) {
    return deny('MALFORMED_DATABASE_URL', 'DATABASE_URL is not a PostgreSQL connection string. Nothing was contacted.');
  }

  const host = parsed.hostname;
  const database = parsed.pathname.replace(/^\//, '') || null;

  const confirmation = env.KACHMO_REHEARSE_CONFIRM_HOST?.trim();
  if (!confirmation) {
    return deny(
      'NO_CONFIRMATION',
      `Refusing to rehearse against a hosted database: set KACHMO_REHEARSE_CONFIRM_HOST=${host} to confirm this exact target.`,
      host,
      database
    );
  }
  if (confirmation !== host) {
    return deny(
      'WRONG_CONFIRMATION',
      `Refusing to rehearse: KACHMO_REHEARSE_CONFIRM_HOST does not match the host in DATABASE_URL. Expected ${host}.`,
      host,
      database
    );
  }

  const disposable = env.KACHMO_REHEARSE_DISPOSABLE?.trim();
  if (disposable !== DISPOSABLE_ACKNOWLEDGEMENT) {
    return deny(
      'NO_DISPOSABLE_ACKNOWLEDGEMENT',
      `Refusing to rehearse: a rehearsal imports real leads and then deliberately provokes failures, so the target must be throwaway. ` +
        `Set KACHMO_REHEARSE_DISPOSABLE=${DISPOSABLE_ACKNOWLEDGEMENT} once you have confirmed ${host} is disposable.`,
      host,
      database
    );
  }

  // A throwaway PROJECT's primary branch is a legitimate target — it is thrown away with the project. What is not
  // legitimate is leaving "which project gets deleted afterwards" implicit, so the operator must name it.
  const project = env.KACHMO_REHEARSE_PROJECT?.trim();
  if (!project) {
    return deny(
      'NO_DISPOSABLE_PROJECT',
      `Refusing to rehearse: name the throwaway project this target belongs to with KACHMO_REHEARSE_PROJECT. ` +
        `It is recorded in the manifest, so the obligation to destroy it afterwards is written down rather than remembered.`,
      host,
      database
    );
  }
  if (looksLikeProduction(project)) {
    return deny(
      'PROJECT_LOOKS_LIKE_PRODUCTION',
      `Refusing to rehearse: the project named in KACHMO_REHEARSE_PROJECT ("${project}") looks like a production project.`,
      host,
      database
    );
  }

  // Checked last and deliberately un-overridable: no acknowledgement makes a known production host acceptable.
  if (denylistedHosts(env).includes(host.toLowerCase())) {
    return deny(
      'TARGET_ON_PRODUCTION_DENYLIST',
      `Refusing to rehearse against ${host}: it is listed in KACHMO_PRODUCTION_HOSTS. No acknowledgement overrides this.`,
      host,
      database
    );
  }

  if (looksLikeProduction(host) || (database && looksLikeProduction(database))) {
    return deny(
      'TARGET_LOOKS_LIKE_PRODUCTION',
      `Refusing to rehearse against ${host}${database ? `/${database}` : ''}: the name looks like a production target. ` +
        `Rehearse against a disposable project. If this really is disposable, rename it.`,
      host,
      database
    );
  }

  return {
    authorized: true,
    code: null,
    host,
    database,
    project,
    message: `Authorized: ${host}${database ? `/${database}` : ''} in throwaway project "${project}". DESTROY THE PROJECT when the rehearsal finishes.`,
  };
}

/** Redacts a connection string for logging: scheme, host and database only, never user or password. */
export function safeTargetLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.pathname}`;
  } catch {
    return '<unparseable connection string>';
  }
}
