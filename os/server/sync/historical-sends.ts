/**
 * HISTORICAL SEND RECONCILIATION — `npm run ledger:reconcile-historical-sends`
 *
 * On 2026-09-12 between 14:32 and 14:33 UTC, 19 emails were sent by hand from webmail. The mailbox Sent folder
 * proves it (read-only IMAP investigation, 2026-09-18). OUTREACH_TRACKER.md — the ledger every send guard trusts —
 * still recorded 18 of them as DRAFTED, which every guard treats as "never emailed": a duplicate-send risk.
 *
 * What this does, and deliberately nothing else:
 *
 *   18 targets   ledger **DRAFTED** → **SENT**, annotated in the row: channel WEBMAIL/MANUAL, NOT dispatched by
 *                Titan, the minute the evidence supports, and the Sent-folder IMAP UID it rests on.
 *   042 (Dome)   stays **DISQUALIFIED**. The manual send is recorded beside it as a separate fact; nothing here
 *                implies the engine approved or dispatched it.
 *   Postgres     one append-only audit_event per target. Lead records are NOT modified: Titan's ledger owns email
 *                send state in every phase (see repo/canonical.ts), exactly as for targets 106-110.
 *
 * Never: sends mail, opens SMTP/IMAP, touches suppression, scheduled-queue.json, the workflow, lead records or
 * qualification. No Message-ID, Titan run id or seconds are invented; the evidence supports minutes.
 *
 * SAFETY PROPERTIES
 *   - explicit allowlist: target, exact recipient, exact expected ledger state, evidence
 *   - dry run by default; --apply also needs --confirm=<plan digest> printed by the dry run, which binds the apply
 *     to the exact tracker bytes and rows a human reviewed
 *   - refuses on any wrong state, wrong recipient, missing/duplicated row or lead, or a mix of done/not-done
 *   - all-or-nothing: the audit rows are inserted in a transaction, the tracker is atomically replaced inside it,
 *     and a failed commit restores the tracker's previous bytes. A crash between the two is detected and resumed.
 *   - idempotent: a completed reconciliation reports ALREADY_RECONCILED and writes nothing
 *   - the tracker's previous bytes are backed up before it is replaced
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { KachmoLead } from '@kachmo/core/leads/schema.js';
import * as schema from '../db/schema/index';
import { recordAudit } from '../audit/audit';

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const RECONCILIATION_ID = 'webmail-sends-2026-09-12';
export const ACTION_SENT = 'ledger.historical_send_reconciled';
export const ACTION_EXTERNAL = 'ledger.external_send_recorded';

export interface HistoricalSend {
  targetNumber: string;
  recipient: string;
  /** The exact ledger status the row must hold before reconciliation. */
  expectedStatus: 'DRAFTED' | 'DISQUALIFIED';
  /** UTC, minute precision — what the evidence (IMAP INTERNALDATE of the Sent copy) supports. */
  sentAtUtc: string;
  /** UID of the message in the mailbox's Sent folder at the time of the investigation. */
  sentFolderUid: number;
}

