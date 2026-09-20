/**
 * BULK RE-EVALUATION — `npm --prefix os run leads:reevaluate` (ADR-020).
 *
 * Re-derives qualification, scores, readiness and next action for every canonical lead, exactly as
 * `npm run leads:refresh` did before cutover, and records each result in `lead_evaluation`.
 *
 *   - DRY RUN by default: prints what would change and a plan digest; writes nothing.
 *   - `--apply --confirm=<digest> --actor="<your name>"` writes it. The digest binds the apply to the exact state the
 *     dry run showed; if any lead moved in between, the apply refuses and nothing is written.
 *   - One transaction per lead, so an interrupted run leaves a consistent prefix and a rerun converges.
 *   - Idempotent: a second run finds nothing to change and writes nothing.
 *
 * Reads DATABASE_URL from os/.env.local when not exported (like every operator database command).
 */
import { asc, eq, and } from 'drizzle-orm';
import type { KachmoLead } from '@kachmo/core/leads/schema.js';
import * as schema from '../db/schema/index';
import { recordAudit } from '../audit/audit';
import { canonicalJson, sha256 } from '../db/migration/canonical';
import { resolveCutoverPhase, leadWritesEnabled } from '../repo/phase';
import { readTitanState, ledgerLookup } from '../repo/titan-ledger';
import { lockCanonicalWrites, type Db } from './locks';
import { reevaluateLead, engineRef } from './reevaluate';
import { appendEvents, assertWritable, insertEvaluation, readSuppressionInTx, writeLeadVersion, LeadWriteRefusal } from './mutate';
import { assertHumanLabel } from './actor-binding';

export interface ReevaluationItem {
  leadId: string;
  targetNumber: string;
  version: number;
  /** Fields re-evaluation would change. Empty when the stored record is already current. */
  changedFields: string[];
  /** No evaluation with this input and engine is recorded yet. */
  needsEvaluation: boolean;
  /** What the lead would become, minus its timestamp — part of the digest. */
  nextSha256: string;
}

export interface ReevaluationPlan {
  engineRef: string;
  items: ReevaluationItem[];
  toWrite: number;
  toRecordOnly: number;
  digest: string;
}

const withoutTimestamp = (l: KachmoLead): Record<string, unknown> => {
  const rest: Record<string, unknown> = { ...l };
  delete rest.updated_at;
  return rest;
};

export async function planReevaluation(db: Db, opts: { ledger?: (tn: string) => string | null; now?: string } = {}): Promise<ReevaluationPlan> {
  const ledger = opts.ledger ?? ledgerLookup(readTitanState().tracker);
  const now = opts.now ?? new Date().toISOString();
  const ref = engineRef();
  const rows = await db.select().from(schema.lead).orderBy(asc(schema.lead.targetNumber));
  const suppression = await readSuppressionInTx(db);
  const recorded = await db.select({ leadId: schema.leadEvaluation.leadId, inputSha256: schema.leadEvaluation.inputSha256 }).from(schema.leadEvaluation).where(eq(schema.leadEvaluation.engineRef, ref));
  const seen = new Set(recorded.map(r => `${r.leadId}|${r.inputSha256}`));

  const items: ReevaluationItem[] = rows.map(row => {
    const lead = row.record as KachmoLead;
    const re = reevaluateLead(lead, { suppression, ledgerStatus: ledger(lead.target_number), now });
    return {
      leadId: row.leadId,
      targetNumber: row.targetNumber,
      version: row.version,
      changedFields: re.changedFields.filter(f => f !== 'updated_at'),
      needsEvaluation: !seen.has(`${row.leadId}|${re.evaluation.inputSha256}`),
      nextSha256: sha256(canonicalJson(withoutTimestamp(re.next))),
    };
  });
  const toWrite = items.filter(i => i.changedFields.length).length;
  const toRecordOnly = items.filter(i => !i.changedFields.length && i.needsEvaluation).length;
  const digest = sha256(canonicalJson({ engineRef: ref, items: items.filter(i => i.changedFields.length || i.needsEvaluation) })).slice(0, 16);
  return { engineRef: ref, items, toWrite, toRecordOnly, digest };
}

export interface ReevaluationResult {
  plan: ReevaluationPlan;
  applied: boolean;
  written: number;
  recorded: number;
  message: string;
}

