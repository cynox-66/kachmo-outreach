import type { KachmoLead, SuppressionEntry } from '@kachmo/core/leads/schema.js';
import { parseTrackerContent, scheduledQueueFromJson } from '@kachmo/core/email-ledger/tracker.js';
import { findEmailQueueIssues } from '@kachmo/core/email-ledger/queue-check.js';

/**
 * THE DISPATCH PREFLIGHT RULE — pure, and the single definition.
 *
 * CI runs it (through `dispatch-preflight.ts`, inside `suppression:verify`) immediately before the Titan dispatcher, and
 * the application runs the very same function to tell an operator, in advance, whether the next dispatch would be
 * refused (ADR-036). It lives in its own module so the application can use it without importing the publisher CLI.
 *
 * Every entry in scheduled-queue.json is evaluated with the same outreachBlock() every other channel uses — against the
 * Postgres lead, the active Postgres suppression and the Titan ledger — and ANY blocking finding refuses the WHOLE run.
 * Output carries kinds and target numbers only, never recipient addresses.
 */

export interface PreflightFinding {
  kind: string;
  target_number: string;
}

export interface PreflightResult {
  ok: boolean;
  queued: number;
  findings: PreflightFinding[];
  reason: string;
}

export interface PreflightInput {
  /** scheduled-queue.json bytes, or null when absent (the dispatcher treats absent as empty). */
  queueRaw: string | null;
  /** OUTREACH_TRACKER.md bytes, or null when absent. */
  trackerRaw: string | null;
  /** Canonical leads, or null when Postgres could not be read. */
  leads: KachmoLead[] | null;
  /** ACTIVE canonical suppression, or null when Postgres could not be read. */
  activeSuppression: SuppressionEntry[] | null;
}

const refuse = (queued: number, reason: string, findings: PreflightFinding[] = []): PreflightResult => ({ ok: false, queued, findings, reason });

/** Pure: decides whether the queue may be dispatched. Anything short of a clean queue refuses. */
export function evaluateDispatchPreflight(input: PreflightInput): PreflightResult {
  if (input.leads === null || input.activeSuppression === null) return refuse(0, 'canonical leads or suppression could not be read from Postgres');
  if (input.queueRaw === null) return { ok: true, queued: 0, findings: [], reason: 'no scheduled-queue.json; the dispatcher has nothing to send' };

  let scheduled;
  try {
    scheduled = scheduledQueueFromJson(JSON.parse(input.queueRaw), 'scheduled-queue.json');
  } catch (e) {
    return refuse(0, `scheduled-queue.json is malformed: ${(e as Error).message}`);
  }
  if (scheduled.length === 0) return { ok: true, queued: 0, findings: [], reason: 'the scheduled queue is empty' };
  if (input.trackerRaw === null) return refuse(scheduled.length, 'OUTREACH_TRACKER.md is missing; duplicate sends cannot be ruled out');

  const tracker = parseTrackerContent(input.trackerRaw);
  if (tracker.size === 0) return refuse(scheduled.length, 'OUTREACH_TRACKER.md has no rows; duplicate sends cannot be ruled out');

  // UNKNOWN_TARGET is advisory on the dashboard, but here it is a refusal: without the Postgres lead, lead_id/phone
  // suppression and lead status cannot be checked, and the dispatcher cannot check them either.
  const findings: PreflightFinding[] = findEmailQueueIssues(scheduled, input.leads, input.activeSuppression, tracker)
    .filter(i => i.blocking || i.kind === 'UNKNOWN_TARGET')
    .map(i => ({ kind: i.kind, target_number: i.target_number }));

  // The dispatcher records a send by rewriting SCHEDULED|DRAFTED to SENT in the target's ledger row, and recognises
  // a prior send only as a bold **SENT**. A queued target without exactly that row would be sent without being
  // durably marked, so a later run could send it again.
  const lines = input.trackerRaw.split('\n');
  for (const s of scheduled) {
    const rows = lines.filter(l => l.includes(`| **${s.targetNumber}** |`));
    if (rows.length === 0) findings.push({ kind: 'NOT_IN_LEDGER', target_number: s.targetNumber });
    else if (!rows.every(l => /\*\*(SCHEDULED|DRAFTED)\*\*/.test(l))) findings.push({ kind: 'LEDGER_NOT_SENDABLE', target_number: s.targetNumber });
  }
  if (findings.length) return refuse(scheduled.length, `${findings.length} queued entr(y/ies) must not be sent`, findings);
  return { ok: true, queued: scheduled.length, findings: [], reason: `all ${scheduled.length} queued entr(y/ies) are clear against Postgres leads, active suppression and the Titan ledger` };
}
