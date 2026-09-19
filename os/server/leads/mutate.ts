import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { KachmoLead, SuppressionEntry } from '@kachmo/core/leads/schema.js';
import type { LeadDecision, DomainEvent } from '@kachmo/core/state/decision.js';
import { mayWrite } from '@kachmo/core/reconciliation/ownership.js';
import { findInvariantViolations } from '@kachmo/core/leads/invariants.js';
import { isEquivalentSuppression, outreachBlock } from '@kachmo/core/suppression/match.js';
import * as schema from '../db/schema/index';
import { recordAudit } from '../audit/audit';
import { canonicalSha256 } from '../db/migration/canonical';
import { leadProjection, suppressionEntryFromRow } from '../db/migration/transform';
import { resolveCutoverPhase, writeRefusal, leadWritesEnabled, type CutoverPhase } from '../repo/phase';
import { readTitanState, ledgerLookup } from '../repo/titan-ledger';
import { lockCanonicalWrites, nextSequence, type Db } from './locks';
import { reevaluateLead, changedKeys, engineRef, type EvaluationRecord } from './reevaluate';
import type { EngineActor } from './actor-binding';

/**
 * THE POSTGRES LEAD APPLIER (ADR-019).
 *
 * After cutover this is the only module that updates a canonical lead. It is the Postgres counterpart of
 * `scripts/lib/apply.ts`: it executes a core/ `LeadDecision` — it never decides anything itself.
 *
 * One transaction, in this order, fail-closed at every step:
 *
 *   canonical write lock → lead FOR UPDATE → version check → suppression + ledger read INSIDE the transaction →
 *   core decision → deterministic re-evaluation → ownership check on every changed field → invariants →
 *   revision → lead update → suppression → events → evaluation → audit → commit
 *
 * The decision runs inside the transaction, after the lock, so it always sees the state it changes: a suppression
 * committed a moment earlier is visible to it. Nothing is written unless everything is.
 */

export type MutationActor = { userId: string | null; label: string; engineActor: EngineActor | 'SYSTEM' };

export interface DecisionContext {
  /** IST calendar date, as the CLI uses for notes and due dates. */
  today: string;
  now: string;
  suppression: SuppressionEntry[];
  ledgerStatus: string | null;
}

export interface LeadMutation {
  leadId: string;
  /** The version the operator was looking at. A different stored version refuses — nothing is layered over it. */
  expectedVersion: number | null;
  /** The audit action this write is recorded as (e.g. `lead.call_logged`). */
  action: string;
  actor: MutationActor;
  decide: (lead: KachmoLead, ctx: DecisionContext) => LeadDecision;
  /** Extra, non-contact audit metadata. */
  metadata?: Record<string, unknown>;
  /** Further rows that must commit with this write (e.g. the evidence a research record cites). Same transaction. */
  afterWrite?: (tx: Db, lead: KachmoLead) => Promise<void>;
}

export type RefusalCode = 'WRITES_DISABLED' | 'NOT_FOUND' | 'STALE' | 'DECISION' | 'OWNERSHIP' | 'INVARIANT';

export type MutationResult =
  | { outcome: 'APPLIED'; leadId: string; targetNumber: string; version: number; summary: string; warnings: string[]; changedFields: string[]; suppressionAdded: boolean }
  | { outcome: 'REFUSED'; code: RefusalCode; reason: string };

export interface ApplyOptions {
  env?: Record<string, string | undefined>;
  /**
   * `app` requires the KACHMO_APP_WRITES kill switch; `operator-cli` (a named human running a dry-run-first command
   * against an explicit DATABASE_URL) requires only that Postgres is canonical.
   */
  gate?: 'app' | 'operator-cli';
  /** Injected for tests; defaults to the committed Titan ledger. */
  ledger?: (targetNumber: string) => string | null;
  now?: () => Date;
}

