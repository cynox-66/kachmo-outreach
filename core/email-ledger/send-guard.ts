import type { KachmoLead, SuppressionEntry } from '../leads/schema.js';
import { normalizeEmail, normalizeDomain } from '../contact/provenance.js';
import { outreachBlock } from '../suppression/match.js';
import { EMAIL_SENT_STATUSES, type TrackerRow, type ScheduledEmail } from './tracker.js';

/**
 * Pre-send guard for any direct Titan send (npm run send:titan). Pure: the caller loads the suppression list, lead
 * database, email ledger (OUTREACH_TRACKER.md) and scheduled queue — failing closed if any is missing or malformed —
 * and passes them in. There is deliberately no override flag: nothing here can be forced.
 *
 * Two legitimate kinds of direct send exist in the documented workflows:
 *  - FIRST_TOUCH  a first email. Allowed only for a ledger row in a pre-send state (DRAFTED / SCHEDULED) that the
 *                 GitHub cron is not also holding in scheduled-queue.json.
 *  - FOLLOW_UP    the single bump (/mail-followup: subject "Re: …"). Allowed only for a ledger row that is SENT or
 *                 FOLLOW_UP_DUE and has not already been followed up (single-bump protocol).
 */
export type OutboundEmailKind = 'FIRST_TOUCH' | 'FOLLOW_UP';

export interface OutboundEmail {
  to: string;
  subject: string;
  targetNumber: string;
  companyName: string;
}

export type SendBlockCode =
  | 'INVALID_RECIPIENT'
  | 'DUPLICATE_IN_BATCH'
  | 'SUPPRESSED_TARGET'
  | 'SUPPRESSED_RECIPIENT'
  | 'SUPPRESSED_DOMAIN'
  | 'LEAD_BLOCKED'
  | 'NOT_IN_LEDGER'
  | 'ALREADY_SENT'
  | 'RECIPIENT_ALREADY_EMAILED'
  | 'LEDGER_STATE_NOT_SENDABLE'
  | 'FOLLOW_UP_ALREADY_SENT'
  | 'IN_CRON_QUEUE';

export interface SendGuardInput {
  suppression: SuppressionEntry[];
  leads: KachmoLead[];
  ledger: Map<string, TrackerRow>;
  scheduledQueue: ScheduledEmail[];
}

export interface SendDecision<P extends OutboundEmail> {
  payload: P;
  kind: OutboundEmailKind;
}
export interface BlockedSend<P extends OutboundEmail> extends SendDecision<P> {
  code: SendBlockCode;
  detail: string;
}

export const FIRST_TOUCH_SENDABLE_STATES: ReadonlySet<string> = new Set(['DRAFTED', 'SCHEDULED']);
export const FOLLOW_UP_SENDABLE_STATES: ReadonlySet<string> = new Set(['SENT', 'FOLLOW_UP_DUE']);

/** A reply subject ("Re: …") is the documented marker of the single follow-up bump. */
export function outboundEmailKind(subject: string): OutboundEmailKind {
  return /^\s*re\s*:/i.test(subject ?? '') ? 'FOLLOW_UP' : 'FIRST_TOUCH';
}

