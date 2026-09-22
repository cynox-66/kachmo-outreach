import 'server-only';
import { verifySuppressionArtifact } from '@kachmo/core/reconciliation/suppression-artifact.js';
import type { Actor } from '../authz/authorize';
import type { CanonicalSnapshot } from '../repo/canonical';
import { ledgerAsOf } from '../repo/titan-ledger';
import { evaluateDispatchPreflight } from '../sync/preflight-rules';
import { readSuppressionArtifact, sha256 } from '../sync/suppression-artifact-store';
import { maskContact, scrubContactValues } from './contacts';
import { dayLabel, emailDates } from './operator';

/**
 * THE EMAIL SENDER, AS AN OPERATOR NEEDS TO SEE IT (ADR-036).
 *
 * The Titan dispatcher runs in GitHub Actions and reports "success" whether it sent five emails or held them all. This
 * derives, from data the app already has, what an operator actually needs to know:
 *
 *   STUCK    queued emails whose planned date has passed and that are still unsent (audit A1)
 *   ON_HOLD  the next dispatch will send nothing: the same pure preflight CI runs refuses the queue (audit A2), or the
 *            do-not-contact list the dispatcher reads is behind Postgres
 *   SENDING  emails are queued and nothing is wrong
 *   IDLE     nothing is queued
 *
 * Read-only. Nothing here can send, schedule, edit or cancel an email.
 */

export type SenderState = 'ON_HOLD' | 'STUCK' | 'SENDING' | 'IDLE';

export interface QueuedEmailView {
  targetNumber: string;
  company: string;
  to: string;
  toVisible: boolean;
  subject: string;
  /** The plain-text body; scrubbed of the recipient's contact values for roles that may not see them. */
  body: string;
  city: string | null;
  country: string | null;
  planned: string | null;
  late: boolean;
  lateDays: number;
  /** Why the dispatch preflight would refuse this entry, in words; null when it is clear. */
  holdReason: string | null;
}

export interface SenderStatus {
  state: SenderState;
  headline: string;
  explanation: string[];
  queued: QueuedEmailView[];
  hold: Array<{ targetNumber: string; company: string; reason: string }>;
  /** Whether every active do-not-contact entry has reached the file the dispatcher reads. */
  listInSync: boolean;
  /** When the email records this app can see were captured (the deployment's build time); null when unknown. */
  asOf: string | null;
}

const HOLD_REASON: Record<string, (company: string) => string> = {
  SUPPRESSED: c => `${c} is now do-not-contact but is still in the automatic queue.`,
  ALREADY_SENT: c => `${c} is already recorded as emailed but is still in the automatic queue.`,
  DUPLICATE_ENTRY: c => `${c} is in the automatic queue twice.`,
  UNKNOWN_TARGET: c => `${c} is in the automatic queue but not in the company list, so it cannot be checked.`,
  NOT_IN_LEDGER: c => `${c} has no row in the email records, so a send could not be recorded.`,
  LEDGER_NOT_SENDABLE: c => `${c}'s email record is not in a state the sender can update.`,
};

export function senderStatus(snap: CanonicalSnapshot, actor: Actor, today: string): SenderStatus {
  const byTn = new Map(snap.leads.map(l => [l.target_number, l]));
  const seesContacts = actor.permissions.has('lead.view_contacts');
  const previews = snap.previews ?? snap.scheduled.map(s => ({ targetNumber: s.targetNumber, to: s.to, subject: '', plainText: '', city: null, country: null }));

  const preflight = snap.titanRaw
    ? evaluateDispatchPreflight({ queueRaw: snap.titanRaw.queue, trackerRaw: snap.titanRaw.tracker, leads: snap.leads, activeSuppression: snap.suppression })
    : null;
  const companyOf = (tn: string) => byTn.get(tn)?.company_name ?? snap.scheduled.find(s => s.targetNumber === tn)?.companyName ?? `Company ${tn}`;
  const hold = (preflight?.findings ?? []).map(f => ({
    targetNumber: f.target_number,
    company: companyOf(f.target_number),
    reason: (HOLD_REASON[f.kind] ?? (c => `${c}: ${f.kind.toLowerCase().replace(/_/g, ' ')}.`))(companyOf(f.target_number)),
  }));

  const queued: QueuedEmailView[] = previews.map(p => {
    const lead = byTn.get(p.targetNumber);
    const d = emailDates(snap.tracker.get(p.targetNumber) ?? null, today);
    // For roles that may not see contact values: the recipient's address, and the lead's own email and phone, are
    // masked wherever they appear in the body — exactly as in core's task text.
    const noContacts = { decision_maker_email: null, decision_maker_phone: null, whatsapp_number: null, decision_maker_whatsapp: null };
    const body = seesContacts ? p.plainText : scrubContactValues(scrubContactValues(p.plainText, { ...noContacts, decision_maker_email: p.to }), lead ?? noContacts);
    return {
      targetNumber: p.targetNumber,
      company: companyOf(p.targetNumber),
      to: seesContacts ? p.to : maskContact(p.to, 'email'),
      toVisible: seesContacts,
      subject: p.subject,
      body,
      city: p.city,
      country: p.country,
      planned: d.date,
      late: d.late,
      lateDays: d.lateDays,
      holdReason: hold.find(h => h.targetNumber === p.targetNumber)?.reason ?? null,
    };
  });

  const artifact = readSuppressionArtifact();
  const verdict = verifySuppressionArtifact({ canonicalActive: snap.suppression, artifactRaw: artifact.raw, hash: sha256 });
  const listInSync = verdict.outreachAllowed;

  const late = queued.filter(q => q.late).sort((a, b) => b.lateDays - a.lateDays);
  const n = queued.length;
  const plural = (k: number, one: string, many: string) => (k === 1 ? one : many);
  const explanation: string[] = [];
  let state: SenderState;
  let headline: string;

  if (n > 0 && ((preflight && !preflight.ok) || !listInSync)) {
    state = 'ON_HOLD';
    headline = 'Automatic email is on hold. The next run will send nothing until this is fixed.';
    for (const h of hold) explanation.push(h.reason);
    if (preflight && !preflight.ok && hold.length === 0) explanation.push('The email records or the queue could not be read cleanly, so the sender refuses to run.');
    if (!listInSync) explanation.push('The do-not-contact list the sender reads is behind. It updates on the next sender run; until then nothing is sent.');
    if (hold.some(h => /do-not-contact/.test(h.reason))) explanation.push('Dev needs to remove that company from the automatic queue. The other queued emails wait until then.');
  } else if (late.length > 0) {
    state = 'STUCK';
    const oldest = late[0];
    headline = `${late.length} scheduled ${plural(late.length, 'email has', 'emails have')} not gone out. The oldest was planned for ${dayLabel(oldest.planned)} (${oldest.lateDays} ${plural(oldest.lateDays, 'day', 'days')} ago).`;
    explanation.push('The automatic sender only sends between 7:30 and 11:30 on a weekday morning in each recipient’s city. When its runs start later in the day, emails wait — and each run still reports success.');
    explanation.push('Tell Dev: the sender’s schedule needs to change so it runs during those mornings. Review the waiting emails before they go out — their wording may be out of date.');
  } else if (n > 0) {
    state = 'SENDING';
    headline = `${n} ${plural(n, 'email is', 'emails are')} scheduled. They send automatically on a weekday morning in each recipient’s city.`;
  } else {
    state = 'IDLE';
    headline = 'Nothing is scheduled to send.';
  }

  return { state, headline, explanation, queued, hold, listInSync, asOf: ledgerAsOf() };
}
