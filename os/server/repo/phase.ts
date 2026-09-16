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
