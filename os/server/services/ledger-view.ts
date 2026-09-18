import { EMAIL_SENT_STATUSES } from '@kachmo/core/email-ledger/tracker.js';

/**
 * Some of a lead's stored `next_action` values are derived by the engine from Titan's email ledger
 * (core/leads/opportunity.ts). Titan owns email send state in every phase, so when the live ledger has moved on since
 * the record was written — e.g. the 2026-09-12 webmail sends reconciled DRAFTED → SENT without touching lead
 * records — the stored phrase is stale. Showing "Dev to review and send" for an email already sent invites a
 * duplicate manual send.
 *
 * This only corrects presentation: it maps the engine's own ledger-derived phrases to the phrase the engine uses for
 * a sent email. Any other stored next_action is shown as recorded; no record is modified.
 */
export const LEDGER_NEXT_ACTIONS = {
  SCHEDULED: 'Scheduled in production email queue (GitHub Actions cron)',
  DRAFTED: 'Drafted in Titan — Dev to review and send',
  SENT: 'Watch Titan inbox; follow up on the OUTREACH_TRACKER.md due date',
} as const;

export function presentedNextAction(stored: string | null | undefined, ledgerStatus: string | null): string | null {
  const action = stored ?? null;
  if (!ledgerStatus || !EMAIL_SENT_STATUSES.has(ledgerStatus)) return action;
  return action === LEDGER_NEXT_ACTIONS.DRAFTED || action === LEDGER_NEXT_ACTIONS.SCHEDULED ? LEDGER_NEXT_ACTIONS.SENT : action;
}

/** A stored pre-send stage (DRAFTED/SCHEDULED) is shown as the ledger's status once the ledger records a send. */
export function presentedStage(stage: string, ledgerStatus: string | null): string {
  if (!ledgerStatus || !EMAIL_SENT_STATUSES.has(ledgerStatus)) return stage;
  return stage === 'DRAFTED' || stage === 'SCHEDULED' ? ledgerStatus : stage;
}
