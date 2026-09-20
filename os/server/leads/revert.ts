/**
 * `npm --prefix os run leads:revert -- --lead=<target> --to-version=<n> [--apply --confirm=<digest> --actor="<name>"]`
 * (ADR-022).
 *
 * Undoes a mistaken write by restoring the record a lead had at an earlier version — FORWARD ONLY: the restored
 * record becomes a new version on top, and every version in between stays in `lead_revision`. History is never
 * rewritten; a revert is itself an audited write.
 *
 * It refuses when:
 *   - any version in the range changed suppression (`do_not_contact`, `suppression_reason`): a revert must never
 *     un-suppress anyone. Lifting a suppression is a separate, attributed revocation, not an undo;
 *   - the target version is not older than the current one, or does not exist;
 *   - the lead moved after the dry run (the digest binds the apply to the exact state shown).
 *
 * The restored record is re-evaluated by the engine against today's suppression list and ledger, and passes the same
 * ownership and invariant checks as any other write. Dry run by default.
 */
import { and, asc, eq, gte } from 'drizzle-orm';
import type { KachmoLead } from '@kachmo/core/leads/schema.js';
import { FIELD_OWNERSHIP } from '@kachmo/core/reconciliation/ownership.js';
import * as schema from '../db/schema/index';
import { recordAudit } from '../audit/audit';
import { canonicalJson, sha256 } from '../db/migration/canonical';
import { resolveCutoverPhase, leadWritesEnabled } from '../repo/phase';
import { readTitanState, ledgerLookup } from '../repo/titan-ledger';
import { lockCanonicalWrites, type Db } from './locks';
import { reevaluateLead, changedKeys } from './reevaluate';
import { appendEvents, assertWritable, insertEvaluation, readSuppressionInTx, writeLeadVersion } from './mutate';
import { assertHumanLabel } from './actor-binding';

const SUPPRESSION_FIELDS = FIELD_OWNERSHIP.find(g => g.group === 'SUPPRESSION')!.fields;

export interface RevertPlan {
  leadId: string;
  targetNumber: string;
  fromVersion: number;
  toVersion: number;
  /** Fields the revert would change on the current record. */
  fieldsChanged: string[];
  refusal: string | null;
  digest: string;
}

async function recordsInRange(db: Db, leadId: string, fromVersion: number): Promise<Map<number, KachmoLead>> {
  const revisions = await db.select().from(schema.leadRevision).where(and(eq(schema.leadRevision.leadId, leadId), gte(schema.leadRevision.version, fromVersion))).orderBy(asc(schema.leadRevision.version));
  return new Map(revisions.map(r => [r.version, r.record as KachmoLead]));
}

export async function planRevert(db: Db, input: { targetNumber: string; toVersion: number; now?: string; ledger?: (tn: string) => string | null }): Promise<RevertPlan> {
  const tn = input.targetNumber.padStart(3, '0');
  const [row] = await db.select().from(schema.lead).where(eq(schema.lead.targetNumber, tn));
  const empty = (refusal: string): RevertPlan => ({ leadId: row?.leadId ?? '', targetNumber: tn, fromVersion: row?.version ?? 0, toVersion: input.toVersion, fieldsChanged: [], refusal, digest: '' });
  if (!row) return empty(`No lead ${tn}.`);
  if (!Number.isInteger(input.toVersion) || input.toVersion < 1 || input.toVersion >= row.version) return empty(`--to-version must be an earlier version (1–${row.version - 1}); the lead is at version ${row.version}.`);

  const history = await recordsInRange(db, row.leadId, input.toVersion);
  history.set(row.version, row.record as KachmoLead);
  for (let v = input.toVersion; v <= row.version; v++) if (!history.has(v)) return empty(`Version ${v} of ${tn} is not in lead_revision; nothing can be restored across it.`);

  for (let v = input.toVersion; v < row.version; v++) {
    const touched = changedKeys(history.get(v)!, history.get(v + 1)!).filter(f => SUPPRESSION_FIELDS.includes(f));
    if (touched.length) return empty(`Refused: version ${v + 1} changed suppression (${touched.join(', ')}). A revert never un-suppresses anyone; lifting a suppression is a separate, attributed revocation.`);
  }

  const suppression = await readSuppressionInTx(db);
  const ledger = input.ledger ?? ledgerLookup(readTitanState().tracker);
  const restored = reevaluateLead(structuredClone(history.get(input.toVersion)!), { suppression, ledgerStatus: ledger(tn), now: input.now ?? new Date().toISOString() }).next;
  const fieldsChanged = changedKeys(row.record as KachmoLead, restored).filter(f => f !== 'updated_at');
  const digest = sha256(canonicalJson({ leadId: row.leadId, fromVersion: row.version, toVersion: input.toVersion, current: row.recordSha256, fieldsChanged })).slice(0, 16);
  return { leadId: row.leadId, targetNumber: tn, fromVersion: row.version, toVersion: input.toVersion, fieldsChanged, refusal: null, digest };
}