/** Host of a suppression domain entry, matched loosely (https/www/path/case) — over-matching is the safe direction. */
function looseHost(s?: string | null): string {
  return (s ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
}

export function evaluateSendGuard<P extends OutboundEmail>(payloads: P[], input: SendGuardInput): { allowed: Array<SendDecision<P>>; blocked: Array<BlockedSend<P>> } {
  const allowed: Array<SendDecision<P>> = [];
  const blocked: Array<BlockedSend<P>> = [];
  const leadByTarget = new Map(input.leads.map(l => [l.target_number, l]));
  const queuedTargets = new Set(input.scheduledQueue.map(s => s.targetNumber));
  const queuedRecipients = new Set(input.scheduledQueue.map(s => normalizeEmail(s.to)).filter((x): x is string => !!x));
  const seenTargets = new Set<string>();
  const seenRecipients = new Set<string>();

  for (const payload of payloads) {
    const kind = outboundEmailKind(payload.subject);
    const block = (code: SendBlockCode, detail: string) => blocked.push({ payload, kind, code, detail });
    const tn = String(payload.targetNumber ?? '').trim();
    const to = normalizeEmail(payload.to);

    if (!to || !tn) {
      block('INVALID_RECIPIENT', `recipient "${payload.to}" / target "${payload.targetNumber}" is not a valid email and target number`);
      continue;
    }
    if (seenTargets.has(tn) || seenRecipients.has(to)) {
      seenTargets.add(tn);
      seenRecipients.add(to);
      block('DUPLICATE_IN_BATCH', 'the same target or recipient appears more than once in this batch');
      continue;
    }
    seenTargets.add(tn);
    seenRecipients.add(to);

    const recipientDomain = to.split('@')[1];
    const suppressed = input.suppression.find(e => e.target_number && e.target_number === tn)
      ? (['SUPPRESSED_TARGET', 'target number is on the suppression list'] as const)
      : input.suppression.find(e => e.email && normalizeEmail(e.email) === to)
        ? (['SUPPRESSED_RECIPIENT', 'recipient email is on the suppression list'] as const)
        : input.suppression.find(e => e.domain && (looseHost(e.domain) === recipientDomain || normalizeDomain(e.domain) === recipientDomain))
          ? (['SUPPRESSED_DOMAIN', 'recipient domain is on the suppression list'] as const)
          : null;
    if (suppressed) {
      block(suppressed[0], suppressed[1]);
      continue;
    }

    const row = input.ledger.get(tn);
    const lead = leadByTarget.get(tn);
    if (lead) {
      const lb = outreachBlock({ ...lead, decision_maker_email: payload.to }, input.suppression, row?.status ?? null);
      if (lb.blocked) {
        block('LEAD_BLOCKED', `lead is blocked from outreach: ${lb.reason}`);
        continue;
      }
    }

    const otherThread = [...input.ledger.values()].find(r => r.target_number !== tn && normalizeEmail(r.email) === to && EMAIL_SENT_STATUSES.has(r.status));
    if (otherThread) {
      block('RECIPIENT_ALREADY_EMAILED', `this recipient was already emailed as target ${otherThread.target_number} (${otherThread.status})`);
      continue;
    }
    if (!row) {
      block('NOT_IN_LEDGER', 'no OUTREACH_TRACKER.md row for this target: record it in the ledger before sending');
      continue;
    }

    if (kind === 'FIRST_TOUCH') {
      if (EMAIL_SENT_STATUSES.has(row.status)) {
        block('ALREADY_SENT', `OUTREACH_TRACKER.md already marks this target ${row.status}`);
        continue;
      }
      if (!FIRST_TOUCH_SENDABLE_STATES.has(row.status)) {
        block('LEDGER_STATE_NOT_SENDABLE', `ledger state "${row.status || 'empty'}" is not DRAFTED or SCHEDULED`);
        continue;
      }
      if (queuedTargets.has(tn) || queuedRecipients.has(to)) {
        block('IN_CRON_QUEUE', 'scheduled-queue.json already holds this target/recipient for the GitHub cron; remove it there first');
        continue;
      }
    } else {
      if (row.status === 'FOLLOWED_UP' || lead?.email_follow_up_sent_at) {
        block('FOLLOW_UP_ALREADY_SENT', `a follow-up was already sent (${row.status === 'FOLLOWED_UP' ? 'ledger FOLLOWED_UP' : `logged ${lead?.email_follow_up_sent_at}`}); single-bump protocol`);
        continue;
      }
      if (!FOLLOW_UP_SENDABLE_STATES.has(row.status)) {
        block('LEDGER_STATE_NOT_SENDABLE', `a follow-up needs ledger state SENT or FOLLOW_UP_DUE, found "${row.status || 'empty'}"`);
        continue;
      }
    }
    allowed.push({ payload, kind });
  }
  return { allowed, blocked };
}
