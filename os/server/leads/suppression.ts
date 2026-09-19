import { asc } from 'drizzle-orm';
import type { KachmoLead } from '@kachmo/core/leads/schema.js';
import { planSuppression, scheduledQueueConflicts } from '@kachmo/core/state/suppression-propagation.js';
import * as schema from '../db/schema/index';
import { recordAudit } from '../audit/audit';
import { resolveCutoverPhase } from '../repo/phase';
import { readTitanState, ledgerLookup } from '../repo/titan-ledger';
import { lockCanonicalWrites, type Db } from './locks';
import { reevaluateLead } from './reevaluate';
import {
  appendEvents,
  assertWritable,
  auditRefusal,
  gateRefusal,
  insertEvaluation,
  insertSuppression,
  LeadWriteRefusal,
  readSuppressionInTx,
  writeLeadVersion,
  type ApplyOptions,
  type MutationActor,
  type RefusalCode,
} from './mutate';

/**
 * RECORDING AN OPT-OUT (CAP-3, the first post-cutover suppression writer).
 *
 * A suppression is the one operation that must never be partially applied: the entry, the do-not-contact flag on
 * EVERY lead it reaches, the re-derived state of those leads and the events are decided by core's
 * `planSuppression` and committed together, under the canonical write lock — so a candidate approval or a call log
 * racing it either sees it or is refused.
 *
 * This writes Postgres only. The email cron reads the committed database/suppression.json, which the ADR-010
 * publisher derives; dispatch is blocked (fail-closed) until that publish is verified. The result says so.
 */

export interface SuppressionInput {
  reason: string;
  /** Suppress a known lead and every identifier on it… */
  leadId?: string | null;
  /** …or a bare identifier. */
  email?: string | null;
  phone?: string | null;
  domain?: string | null;
}

export type SuppressionResult =
  | { outcome: 'APPLIED'; added: boolean; affected: string[]; scheduledConflicts: string[]; message: string }
  | { outcome: 'REFUSED'; code: RefusalCode; reason: string };

export async function createSuppression(db: Db, actor: MutationActor, input: SuppressionInput, opts: ApplyOptions = {}): Promise<SuppressionResult> {
  const blocked = gateRefusal(opts);
  if (blocked) return { outcome: 'REFUSED', code: 'WRITES_DISABLED', reason: blocked };
  if (actor.engineActor === 'SYSTEM') return { outcome: 'REFUSED', code: 'DECISION', reason: 'A suppression is recorded by a named person, never by the system.' };

  const env = opts.env ?? process.env;
  const phase = resolveCutoverPhase(env);
  const nowDate = (opts.now ?? (() => new Date()))();
  const now = nowDate.toISOString();
  const titan = readTitanState();
  const ledger = opts.ledger ?? ledgerLookup(titan.tracker);
  const who = { userId: actor.userId, label: actor.label };

  try {
    const result = await db.transaction(async tx => {
      await lockCanonicalWrites(tx);
      const rows = await tx.select().from(schema.lead).orderBy(asc(schema.lead.targetNumber)).for('update');
      const leads = rows.map(r => r.record as KachmoLead);

      let target: KachmoLead | null = null;
      if (input.leadId) {
        target = leads.find(l => l.lead_id === input.leadId) ?? null;
        if (!target) throw new LeadWriteRefusal('NOT_FOUND', 'That lead does not exist.', false);
      }
      const plan = planSuppression(leads, { reason: input.reason.trim(), by: actor.engineActor as 'DEV' | 'AADI', lead: target, email: input.email ?? null, phone: input.phone ?? null, domain: input.domain ?? null }, now);
      if (plan.refusal || !plan.entry) throw new LeadWriteRefusal('DECISION', plan.refusal ?? 'Nothing to suppress.', false);

      // Provenance: this entry was recorded in the Outbound OS, not by the legacy CLI.
      const entry = { ...plan.entry, source: `outbound-os suppression.create (${actor.engineActor})` };
      const suppression = await readSuppressionInTx(tx);
      const added = await insertSuppression(tx, entry, suppression, actor.userId);

      // Exactly as suppress:add does: every matching lead is flagged, whether or not the entry itself was new.
      const affected: string[] = [];
      for (const { lead, patch } of plan.affected) {
        const row = rows.find(r => r.leadId === lead.lead_id)!;
        const patched = { ...structuredClone(row.record as KachmoLead), ...patch } as KachmoLead;
        const re = reevaluateLead(patched, { suppression, ledgerStatus: ledger(lead.target_number), now });
        assertWritable(row.record as KachmoLead, re.next, phase);
        await writeLeadVersion(tx, row, re.next, 'suppression.created', who);
        await appendEvents(
          tx,
          [
            { lead_id: lead.lead_id, target_number: lead.target_number, company_name: lead.company_name, event_type: 'SUPPRESSION_ADDED', channel: 'SYSTEM', actor: actor.engineActor, payload: { new_entry: added } },
            ...re.events,
          ],
          now
        );
        await insertEvaluation(tx, row.leadId, re.evaluation, who);
        affected.push(lead.target_number);
      }

      const conflicts = scheduledQueueConflicts(
        titan.scheduled.map(s => ({ targetNumber: s.targetNumber, to: s.to })),
        entry,
        new Set(affected)
      );

      await recordAudit(tx, {
        actor: who,
        action: added ? 'suppression.created' : 'suppression.create_duplicate',
        target: input.leadId ? { type: 'lead', id: input.leadId } : { type: 'suppression_entry', id: null },
        metadata: {
          engineActor: actor.engineActor,
          reason: input.reason.trim().slice(0, 300),
          identifiers: { lead: !!input.leadId, email: !!input.email, phone: !!input.phone, domain: !!input.domain },
          affectedTargetNumbers: affected,
          scheduledQueueConflicts: conflicts,
        },
      });
      return { added, affected, conflicts };
    });

    const published = 'It is recorded in Postgres. Titan dispatch stays blocked until the next workflow run publishes and verifies it.';
    return {
      outcome: 'APPLIED',
      added: result.added,
      affected: result.affected,
      scheduledConflicts: result.conflicts,
      message:
        `${result.added ? 'Suppression recorded' : 'An equivalent suppression already existed'}; ${result.affected.length} lead(s) flagged do-not-contact${result.affected.length ? ` (${result.affected.join(', ')})` : ''}. ${published}` +
        (result.conflicts.length ? ` Still queued for email: ${result.conflicts.join(', ')} — the dispatch preflight will refuse to send them.` : ''),
    };
  } catch (e) {
    if (!(e instanceof LeadWriteRefusal)) throw e;
    if (e.audit) await auditRefusal(db, { leadId: input.leadId ?? '', action: 'suppression.created', actor }, e);
    return { outcome: 'REFUSED', code: e.code, reason: e.message };
  }
}

/** Active suppression entries, newest first, for the operator's view. Identifiers are returned for masking upstream. */
export async function listSuppression(db: Db, limit = 100) {
  return db.select().from(schema.suppressionEntry).orderBy(asc(schema.suppressionEntry.sequence)).limit(limit);
}