export async function runReevaluation(
  db: Db,
  opts: { apply: boolean; confirm?: string; actor: string; env?: Record<string, string | undefined>; ledger?: (tn: string) => string | null; now?: () => Date }
): Promise<ReevaluationResult> {
  const env = opts.env ?? process.env;
  const phase = resolveCutoverPhase(env);
  const clock = opts.now ?? (() => new Date());
  const ledger = opts.ledger ?? ledgerLookup(readTitanState().tracker);
  const plan = await planReevaluation(db, { ledger, now: clock().toISOString() });

  if (!opts.apply) {
    return { plan, applied: false, written: 0, recorded: 0, message: plan.toWrite + plan.toRecordOnly ? `DRY RUN — nothing written. To apply: --apply --confirm=${plan.digest} --actor="<your name>"` : 'Every lead is current; nothing to do.' };
  }
  if (!leadWritesEnabled(phase)) throw new Error(`Refusing: no lead writes in ${phase}.`);
  assertHumanLabel(opts.actor);
  if (opts.confirm !== plan.digest) throw new Error(`--confirm must equal the plan digest ${plan.digest} shown by a dry run of this exact state. Nothing was written.`);

  const who = { userId: null, label: opts.actor.trim() };
  const runId = `reeval-${clock().toISOString()}`;
  let written = 0;
  let recorded = 0;

  for (const item of plan.items.filter(i => i.changedFields.length || i.needsEvaluation)) {
    await db.transaction(async tx => {
      await lockCanonicalWrites(tx);
      const [row] = await tx.select().from(schema.lead).where(and(eq(schema.lead.leadId, item.leadId))).for('update');
      if (!row || row.version !== item.version) throw new LeadWriteRefusal('STALE', `lead ${item.targetNumber} changed after the dry run; rerun the dry run. Earlier leads in this run were written.`, false);
      const lead = row.record as KachmoLead;
      const suppression = await readSuppressionInTx(tx);
      const now = clock().toISOString();
      const re = reevaluateLead(lead, { suppression, ledgerStatus: ledger(lead.target_number), now });
      if (sha256(canonicalJson(withoutTimestamp(re.next))) !== item.nextSha256) {
        throw new LeadWriteRefusal('STALE', `lead ${item.targetNumber} would now re-evaluate differently from the dry run; rerun it. Earlier leads in this run were written.`, false);
      }
      if (item.changedFields.length) {
        assertWritable(lead, re.next, phase);
        const version = await writeLeadVersion(tx, row, re.next, 'lead.reevaluated', who);
        await appendEvents(tx, re.events, now);
        await recordAudit(tx, {
          actor: who,
          action: 'lead.reevaluated',
          target: { type: 'lead', id: row.leadId },
          metadata: { runId, targetNumber: row.targetNumber, fieldsChanged: item.changedFields, versionFrom: row.version, versionTo: version, researchState: { from: lead.research_state, to: re.next.research_state }, engineRef: plan.engineRef },
        });
        written++;
      }
      await insertEvaluation(tx, row.leadId, re.evaluation, who);
      recorded++;
    });
  }

  await recordAudit(db, {
    actor: who,
    action: 'lead.reevaluation_run',
    target: { type: 'database', id: null },
    metadata: { runId, digest: plan.digest, engineRef: plan.engineRef, leads: plan.items.length, written, evaluationsRecorded: recorded },
  });
  return { plan, applied: true, written, recorded, message: `applied: ${written} lead(s) rewritten, ${recorded} evaluation(s) recorded` };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1] && /server[\\/]leads[\\/]reevaluate-run\.ts$/.test(process.argv[1])) {
  const { openOperatorDatabase } = await import('./operator-db');
  const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const apply = process.argv.includes('--apply');
  const { db, close, label } = openOperatorDatabase({ writes: apply });
  (async () => {
    console.log(`\n⚖️  Re-evaluation (Methodology v1.0) — target ${label}`);
    const r = await runReevaluation(db, { apply, confirm: arg('confirm'), actor: arg('actor') ?? '' });
    const p = r.plan;
    console.log(`   engine ${p.engineRef} · ${p.items.length} leads · ${p.toWrite} would change · ${p.toRecordOnly} evaluation-only`);
    for (const i of p.items.filter(x => x.changedFields.length)) {
      console.log(`   ${i.targetNumber}  v${i.version}  ${i.changedFields.join(', ')}`);
    }
    if (!r.applied && p.toWrite + p.toRecordOnly) console.log(`\n   plan digest: ${p.digest}`);
    console.log(`\n   ✅ ${r.message}`);
    return 0;
  })()
    .then(code => close().then(() => process.exit(code)))
    .catch(err => {
      console.error(`\n❌ ${(err as Error).message}`);
      close().finally(() => process.exit(1));
    });
}