/** Thrown inside the transaction to roll it back; converted to a REFUSED result outside it. */
class Refusal extends Error {
  constructor(
    readonly code: RefusalCode,
    message: string,
    readonly audit: boolean
  ) {
    super(message);
  }
}

export const istToday = (d: Date = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export function gateRefusal(opts: ApplyOptions): string | null {
  const env = opts.env ?? process.env;
  if ((opts.gate ?? 'app') === 'app') return writeRefusal(env);
  const phase = resolveCutoverPhase(env);
  return leadWritesEnabled(phase) ? null : `No lead writes in ${phase}; the canonical store is not Postgres.`;
}

/**
 * The ACTIVE suppression list, in list order (ADR-010: revocation means the person is no longer suppressed).
 *
 * Revoked entries are excluded on purpose, and this matters most for deduplication: a new opt-out that is equivalent
 * only to a REVOKED entry must be inserted as a new active entry. Treating it as "already suppressed" would record
 * nothing the publisher or the dispatch preflight can see — both read active entries only — and the person could be
 * emailed after asking not to be. Every writer, the publisher, verification and the preflight share this meaning.
 */
export async function readSuppressionInTx(tx: Db): Promise<SuppressionEntry[]> {
  const rows = await tx.select().from(schema.suppressionEntry).where(isNull(schema.suppressionEntry.revokedAt)).orderBy(asc(schema.suppressionEntry.sequence));
  return rows.map(suppressionEntryFromRow);
}

/** Refuses any change to a field this store does not own right now (ADR-009). Deny-by-default for unknown fields. */
export function ownershipViolations(fields: string[], phase: CutoverPhase): string[] {
  return fields.map(f => ({ f, r: mayWrite('POSTGRES', f, phase) })).filter(x => !x.r.allowed).map(x => `${x.f}: ${x.r.reason}`);
}

/** Appends analytics events with gap-free sequence numbers. Call only while holding the canonical write lock. */
export async function appendEvents(tx: Db, events: DomainEvent[], occurredAt: string): Promise<number> {
  let seq = await nextSequence(tx, 'analytics_event');
  for (const e of events) {
    const event = { ...e };
    delete event.only_if_suppression_added;
    await tx.insert(schema.analyticsEvent).values({
      eventId: randomUUID(),
      sequence: seq++,
      leadId: event.lead_id ?? null,
      targetNumber: event.target_number ?? null,
      companyName: event.company_name ?? null,
      eventType: event.event_type,
      channel: event.channel,
      actor: event.actor,
      occurredAt,
      payload: event.payload,
    });
  }
  return events.length;
}

/**
 * Adds a suppression entry unless an equivalent one exists (the CLI's `addSuppression` rule). Returns whether it
 * was inserted. Call only while holding the canonical write lock.
 */
export async function insertSuppression(tx: Db, entry: SuppressionEntry, existing: SuppressionEntry[], createdByUserId: string | null): Promise<boolean> {
  if (existing.some(e => isEquivalentSuppression(e, entry))) return false;
  await tx.insert(schema.suppressionEntry).values({
    sequence: await nextSequence(tx, 'suppression_entry'),
    leadId: entry.lead_id ?? null,
    targetNumber: entry.target_number ?? null,
    companyName: entry.company_name ?? null,
    email: entry.email ?? null,
    phone: entry.phone ?? null,
    domain: entry.domain ?? null,
    reason: entry.reason,
    suppressedAt: entry.suppressed_at,
    source: entry.source,
    createdByUserId,
  });
  existing.push(entry);
  return true;
}

/** The methodology core/ implements. An evaluation is attributed to it, and only while it is the ACTIVE one. */
export const ENGINE_METHODOLOGY = '1.0';

/**
 * Refuses to attribute an evaluation to a methodology the engine does not implement: if an owner ever activates a
 * different version, every write stops until the engine is upgraded, rather than recording 1.0 results as if they
 * were the new methodology's.
 */
async function activeMethodology(tx: Db): Promise<string> {
  const [active] = await tx.select({ id: schema.methodologyVersion.id }).from(schema.methodologyVersion).where(eq(schema.methodologyVersion.status, 'ACTIVE'));
  if (!active) throw new Error('No ACTIVE methodology version is recorded; refusing to write an unattributable evaluation.');
  if (active.id !== ENGINE_METHODOLOGY) throw new Error(`The ACTIVE methodology is ${active.id}, but this engine implements ${ENGINE_METHODOLOGY}; refusing to write.`);
  return active.id;
}

export async function insertEvaluation(tx: Db, leadId: string, evaluation: EvaluationRecord, actor: { userId: string | null; label: string }): Promise<void> {
  await tx.insert(schema.leadEvaluation).values({
    leadId,
    methodologyVersionId: await activeMethodology(tx),
    engineRef: engineRef(),
    inputSha256: evaluation.inputSha256,
    gates: evaluation.gates,
    missingIntelligence: evaluation.missingIntelligence,
    reasons: evaluation.reasons,
    researchState: evaluation.researchState,
    researchCompletenessScore: evaluation.researchCompletenessScore,
    scores: evaluation.scores,
    leadPriority: evaluation.leadPriority,
    priorityConfidence: evaluation.priorityConfidence,
    actorLabel: actor.label,
    actorUserId: actor.userId,
  });
}

type LeadRow = typeof schema.lead.$inferSelect;

/**
 * Writes a new version of a lead: the superseded record goes to `lead_revision`, the lead row is replaced with its
 * projections recomputed from the record, and the version advances — conditional on the version that was read.
 */
export async function writeLeadVersion(tx: Db, row: LeadRow, next: KachmoLead, supersededBy: string, actor: { userId: string | null; label: string }): Promise<number> {
  await tx.insert(schema.leadRevision).values({
    leadId: row.leadId,
    version: row.version,
    record: row.record,
    recordSha256: row.recordSha256,
    supersededBy,
    writtenByUserId: actor.userId,
    writtenByLabel: actor.label,
  });
  const updated = await tx
    .update(schema.lead)
    .set({ ...leadProjection(next), record: next, recordSha256: canonicalSha256(next), version: row.version + 1 })
    .where(and(eq(schema.lead.leadId, row.leadId), eq(schema.lead.version, row.version)))
    .returning({ version: schema.lead.version });
  if (!updated.length) throw new Refusal('STALE', 'That lead changed while this write was being made. Reload and try again.', false);
  return updated[0].version;
}

/**
 * Checks a proposed next state: ownership of every changed field, then the invariants every persistence adapter
 * must refuse. Throws a Refusal — nothing is written.
 */
export function assertWritable(before: KachmoLead, after: KachmoLead, phase: CutoverPhase): string[] {
  const fields = changedKeys(before, after);
  const denied = ownershipViolations(fields, phase);
  if (denied.length) throw new Refusal('OWNERSHIP', `This write would change fields Postgres does not own: ${denied.join('; ')}`, true);
  const violations = findInvariantViolations([after]);
  if (violations.length) throw new Refusal('INVARIANT', `Refused — the lead would be left in an impossible state: ${violations.join('; ')}`, false);
  return fields;
}

export async function applyLeadMutation(db: Db, m: LeadMutation, opts: ApplyOptions = {}): Promise<MutationResult> {
  const blocked = gateRefusal(opts);
  if (blocked) return { outcome: 'REFUSED', code: 'WRITES_DISABLED', reason: blocked };

  const env = opts.env ?? process.env;
  const phase = resolveCutoverPhase(env);
  const clock = opts.now ?? (() => new Date());
  const ledger = opts.ledger ?? ledgerLookup(readTitanState().tracker);
  const who = { userId: m.actor.userId, label: m.actor.label };

  try {
    return await db.transaction(async tx => {
      await lockCanonicalWrites(tx);
      const [row] = await tx.select().from(schema.lead).where(eq(schema.lead.leadId, m.leadId)).for('update');
      if (!row) throw new Refusal('NOT_FOUND', 'That lead does not exist.', false);
      if (m.expectedVersion !== null && row.version !== m.expectedVersion) {
        throw new Refusal('STALE', `That lead changed since you opened it (version ${m.expectedVersion} → ${row.version}). Reload and check before acting again.`, false);
      }

      const lead = row.record as KachmoLead;
      const nowDate = clock();
      const ctx: DecisionContext = { today: istToday(nowDate), now: nowDate.toISOString(), suppression: await readSuppressionInTx(tx), ledgerStatus: ledger(lead.target_number) };

      const decision = m.decide(structuredClone(lead), ctx);
      if (decision.refusal) {
        // A refusal on a lead that is blocked from outreach is safety-relevant and is recorded; a mistyped input is not.
        throw new Refusal('DECISION', decision.refusal, outreachBlock(lead, ctx.suppression, ctx.ledgerStatus).blocked);
      }

      // The decision's patch, then the suppression it carries (so re-evaluation sees it), then re-evaluation.
      const patched = { ...structuredClone(lead), ...decision.patch } as KachmoLead;
      let suppressionAdded = false;
      if (decision.suppression) suppressionAdded = await insertSuppression(tx, decision.suppression, ctx.suppression, m.actor.userId);
      const re = reevaluateLead(patched, { suppression: ctx.suppression, ledgerStatus: ctx.ledgerStatus, now: ctx.now });

      const changedFields = assertWritable(lead, re.next, phase);
      const version = await writeLeadVersion(tx, row, re.next, m.action, who);

      const events = decision.events.filter(e => !e.only_if_suppression_added || suppressionAdded);
      await appendEvents(tx, [...events, ...re.events], ctx.now);
      await insertEvaluation(tx, row.leadId, re.evaluation, who);
      if (m.afterWrite) await m.afterWrite(tx, re.next);

      await recordAudit(tx, {
        actor: who,
        action: m.action,
        target: { type: 'lead', id: row.leadId },
        metadata: {
          ...m.metadata,
          targetNumber: lead.target_number,
          engineActor: m.actor.engineActor,
          versionFrom: row.version,
          versionTo: version,
          fieldsChanged: changedFields,
          researchState: { from: lead.research_state, to: re.next.research_state },
          suppressionAdded,
          events: [...events, ...re.events].map(e => e.event_type),
          warnings: decision.warnings.length,
        },
      });

      return {
        outcome: 'APPLIED' as const,
        leadId: row.leadId,
        targetNumber: lead.target_number,
        version,
        summary: decision.summary,
        warnings: decision.warnings,
        changedFields,
        suppressionAdded,
      };
    });
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    if (e.audit) await auditRefusal(db, m, e);
    return { outcome: 'REFUSED', code: e.code, reason: e.message };
  }
}

/**
 * Records a safety-relevant refusal. Runs AFTER the rolled-back transaction, in its own, because an unaudited
 * refusal is indistinguishable from the attempt never having happened. Never masks the refusal itself.
 */
export async function auditRefusal(db: Db, m: Pick<LeadMutation, 'leadId' | 'action' | 'actor' | 'metadata'>, e: { code: RefusalCode; message: string }): Promise<void> {
  try {
    await recordAudit(db, {
      actor: { userId: m.actor.userId, label: m.actor.label },
      action: e.code === 'OWNERSHIP' ? 'lead.ownership_violation' : 'lead.write_refused',
      target: { type: 'lead', id: m.leadId },
      metadata: { ...m.metadata, attempted: m.action, code: e.code, reason: e.message.slice(0, 500), engineActor: m.actor.engineActor },
    });
  } catch {
    // The refusal already protected the data; an audit failure must not turn it into a crash.
  }
}

export { Refusal as LeadWriteRefusal };