/** The verified evidence. Every row was matched by exact recipient address to exactly one ledger row and one lead. */
export const HISTORICAL_SENDS: readonly HistoricalSend[] = [
  { targetNumber: '018', recipient: 'hello@anewday.studio', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:32Z', sentFolderUid: 16 },
  { targetNumber: '021', recipient: 'hello@granyon.com', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:32Z', sentFolderUid: 17 },
  { targetNumber: '080', recipient: 'info@thelaurelgroup.net', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:32Z', sentFolderUid: 18 },
  { targetNumber: '083', recipient: 'info@insightlegal.co.in', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:32Z', sentFolderUid: 19 },
  { targetNumber: '078', recipient: 'info@acacia-gardens.co.uk', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:32Z', sentFolderUid: 20 },
  { targetNumber: '079', recipient: 'p@guillotinc.com', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:32Z', sentFolderUid: 21 },
  { targetNumber: '073', recipient: 'info@cosmedocs.com', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:32Z', sentFolderUid: 23 },
  { targetNumber: '074', recipient: 'info@luxuryaestheticclinic.com', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:33Z', sentFolderUid: 24 },
  { targetNumber: '052', recipient: 'founders@thecontextcompany.com', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:33Z', sentFolderUid: 25 },
  { targetNumber: '061', recipient: 'studio@hollowayli.com', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:33Z', sentFolderUid: 26 },
  { targetNumber: '042', recipient: 'support@domeapi.com', expectedStatus: 'DISQUALIFIED', sentAtUtc: '2026-09-12T14:33Z', sentFolderUid: 27 },
  { targetNumber: '049', recipient: 'info@sembleai.com', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:33Z', sentFolderUid: 28 },
  { targetNumber: '030', recipient: 'info@thonik.nl', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:33Z', sentFolderUid: 29 },
  { targetNumber: '033', recipient: 'founders@moss.dev', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:33Z', sentFolderUid: 30 },
  { targetNumber: '035', recipient: 'matthew@pothlabs.com', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:33Z', sentFolderUid: 31 },
  { targetNumber: '020', recipient: 'hi@studiosesenta.com', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:33Z', sentFolderUid: 32 },
  { targetNumber: '022', recipient: 'hello@sideperspectives.com', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:33Z', sentFolderUid: 33 },
  { targetNumber: '016', recipient: 'hello@wonderland.studio', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:33Z', sentFolderUid: 34 },
  { targetNumber: '017', recipient: 'studio@helder.design', expectedStatus: 'DRAFTED', sentAtUtc: '2026-09-12T14:33Z', sentFolderUid: 35 },
];

const EVIDENCE_SOURCE = 'studios mailbox Sent folder, read-only IMAP investigation 2026-09-18';
const marker = `(${RECONCILIATION_ID})`;
const norm = (s?: string | null) => (s ?? '').replace(/`/g, '').trim().toLowerCase();
const cellStatus = (cell: string) => cell.replace(/[`*]/g, '').trim().toUpperCase().replace(/\s+/g, '_');
const utcLabel = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The text appended to a row's notes cell. No `|`, no bold, and never the word the other kind of row relies on. */
export function annotation(s: HistoricalSend, reconciledOn: string, actor: string): string {
  const evidence = `evidence: ${EVIDENCE_SOURCE}, IMAP UID ${s.sentFolderUid}; reconciled ${reconciledOn} by ${actor}`;
  return s.expectedStatus === 'DRAFTED'
    ? ` · HISTORICAL SEND ${marker}: actually sent ${utcLabel(s.sentAtUtc)} via WEBMAIL/MANUAL, not dispatched by Titan; ${evidence}`
    : ` · EXTERNAL MANUAL SEND ${marker}: emailed ${utcLabel(s.sentAtUtc)} via WEBMAIL/MANUAL outside the approved Titan path despite this disqualification; remains disqualified, never approved or dispatched by Titan; ${evidence}`;
}

// ── Tracker ─────────────────────────────────────────────────────────────────

export type RowState = 'BEFORE' | 'AFTER' | 'CONFLICT';
interface RowFinding {
  send: HistoricalSend;
  state: RowState;
  problem: string | null;
  lineIndex: number;
  status: string;
}

/** Locates every allowlisted row and classifies it. Columns are found from each batch table's header. */
export function inspectTracker(content: string, sends: readonly HistoricalSend[]): RowFinding[] {
  const lines = content.split('\n');
  const rows = new Map<string, { lineIndex: number; cells: string[]; header: string[] }[]>();
  let header: string[] | null = null;
  let inBatch = false;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (/^###\s*Batch\s+\d+/i.test(line)) { inBatch = true; header = null; return; }
    if (/^##\s/.test(line)) { inBatch = false; header = null; return; }
    if (!inBatch || !line.startsWith('|')) return;
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells[0] === '#') { header = cells.map(c => c.toLowerCase()); return; }
    const m = cells[0]?.match(/^\*\*(\d{3})\*\*$/);
    if (!m || !header) return;
    rows.set(m[1], [...(rows.get(m[1]) ?? []), { lineIndex: i, cells, header }]);
  });
  // A row anywhere else that the dispatcher's own `| **NNN** |` matcher would see also counts as a duplicate.
  const loose = (tn: string) => lines.filter(l => l.includes(`| **${tn}** |`)).length;

  return sends.map(send => {
    const found = rows.get(send.targetNumber) ?? [];
    const conflict = (problem: string, lineIndex = -1, status = ''): RowFinding => ({ send, state: 'CONFLICT', problem, lineIndex, status });
    if (found.length !== 1 || loose(send.targetNumber) !== 1) return conflict(`expected exactly one ledger row, found ${Math.max(found.length, loose(send.targetNumber))}`);
    const { lineIndex, cells, header } = found[0];
    const statusIdx = header.findIndex(h => h.includes('status'));
    const emailIdx = header.findIndex(h => h.includes('email') || h.includes('recipient'));
    if (statusIdx < 0 || emailIdx < 0 || cells.length !== header.length) return conflict('the ledger row does not have the expected columns', lineIndex);
    const status = cellStatus(cells[statusIdx]);
    if (norm(cells[emailIdx]) !== norm(send.recipient)) return conflict('the ledger row recipient does not match the evidence', lineIndex, status);
    const notes = cells[cells.length - 1];
    const annotated = notes.includes(marker);
    const doneStatus = send.expectedStatus === 'DRAFTED' ? 'SENT' : 'DISQUALIFIED';
    if (!annotated && status === send.expectedStatus) return { send, state: 'BEFORE', problem: null, lineIndex, status };
    if (annotated && status === doneStatus) return { send, state: 'AFTER', problem: null, lineIndex, status };
    return conflict(`ledger status is ${status || 'empty'}${annotated ? ' with the reconciliation note' : ''}; expected ${send.expectedStatus} (or ${doneStatus} once reconciled)`, lineIndex, status);
  });
}

/** Rewrites exactly the allowlisted rows. Pure. Every other byte of the file is preserved. */
export function reconcileTrackerContent(content: string, sends: readonly HistoricalSend[], reconciledOn: string, actor: string): string {
  const findings = inspectTracker(content, sends);
  const bad = findings.find(f => f.state !== 'BEFORE');
  if (bad) throw new Error(`target ${bad.send.targetNumber}: ${bad.problem ?? `already ${bad.state}`}`);
  const lines = content.split('\n');
  for (const f of findings) {
    const parts = lines[f.lineIndex].split('|'); // parts[k + 1] is cell k; the last part is the trailing text
    if (f.send.expectedStatus === 'DRAFTED') {
      const statusPart = parts.findIndex((p, k) => k > 0 && k < parts.length - 1 && /\*\*DRAFTED\*\*/.test(p));
      if (statusPart < 0) throw new Error(`target ${f.send.targetNumber}: status cell is not **DRAFTED**`);
      parts[statusPart] = parts[statusPart].replace('**DRAFTED**', '**SENT**');
    }
    const notesPart = parts.length - 2;
    parts[notesPart] = `${parts[notesPart].replace(/\s+$/, '')}${annotation(f.send, reconciledOn, actor)} `;
    lines[f.lineIndex] = parts.join('|');
  }
  return lines.join('\n');
}

// ── Plan ────────────────────────────────────────────────────────────────────

export interface LeadRef { leadId: string; targetNumber: string; email: string | null }

export interface Plan {
  outcome: 'READY' | 'ALREADY_RECONCILED' | 'REFUSED';
  problems: string[];
  trackerState: 'BEFORE' | 'AFTER' | 'MIXED';
  auditState: 'ABSENT' | 'PRESENT' | 'MIXED';
  trackerShaBefore: string;
  nextTracker: string | null;
  audits: Array<{ send: HistoricalSend; leadId: string; action: string }>;
  digest: string;
  counts: { draftedToSent: number; externalAnnotations: number; auditEvents: number };
}

export function planReconciliation(input: {
  tracker: string;
  leads: LeadRef[];
  /** Existing audit rows for this reconciliation, by lead id. */
  existingAudits: Map<string, number>;
  sends: readonly HistoricalSend[];
  reconciledOn: string;
  actor: string;
}): Plan {
  const problems: string[] = [];
  if (!input.actor.trim() || /[|`*]/.test(input.actor)) problems.push('an --actor naming the human performing the reconciliation is required (no | ` or *)');
  if (new Set(input.sends.map(s => s.targetNumber)).size !== input.sends.length) problems.push('the allowlist names a target twice');

  const findings = inspectTracker(input.tracker, input.sends);
  for (const f of findings) if (f.state === 'CONFLICT') problems.push(`target ${f.send.targetNumber}: ${f.problem}`);

  const audits: Plan['audits'] = [];
  const auditPresence: boolean[] = [];
  for (const s of input.sends) {
    const matches = input.leads.filter(l => l.targetNumber === s.targetNumber);
    if (matches.length !== 1) { problems.push(`target ${s.targetNumber}: expected exactly one Postgres lead, found ${matches.length}`); continue; }
    if (norm(matches[0].email) !== norm(s.recipient)) { problems.push(`target ${s.targetNumber}: the Postgres lead's email does not match the evidence recipient`); continue; }
    const n = input.existingAudits.get(matches[0].leadId) ?? 0;
    if (n > 1) problems.push(`target ${s.targetNumber}: ${n} audit events already exist for this reconciliation`);
    auditPresence.push(n === 1);
    audits.push({ send: s, leadId: matches[0].leadId, action: s.expectedStatus === 'DRAFTED' ? ACTION_SENT : ACTION_EXTERNAL });
  }

  const states = findings.map(f => f.state);
  const trackerState: Plan['trackerState'] = states.every(s => s === 'BEFORE') ? 'BEFORE' : states.every(s => s === 'AFTER') ? 'AFTER' : 'MIXED';
  const auditState: Plan['auditState'] = auditPresence.length && auditPresence.every(Boolean) ? 'PRESENT' : auditPresence.every(p => !p) ? 'ABSENT' : 'MIXED';
  if (!problems.length && trackerState === 'MIXED') problems.push('some allowlisted rows are reconciled and others are not; refusing to guess');
  if (!problems.length && auditState === 'MIXED') problems.push('audit events exist for some targets but not others; refusing to guess');

  const trackerShaBefore = sha256(input.tracker);
  const counts = {
    draftedToSent: input.sends.filter(s => s.expectedStatus === 'DRAFTED').length,
    externalAnnotations: input.sends.filter(s => s.expectedStatus === 'DISQUALIFIED').length,
    auditEvents: input.sends.length,
  };
  const base = { problems, trackerState, auditState, trackerShaBefore, audits, counts };
  if (problems.length) return { ...base, outcome: 'REFUSED', nextTracker: null, digest: '' };
  if (trackerState === 'AFTER' && auditState === 'PRESENT') return { ...base, outcome: 'ALREADY_RECONCILED', nextTracker: null, digest: '' };

  const nextTracker = trackerState === 'BEFORE' ? reconcileTrackerContent(input.tracker, input.sends, input.reconciledOn, input.actor) : null;
  const digest = sha256(
    JSON.stringify({ id: RECONCILIATION_ID, trackerShaBefore, next: nextTracker === null ? null : sha256(nextTracker), audits: auditState === 'ABSENT' ? audits.map(a => [a.leadId, a.action, a.send.sentFolderUid]) : [], actor: input.actor })
  ).slice(0, 16);
  return { ...base, outcome: 'READY', nextTracker, digest };
}

// ── I/O ─────────────────────────────────────────────────────────────────────

export async function readLeadRefs(db: Db, sends: readonly HistoricalSend[]): Promise<LeadRef[]> {
  const rows = await db.select({ leadId: schema.lead.leadId, targetNumber: schema.lead.targetNumber, record: schema.lead.record })
    .from(schema.lead).where(inArray(schema.lead.targetNumber, sends.map(s => s.targetNumber)));
  return rows.map(r => ({ leadId: r.leadId, targetNumber: r.targetNumber, email: (r.record as KachmoLead).decision_maker_email ?? null }));
}

export async function readExistingAudits(db: Db): Promise<Map<string, number>> {
  const rows = await db.select({ targetId: schema.auditEvent.targetId, n: sql<number>`count(*)::int` })
    .from(schema.auditEvent)
    .where(and(inArray(schema.auditEvent.action, [ACTION_SENT, ACTION_EXTERNAL]), eq(sql`${schema.auditEvent.metadata}->>'reconciliation_id'`, RECONCILIATION_ID)))
    .groupBy(schema.auditEvent.targetId);
  return new Map(rows.map(r => [r.targetId ?? '', Number(r.n)]));
}

export interface RunOptions {
  root: string;
  actor: string;
  apply: boolean;
  confirm?: string;
  reconciledOn?: string;
  sends?: readonly HistoricalSend[];
  /** Test seam: replaces the atomic tracker write. */
  writeTracker?: (path: string, content: string) => void;
}

export interface RunResult { plan: Plan; applied: boolean; backupPath: string | null; message: string }

const TRACKER = 'OUTREACH_TRACKER.md';

function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.tmp-reconcile-${process.pid}`;
  try {
    writeFileSync(tmp, content, 'utf-8');
    renameSync(tmp, path);
  } catch (e) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw e;
  }
}

export async function runReconciliation(db: Db, opts: RunOptions): Promise<RunResult> {
  const sends = opts.sends ?? HISTORICAL_SENDS;
  const trackerPath = join(opts.root, TRACKER);
  if (!existsSync(trackerPath)) throw new Error(`${TRACKER} not found at ${trackerPath}`);
  const tracker = readFileSync(trackerPath, 'utf-8');
  const plan = planReconciliation({
    tracker,
    leads: await readLeadRefs(db, sends),
    existingAudits: await readExistingAudits(db),
    sends,
    reconciledOn: opts.reconciledOn ?? new Date().toISOString().slice(0, 10),
    actor: opts.actor,
  });
  if (plan.outcome !== 'READY') return { plan, applied: false, backupPath: null, message: plan.outcome === 'ALREADY_RECONCILED' ? 'already reconciled; nothing written' : 'refused; nothing written' };
  if (!opts.apply) return { plan, applied: false, backupPath: null, message: `DRY RUN — nothing written. To apply: --apply --confirm=${plan.digest}` };
  if (opts.confirm !== plan.digest) {
    return { plan: { ...plan, outcome: 'REFUSED', problems: [`--confirm must equal the plan digest ${plan.digest} shown by a dry run of this exact state`] }, applied: false, backupPath: null, message: 'refused; nothing written' };
  }

  let backupPath: string | null = null;
  if (plan.nextTracker !== null) {
    const dir = join(opts.root, 'backups', 'ledger-reconciliation');
    mkdirSync(dir, { recursive: true });
    backupPath = join(dir, `OUTREACH_TRACKER.before-${RECONCILIATION_ID}.${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
    copyFileSync(trackerPath, backupPath);
  }
  const write = opts.writeTracker ?? atomicWrite;
  let trackerReplaced = false;
  try {
    await db.transaction(async tx => {
      if (plan.auditState === 'ABSENT') {
        for (const a of plan.audits) {
          const drafted = a.send.expectedStatus === 'DRAFTED';
          await recordAudit(tx as unknown as Db, {
            actor: { userId: null, label: opts.actor },
            action: a.action,
            target: { type: 'lead', id: a.leadId },
            metadata: {
              reconciliation_id: RECONCILIATION_ID,
              target_number: a.send.targetNumber,
              actual_outcome: 'SENT',
              channel: 'WEBMAIL_MANUAL',
              titan_dispatch: false,
              sent_at_utc: a.send.sentAtUtc,
              sent_at_precision: 'minute',
              evidence_source: EVIDENCE_SOURCE,
              evidence_sent_folder_uid: a.send.sentFolderUid,
              ledger_status_before: a.send.expectedStatus,
              ledger_status_after: drafted ? 'SENT' : 'DISQUALIFIED',
              approved_for_titan: drafted ? null : false,
              note: drafted
                ? 'Historical correction: the ledger said DRAFTED but the email was sent by hand from webmail. Titan did not send it.'
                : 'Sent by hand from webmail despite a Gate 2 disqualification (ledger note: Remove from Titan Drafts). Not approved, not dispatched by Titan. Status stays DISQUALIFIED.',
              tracker_sha_before: plan.trackerShaBefore,
            },
          });
        }
      }
      // The tracker is replaced last, inside the transaction: if this throws, the audit rows roll back with it.
      if (plan.nextTracker !== null) {
        if (sha256(readFileSync(trackerPath, 'utf-8')) !== plan.trackerShaBefore) throw new Error(`${TRACKER} changed since it was planned; nothing written`);
        trackerReplaced = true; // set first: if the write fails midway, restoring the backup is harmless
        write(trackerPath, plan.nextTracker);
      }
    });
  } catch (e) {
    // The commit (or anything after the replace) failed: put the tracker back so neither store moved.
    if (trackerReplaced && backupPath) atomicWrite(trackerPath, readFileSync(backupPath, 'utf-8'));
    throw e;
  }

  const after = await runReconciliation(db, { ...opts, apply: false });
  if (after.plan.outcome !== 'ALREADY_RECONCILED') throw new Error(`applied, but re-verification did not find a completed reconciliation: ${after.plan.problems.join('; ') || after.plan.outcome}`);
  return { plan, applied: true, backupPath, message: `reconciled: ${plan.counts.draftedToSent} DRAFTED → SENT, ${plan.counts.externalAnnotations} external send recorded; verified` };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1] && /server[\\/]sync[\\/]historical-sends\.ts$/.test(process.argv[1])) {
  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { loadLocalEnv } = await import('../db/local-env');
  const { safeTargetLabel } = await import('../db/migration/hosted-target');
  const { REPO_ROOT } = await import('./suppression-artifact-store');
  loadLocalEnv();
  const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const url = process.env.DATABASE_URL?.trim();
  if (!url) { console.error('❌ DATABASE_URL is not set.'); process.exit(2); }
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true }, max: 2, connectionTimeoutMillis: 15_000 });
  const db = drizzle({ client: pool, schema });
  const actor = arg('actor') ?? '';
  const apply = process.argv.includes('--apply');
  (async () => {
    console.log(`\n🧾 Historical send reconciliation ${RECONCILIATION_ID} — target ${safeTargetLabel(url)}`);
    const r = await runReconciliation(db, { root: REPO_ROOT, actor, apply, confirm: arg('confirm') });
    const p = r.plan;
    console.log(`   tracker: ${p.trackerState} (sha ${p.trackerShaBefore.slice(0, 12)}) · audit events: ${p.auditState}`);
    for (const a of p.audits) {
      const change = a.send.expectedStatus === 'DRAFTED' ? 'DRAFTED → SENT        ' : 'DISQUALIFIED (kept) + external-send note';
      console.log(`   ${a.send.targetNumber}  ${change}  ${utcLabel(a.send.sentAtUtc)}  Sent UID ${a.send.sentFolderUid}  → audit ${a.action}`);
    }
    console.log(`\n   ${p.counts.draftedToSent} DRAFTED → SENT · ${p.counts.externalAnnotations} DISQUALIFIED kept with external-send annotation · ${p.counts.auditEvents} audit events`);
    console.log('   0 queue changes · 0 suppression changes · 0 lead record changes · 0 emails · 0 SMTP connections');
    for (const x of p.problems) console.log(`   ⛔ ${x}`);
    if (p.outcome === 'READY' && !r.applied) console.log(`\n   plan digest: ${p.digest}`);
    if (r.backupPath) console.log(`   backup: ${r.backupPath}`);
    console.log(`\n   ${p.outcome === 'REFUSED' ? '⛔' : '✅'} ${r.message}`);
    if (r.applied) console.log(`   ${TRACKER} changed: commit it, then run npm run audit:baseline (it is a protected file).`);
    return p.outcome === 'REFUSED' ? 1 : 0;
  })()
    .then(code => pool.end().then(() => process.exit(code)))
    .catch(err => { console.error(`\n❌ ${(err as Error).message}`); pool.end().finally(() => process.exit(1)); });
}
