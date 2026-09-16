import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KachmoLead, SuppressionEntry, AnalyticsEvent } from '../../../../core/leads/schema.js';
import { validateLeadDatabase } from '../../../../core/leads/validation.js';
import { findInvariantViolations } from '../../../../core/leads/invariants.js';
import { suppressionEntryProblems } from '../../../../core/suppression/match.js';
import { canonicalSha256, sha256 } from './canonical';

/** The canonical JSON-store data a migration reads. Only ever read from a COPY, never the live working tree. */
export interface CanonicalSource {
  dir: string;
  leads: KachmoLead[];
  suppression: SuppressionEntry[];
  events: AnalyticsEvent[];
  fileSha256: Record<string, string>;
  leadRecordSha256: Map<string, string>;
}

export const SOURCE_FILES = {
  leads: 'database/kachmo_leads.json',
  suppression: 'database/suppression.json',
  events: 'analytics/events.jsonl',
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MigrationSourceError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Migration source rejected — nothing was imported:\n  - ${problems.slice(0, 25).join('\n  - ')}${problems.length > 25 ? `\n  - …${problems.length - 25} more` : ''}`);
  }
}

/**
 * Loads and validates the source with the engine's own rules. Fails closed: any structural problem, invariant
 * violation, non-UUID identity, malformed suppression entry, corrupt event line (including a truncated final line)
 * or value Postgres jsonb cannot store losslessly aborts the whole migration.
 */
export function loadCanonicalSource(dir: string): CanonicalSource {
  const problems: string[] = [];
  const read = (rel: string): string | null => {
    const p = join(dir, rel);
    if (!existsSync(p)) {
      problems.push(`${rel}: missing`);
      return null;
    }
    return readFileSync(p, 'utf-8');
  };
  const raw = { leads: read(SOURCE_FILES.leads), suppression: read(SOURCE_FILES.suppression), events: read(SOURCE_FILES.events) };
  if (problems.length) throw new MigrationSourceError(problems);

  const parse = (rel: string, text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch (e) {
      problems.push(`${rel}: not valid JSON (${(e as Error).message})`);
      return undefined;
    }
  };

  let leads: KachmoLead[] = [];
  const parsedLeads = parse(SOURCE_FILES.leads, raw.leads!);
  if (parsedLeads !== undefined) {
    const v = validateLeadDatabase(parsedLeads);
    if (!v.ok) problems.push(...(v.kind === 'NOT_ARRAY' ? [`${SOURCE_FILES.leads}: not a JSON array`] : v.problems));
    else {
      leads = v.leads;
      problems.push(...findInvariantViolations(leads).map(x => `invariant: ${x}`));
      for (const l of leads) {
        if (!UUID.test(l.lead_id)) problems.push(`lead ${l.target_number}: lead_id is not a UUID`);
        if (typeof l.created_at !== 'string' || typeof l.updated_at !== 'string') problems.push(`lead ${l.target_number}: created_at/updated_at missing`);
        if (typeof l.research_completeness_score !== 'number') problems.push(`lead ${l.target_number}: research_completeness_score is not a number`);
        if (raw.leads!.includes('\\u0000')) {
          problems.push(`${SOURCE_FILES.leads}: contains a NUL character, which Postgres jsonb cannot store`);
          break;
        }
      }
    }
  }

  let suppression: SuppressionEntry[] = [];
  const parsedSup = parse(SOURCE_FILES.suppression, raw.suppression!);
  if (parsedSup !== undefined) {
    if (!Array.isArray(parsedSup)) problems.push(`${SOURCE_FILES.suppression}: not a JSON array`);
    else {
      problems.push(...suppressionEntryProblems(parsedSup).map(x => `${SOURCE_FILES.suppression} ${x}`));
      suppression = parsedSup as SuppressionEntry[];
      suppression.forEach((e, i) => {
        if (typeof e.reason !== 'string' || typeof e.source !== 'string' || typeof e.suppressed_at !== 'string') {
          problems.push(`${SOURCE_FILES.suppression} entry #${i + 1}: reason/source/suppressed_at must be strings`);
        }
      });
    }
  }

  const events: AnalyticsEvent[] = [];
  const seenEventIds = new Set<string>();
  raw.events!.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const e = JSON.parse(line) as AnalyticsEvent;
      if (typeof e.event_id !== 'string' || !e.event_id) problems.push(`${SOURCE_FILES.events} line ${i + 1}: missing event_id`);
      else if (seenEventIds.has(e.event_id)) problems.push(`${SOURCE_FILES.events} line ${i + 1}: duplicate event_id`);
      else seenEventIds.add(e.event_id);
      if (typeof e.event_type !== 'string' || typeof e.channel !== 'string' || typeof e.actor !== 'string' || typeof e.timestamp !== 'string') {
        problems.push(`${SOURCE_FILES.events} line ${i + 1}: event_type/channel/actor/timestamp must be strings`);
      }
      if (!e.payload || typeof e.payload !== 'object' || Array.isArray(e.payload)) problems.push(`${SOURCE_FILES.events} line ${i + 1}: payload must be an object`);
      events.push(e);
    } catch {
      problems.push(`${SOURCE_FILES.events} line ${i + 1}: not valid JSON (a truncated line is not silently dropped during migration)`);
    }
  });

  if (problems.length) throw new MigrationSourceError(problems);

  return {
    dir,
    leads,
    suppression,
    events,
    fileSha256: Object.fromEntries(Object.keys(SOURCE_FILES).map(k => [k, sha256(raw[k as keyof typeof raw]!)])),
    leadRecordSha256: new Map(leads.map(l => [l.lead_id, canonicalSha256(l)])),
  };
}
