import { resolve } from 'path';
import { existsSync, statSync } from 'fs';
import { randomUUID } from 'crypto';
import { safeReadJson, safeWriteJson, createBackup, pruneBackups, appendJsonl, readJsonl } from './safe-io.js';
import type { KachmoLead, SuppressionEntry, AnalyticsEvent } from './schema.js';
import { findInvariantViolations } from './invariants.js';
import { assertLegacyStoreWritable, warnIfReadingFrozenStore } from './cutover.js';
import { validateLeadDatabase } from '../../core/leads/validation.js';
import { suppressionEntryProblems, isEquivalentSuppression } from '../../core/suppression/match.js';

export const LEAD_BACKUPS_KEPT = 30;

export function paths() {
  const r = (p: string) => resolve(process.cwd(), p);
  return {
    leads: r('database/kachmo_leads.json'),
    suppression: r('database/suppression.json'),
    researchQueue: r('database/research-queue.json'),
    backups: r('database/backups'),
    callingQueue: r('queues/calling-queue.json'),
    whatsappQueue: r('queues/whatsapp-queue.json'),
    warRoomJson: r('queues/daily-war-room.json'),
    events: r('analytics/events.jsonl'),
    weeklyReport: r('analytics/weekly-report.json'),
    // Production email subsystem — read-only from V2
    tracker: r('OUTREACH_TRACKER.md'),
    scheduledQueue: r('scheduled-queue.json'),
    csv: r('kachmo_targets.csv'),
  };
}

/** File stat at the moment a leads array was loaded or saved — used to detect a concurrent writer. */
const stamps = new WeakMap<object, { mtimeMs: number; size: number }>();
const stampOf = (p: string) => {
  const s = statSync(p);
  return { mtimeMs: s.mtimeMs, size: s.size };
};

/** Strict load. Never repairs, never substitutes defaults: a bad file stops the command. Validation rules: core/leads/validation.ts. */
export function loadLeads(): KachmoLead[] {
  warnIfReadingFrozenStore();
  const p = paths().leads;
  if (!existsSync(p)) throw new Error(`Lead database missing: ${p}. Run "npm run leads:migrate" first.`);
  const stamp = stampOf(p);
  const v = validateLeadDatabase(safeReadJson<unknown>(p, null));
  if (!v.ok) {
    if (v.kind === 'NOT_ARRAY') throw new Error(`Lead database ${p} is not a JSON array. Restore from database/backups/.`);
    if (v.kind === 'MALFORMED') {
      throw new Error(`Lead database ${p} has malformed record(s); nothing was changed. Fix or restore from database/backups/:\n  - ${v.problems.slice(0, 20).join('\n  - ')}`);
    }
    throw new Error(v.problems[0]);
  }
  stamps.set(v.leads, stamp);
  return v.leads;
}

/**
 * The only way V2 writes the lead database: concurrent-modification check → invariant check →
 * shrink guard → timestamped backup (newest LEAD_BACKUPS_KEPT kept) → atomic write.
 * `basedOn` is the array this data was derived from, when it is not the array itself (migration).
 */
export function saveLeads(leads: KachmoLead[], opts: { basedOn?: KachmoLead[] } = {}): void {
  assertLegacyStoreWritable('saveLeads() → database/kachmo_leads.json');
  const p = paths().leads;
  const loadedStamp = stamps.get(opts.basedOn ?? leads);
  if (loadedStamp && existsSync(p)) {
    const now = stampOf(p);
    if (now.mtimeMs !== loadedStamp.mtimeMs || now.size !== loadedStamp.size) {
      throw new Error(`Refusing to save: ${p} was modified by another command after this one loaded it. Nothing was written; re-run the command.`);
    }
  }
  const violations = findInvariantViolations(leads);
  if (violations.length) {
    throw new Error(`Refusing to save lead database — ${violations.length} invariant violation(s):\n  - ${violations.slice(0, 20).join('\n  - ')}`);
  }
  if (existsSync(p)) {
    const current = safeReadJson<unknown[]>(p, []);
    if (Array.isArray(current) && leads.length < current.length) {
      throw new Error(`Refusing to save: lead count would shrink from ${current.length} to ${leads.length}. Leads are never deleted.`);
    }
    createBackup(p, paths().backups);
    pruneBackups(paths().backups, 'kachmo_leads_', LEAD_BACKUPS_KEPT);
  }
  safeWriteJson(p, leads);
  stamps.set(leads, stampOf(p));
}

/** Suppression must exist and be well-formed: a missing or unreadable list would silently disable opt-outs. */
export function loadSuppression(): SuppressionEntry[] {
  const p = paths().suppression;
  if (!existsSync(p)) {
    throw new Error(`Suppression list missing: ${p}. Refusing to build outreach queues without it (create it with "[]" if genuinely empty).`);
  }
  const list = safeReadJson<unknown>(p, null);
  if (!Array.isArray(list)) throw new Error(`Suppression list ${p} is not a JSON array.`);
  const problems = suppressionEntryProblems(list);
  if (problems.length) {
    throw new Error(`Suppression list ${p} is malformed; refusing to build outreach from it:\n  - ${problems.join('\n  - ')}`);
  }
  return list as SuppressionEntry[];
}

/** Adds an entry unless an equivalent one already exists. Returns true if added. */
export function addSuppression(entry: SuppressionEntry): boolean {
  assertLegacyStoreWritable('addSuppression() → database/suppression.json');
  const list = loadSuppression();
  if (list.some(e => isEquivalentSuppression(e, entry))) return false;
  list.push(entry);
  safeWriteJson(paths().suppression, list);
  return true;
}

export function logEvent(e: Omit<AnalyticsEvent, 'event_id' | 'timestamp'> & { timestamp?: string }): void {
  assertLegacyStoreWritable('logEvent() → analytics/events.jsonl');
  appendJsonl(paths().events, { event_id: randomUUID(), timestamp: e.timestamp ?? new Date().toISOString(), ...e });
}

export function readEvents(): AnalyticsEvent[] {
  return readJsonl<AnalyticsEvent>(paths().events);
}

export function findLead(leads: KachmoLead[], ident: string): KachmoLead | undefined {
  const id = ident.trim();
  const tn = /^\d{1,3}$/.test(id) ? id.padStart(3, '0') : id;
  return leads.find(l => l.target_number === tn || l.lead_id === id);
}
