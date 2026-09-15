import { resolve } from 'path';
import { existsSync, statSync } from 'fs';
import { randomUUID } from 'crypto';
import { safeReadJson, safeWriteJson, createBackup, pruneBackups, appendJsonl, readJsonl } from './safe-io.js';
import type { KachmoLead, SuppressionEntry, AnalyticsEvent } from './schema.js';
import { findInvariantViolations } from './invariants.js';
import { normalizeEmail, phoneKey, normalizeDomain } from './contact.js';

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

const PROVENANCE = new Set(['UNKNOWN', 'INFERRED', 'UNVERIFIED', 'PUBLICLY_LISTED', 'VERIFIED', 'INVALID']);
const RESEARCH_STATES = new Set(['DISCOVERED', 'QUALIFICATION_PENDING', 'RESEARCH_REQUIRED', 'ENRICHED', 'QUALIFIED', 'DISQUALIFIED', 'OUTREACH_READY']);

/** File stat at the moment a leads array was loaded or saved — used to detect a concurrent writer. */
const stamps = new WeakMap<object, { mtimeMs: number; size: number }>();
const stampOf = (p: string) => {
  const s = statSync(p);
  return { mtimeMs: s.mtimeMs, size: s.size };
};

function recordProblems(l: any, i: number): string[] {
  const at = `record #${i + 1}${l?.target_number ? ` (${l.target_number})` : ''}`;
  if (!l || typeof l !== 'object' || Array.isArray(l)) return [`${at}: not an object`];
  const out: string[] = [];
  for (const f of ['lead_id', 'target_number', 'company_name', 'lead_state']) {
    if (typeof l[f] !== 'string' || !l[f].trim()) out.push(`${at}: missing ${f}`);
  }
  if (!RESEARCH_STATES.has(l.research_state)) out.push(`${at}: invalid research_state ${JSON.stringify(l.research_state)}`);
  for (const f of ['phone_status', 'email_status']) if (!PROVENANCE.has(l[f])) out.push(`${at}: invalid ${f} ${JSON.stringify(l[f])}`);
  for (const f of ['missing_intelligence', 'research_sources']) if (!Array.isArray(l[f])) out.push(`${at}: ${f} must be an array`);
  return out;
}

/** Strict load. Never repairs, never substitutes defaults: a bad file stops the command. */
export function loadLeads(): KachmoLead[] {
  const p = paths().leads;
  if (!existsSync(p)) throw new Error(`Lead database missing: ${p}. Run "npm run leads:migrate" first.`);
  const stamp = stampOf(p);
  const leads = safeReadJson<unknown>(p, null);
  if (!Array.isArray(leads)) throw new Error(`Lead database ${p} is not a JSON array. Restore from database/backups/.`);
  const problems = leads.flatMap(recordProblems);
  if (problems.length) {
    throw new Error(`Lead database ${p} has malformed record(s); nothing was changed. Fix or restore from database/backups/:\n  - ${problems.slice(0, 20).join('\n  - ')}`);
  }
  const seenTn = new Set<string>();
  const seenId = new Set<string>();
  for (const l of leads as KachmoLead[]) {
    if (seenTn.has(l.target_number)) throw new Error(`Duplicate target_number ${l.target_number} in lead database.`);
    if (seenId.has(l.lead_id)) throw new Error(`Duplicate lead_id ${l.lead_id} in lead database.`);
    seenTn.add(l.target_number);
    seenId.add(l.lead_id);
  }
  stamps.set(leads, stamp);
  return leads as KachmoLead[];
}

/**
 * The only way V2 writes the lead database: concurrent-modification check → invariant check →
 * shrink guard → timestamped backup (newest LEAD_BACKUPS_KEPT kept) → atomic write.
 * `basedOn` is the array this data was derived from, when it is not the array itself (migration).
 */
export function saveLeads(leads: KachmoLead[], opts: { basedOn?: KachmoLead[] } = {}): void {
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
  const problems = list.flatMap((e, i) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return [`entry #${i + 1}: not an object`];
    const x = e as Record<string, unknown>;
    const hasId = ['lead_id', 'target_number', 'email', 'phone', 'domain'].some(k => typeof x[k] === 'string' && (x[k] as string).trim());
    return hasId ? [] : [`entry #${i + 1}: has no lead_id/target_number/email/phone/domain`];
  });
  if (problems.length) {
    throw new Error(`Suppression list ${p} is malformed; refusing to build outreach from it:\n  - ${problems.join('\n  - ')}`);
  }
  return list as SuppressionEntry[];
}

/** Adds an entry unless an equivalent one already exists. Returns true if added. */
export function addSuppression(entry: SuppressionEntry): boolean {
  const list = loadSuppression();
  const same = (a?: string | null, b?: string | null, norm: (x?: string | null) => string | null = x => x ?? null) =>
    !!a && !!b && norm(a) === norm(b);
  const exists = list.some(
    e =>
      same(e.lead_id, entry.lead_id) ||
      same(e.target_number, entry.target_number) ||
      same(e.email, entry.email, normalizeEmail) ||
      same(e.phone, entry.phone, phoneKey) ||
      same(e.domain, entry.domain, normalizeDomain)
  );
  if (exists) return false;
  list.push(entry);
  safeWriteJson(paths().suppression, list);
  return true;
}

export function logEvent(e: Omit<AnalyticsEvent, 'event_id' | 'timestamp'> & { timestamp?: string }): void {
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