export async function runRevert(
  db: Db,
  opts: { targetNumber: string; toVersion: number; apply: boolean; confirm?: string; actor: string; env?: Record<string, string | undefined>; ledger?: (tn: string) => string | null; now?: () => Date }
): Promise<{ plan: RevertPlan; applied: boolean; version: number | null; message: string }> {
  const clock = opts.now ?? (() => new Date());
  const ledger = opts.ledger ?? ledgerLookup(readTitanState().tracker);
  const plan = await planRevert(db, { targetNumber: opts.targetNumber, toVersion: opts.toVersion, now: clock().toISOString(), ledger });
  if (plan.refusal) return { plan, applied: false, version: null, message: plan.refusal };
  // Derived fields follow their inputs, so restoring a version whose INPUTS are already current changes nothing.
  // Writing a version that changes no field would add an empty revision and an audit row that record nothing.
  if (!plan.fieldsChanged.length) {
    return { plan: { ...plan, refusal: `Nothing to revert: ${plan.targetNumber} already holds the content of version ${plan.toVersion}.` }, applied: false, version: null, message: `Nothing to revert: ${plan.targetNumber} already holds the content of version ${plan.toVersion}.` };
  }
  if (!opts.apply) return { plan, applied: false, version: null, message: `DRY RUN — nothing written. To apply: --apply --confirm=${plan.digest} --actor="<your name>"` };

  const phase = resolveCutoverPhase(opts.env ?? process.env);
  if (!leadWritesEnabled(phase)) throw new Error(`Refusing: no lead writes in ${phase}.`);
  assertHumanLabel(opts.actor);
  if (opts.confirm !== plan.digest) throw new Error(`--confirm must equal the plan digest ${plan.digest} shown by a dry run of this exact state. Nothing was written.`);
  const who = { userId: null, label: opts.actor.trim() };

  const version = await db.transaction(async tx => {
    await lockCanonicalWrites(tx);
    const [row] = await tx.select().from(schema.lead).where(eq(schema.lead.leadId, plan.leadId)).for('update');
    if (!row || row.version !== plan.fromVersion) throw new Error(`${plan.targetNumber} changed after the dry run; nothing was written. Run the dry run again.`);
    const [target] = await tx.select().from(schema.leadRevision).where(and(eq(schema.leadRevision.leadId, plan.leadId), eq(schema.leadRevision.version, plan.toVersion)));
    const now = clock().toISOString();
    const suppression = await readSuppressionInTx(tx);
    const re = reevaluateLead(structuredClone(target.record as KachmoLead), { suppression, ledgerStatus: ledger(plan.targetNumber), now });
    // The restored record keeps the time of the revert, so "last changed" never runs backwards.
    const next = { ...re.next, updated_at: now };
    const fields = assertWritable(row.record as KachmoLead, next, phase);
    const v = await writeLeadVersion(tx, row, next, 'lead.reverted', who);
    await appendEvents(tx, re.events, now);
    await insertEvaluation(tx, row.leadId, re.evaluation, who);
    await recordAudit(tx, {
      actor: who,
      action: 'lead.reverted',
      target: { type: 'lead', id: row.leadId },
      metadata: { targetNumber: plan.targetNumber, fromVersion: plan.fromVersion, restoredVersion: plan.toVersion, newVersion: v, fieldsChanged: fields, digest: plan.digest },
    });
    return v;
  });
  return { plan, applied: true, version, message: `restored ${plan.targetNumber} to the content of version ${plan.toVersion}, as new version ${version}` };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1] && /server[\\/]leads[\\/]revert\.ts$/.test(process.argv[1])) {
  const { openOperatorDatabase } = await import('./operator-db');
  const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const { db, close, label } = openOperatorDatabase({ writes: process.argv.includes('--apply') });
  (async () => {
    console.log(`\n⏪ Lead revert — target ${label}`);
    const r = await runRevert(db, { targetNumber: arg('lead') ?? '', toVersion: Number(arg('to-version')), apply: process.argv.includes('--apply'), confirm: arg('confirm'), actor: arg('actor') ?? '' });
    if (!r.plan.refusal) console.log(`   ${r.plan.targetNumber}: v${r.plan.fromVersion} → content of v${r.plan.toVersion}; fields: ${r.plan.fieldsChanged.join(', ') || 'none'}`);
    if (!r.applied && !r.plan.refusal) console.log(`\n   plan digest: ${r.plan.digest}`);
    console.log(`\n   ${r.plan.refusal ? '⛔' : '✅'} ${r.message}`);
    return r.plan.refusal ? 1 : 0;
  })()
    .then(code => close().then(() => process.exit(code)))
    .catch(err => {
      console.error(`\n❌ ${(err as Error).message}`);
      close().finally(() => process.exit(1));
    });
}
