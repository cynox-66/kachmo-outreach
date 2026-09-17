import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { CUTOVER_PHASES, type CutoverPhase } from '../../core/reconciliation/ownership.js';

/**
 * WHETHER THE LEGACY JSON STORE IS STILL WRITABLE.
 *
 * ADR-009 makes the cutover phase an explicit RECORDED decision. The hosted app reads that decision from its
 * environment, but a CLI run from the repository root never sees `os/.env.local`, so an environment-only signal
 * would be invisible to exactly the commands this guard exists to stop.
 *
 * The decision is therefore recorded in a file beside the store it governs, and committed. Two consequences,
 * both deliberate:
 *
 *   - The marker travels WITH the store. A throwaway workspace (a test fixture, a snapshot of an old commit) has
 *     no marker, so it is pre-cutover and writable — which is correct: it is not the canonical store.
 *   - The decision is auditable in git history rather than in somebody's shell.
 *
 * `KACHMO_CUTOVER_PHASE` is still honoured. Where the two disagree, the MORE ADVANCED phase wins: a guard whose
 * answer depends on which signal you happened to read is not a guard.
 */

export const CUTOVER_STATE_FILE = 'database/CUTOVER_STATE.json';

export interface CutoverState {
  phase: CutoverPhase;
  declaredAt: string;
  /** The commit the production migration ran from, so the frozen store can be tied to what was migrated. */
  migrationCommit: string | null;
  note: string;
}

const ORDER: Record<CutoverPhase, number> = { PRE_CUTOVER: 0, CUTOVER_WINDOW: 1, POST_CUTOVER: 2 };
const isPhase = (v: unknown): v is CutoverPhase => typeof v === 'string' && (CUTOVER_PHASES as readonly string[]).includes(v);

/** Reads the recorded decision, relative to the working directory the store itself is resolved from. */
export function readCutoverState(cwd: string = process.cwd()): CutoverState | null {
  const file = resolve(cwd, CUTOVER_STATE_FILE);
  if (!existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    // An unreadable marker is treated as the most advanced phase: the one answer that cannot cause a wrong write.
    return { phase: 'POST_CUTOVER', declaredAt: '', migrationCommit: null, note: `${CUTOVER_STATE_FILE} is unreadable; treating the store as frozen.` };
  }
  const state = parsed as Partial<CutoverState>;
  if (!isPhase(state.phase)) {
    return { phase: 'POST_CUTOVER', declaredAt: '', migrationCommit: null, note: `${CUTOVER_STATE_FILE} declares no recognised phase; treating the store as frozen.` };
  }
  return { phase: state.phase, declaredAt: state.declaredAt ?? '', migrationCommit: state.migrationCommit ?? null, note: state.note ?? '' };
}

/** The effective phase for the CLI: the more advanced of the recorded decision and the environment. */
export function effectiveCutoverPhase(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): CutoverPhase {
  const fromFile = readCutoverState(cwd)?.phase ?? 'PRE_CUTOVER';
  const declared = env.KACHMO_CUTOVER_PHASE?.trim();
  const fromEnv: CutoverPhase = isPhase(declared) ? declared : 'PRE_CUTOVER';
  return ORDER[fromEnv] > ORDER[fromFile] ? fromEnv : fromFile;
}

export const legacyJsonWritesFrozen = (cwd?: string, env?: NodeJS.ProcessEnv): boolean => effectiveCutoverPhase(cwd, env) === 'POST_CUTOVER';

export class LegacyStoreFrozenError extends Error {
  constructor(public readonly operation: string, state: CutoverState | null) {
    super(
      `Postgres is canonical: the legacy JSON writer is disabled after cutover.\n` +
        `  Refused: ${operation}\n` +
        `  Phase:   POST_CUTOVER${state?.declaredAt ? ` (declared ${state.declaredAt})` : ''}` +
        `${state?.migrationCommit ? `, migrated from ${state.migrationCommit.slice(0, 12)}` : ''}\n` +
        `  ${CUTOVER_STATE_FILE} records this decision. database/kachmo_leads.json, database/suppression.json and\n` +
        `  analytics/events.jsonl are now frozen evidence of what was migrated; writing them would make the two\n` +
        `  stores disagree, and nothing reconciles them afterwards.\n` +
        `  This command has NOT been redirected to Postgres — it is a legacy writer with no hosted equivalent yet.\n` +
        `  To edit a lead, use the hosted application. To undo the cutover deliberately, change the phase in\n` +
        `  ${CUTOVER_STATE_FILE} and reconcile the two stores by hand before writing anything.`
    );
    this.name = 'LegacyStoreFrozenError';
  }
}

/** Throws when the legacy JSON store may no longer be written. Call at the top of every canonical writer. */
export function assertLegacyStoreWritable(operation: string, cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): void {
  if (effectiveCutoverPhase(cwd, env) !== 'POST_CUTOVER') return;
  throw new LegacyStoreFrozenError(operation, readCutoverState(cwd));
}

let warned = false;

/**
 * One warning per process when a read-only command is deriving output from the frozen store. The output is not
 * wrong today — the two stores are identical — but it is no longer the canonical source, and an operator acting
 * on a queue generated from frozen data should know that.
 */
export function warnIfReadingFrozenStore(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): void {
  if (warned || effectiveCutoverPhase(cwd, env) !== 'POST_CUTOVER') return;
  warned = true;
  console.warn(
    `⚠️  Postgres is canonical (POST_CUTOVER). This command is reading the FROZEN JSON store, so anything it\n` +
      `   derives reflects the data as migrated, not the live database. Prefer the hosted application.`
  );
}
