import { and, eq } from 'drizzle-orm';
import * as schema from '../db/schema/index';
import { recordAudit } from '../audit/audit';
import type { Actor } from '../authz/authorize';
import { writeRefusal } from '../repo/phase';
import type { Db } from '../leads/locks';
import { containsVerbatim, normalizeForMatch } from './fetch';

/**
 * HUMAN EVIDENCE REVIEW (CAP-7, ADR-024) — the only way a claim reaches SUPPORTED or CONTRADICTED.
 *
 * A reviewer reads the page the fetcher retrieved and says one of three things:
 *
 *   SUPPORTS       — and quotes the passage that says so. The quote must appear VERBATIM in the stored retrieval
 *                    (whitespace aside): a reviewer can choose what to quote, never invent it.
 *   NOT_SUPPORTED  — the page exists but does not state the claim. The claim stays RETRIEVED, with the reason.
 *   CONTRADICTS    — and quotes the passage that contradicts it. Recorded as a NEW evidence row pointing at the
 *                    claim (core's CONTRADICTED); the original is closed as not supported.
 *
 * A review never changes the lead. If the evidence should change what the lead says — a phone now sourced, a fit
 * now rejected — the reviewer records that separately, as an attributed `lead.research_recorded` write.
 * Reviewed rows are final (database guard); a new judgement is a new row.
 */

export const REVIEW_VERDICTS = ['SUPPORTS', 'NOT_SUPPORTED', 'CONTRADICTS'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export type ReviewResult = { ok: true; message: string } | { ok: false; error: string };

const MAX_EXCERPT = 2000;

export async function reviewEvidence(
  db: Db,
  actor: Actor,
  raw: { evidenceId: unknown; verdict: unknown; excerpt?: unknown; note?: unknown },
  env: Record<string, string | undefined> = process.env
): Promise<ReviewResult> {
  // Reading the retrieved page means reading whatever contact details it shows, so both permissions are required.
  const lacking = (['evidence.review', 'lead.view_contacts'] as const).filter(p => !actor.permissions.has(p));
  if (lacking.length) return { ok: false, error: `Not permitted: ${lacking.join(', ')}.` };
  const refused = writeRefusal(env);
  if (refused) return { ok: false, error: refused };

  const evidenceId = String(raw.evidenceId ?? '').trim();
  const verdict = String(raw.verdict ?? '').trim().toUpperCase() as ReviewVerdict;
  if (!(REVIEW_VERDICTS as readonly string[]).includes(verdict)) return { ok: false, error: 'Choose SUPPORTS, NOT_SUPPORTED or CONTRADICTS.' };
  const excerpt = raw.excerpt ? normalizeForMatch(String(raw.excerpt)).slice(0, MAX_EXCERPT + 1) : '';
  const note = raw.note ? String(raw.note).trim().slice(0, 1000) : '';
  if (excerpt.length > MAX_EXCERPT) return { ok: false, error: `An excerpt is at most ${MAX_EXCERPT} characters; quote the sentence that matters.` };
  if ((verdict === 'SUPPORTS' || verdict === 'CONTRADICTS') && !excerpt) return { ok: false, error: 'Quote the passage from the retrieved page.' };
  if (verdict === 'NOT_SUPPORTED' && !note) return { ok: false, error: 'Say why the page does not support the claim.' };

  return db.transaction(async tx => {
    const [row] = await tx.select().from(schema.leadEvidence).where(eq(schema.leadEvidence.id, evidenceId)).for('update');
    if (!row) return { ok: false as const, error: 'That evidence does not exist.' };
    if (row.reviewStatus !== 'UNREVIEWED') return { ok: false as const, error: `Already reviewed (${row.reviewStatus}) by ${row.reviewedByLabel ?? 'someone'}; record a new judgement as new evidence.` };
    if (row.contradictsEvidenceId) return { ok: false as const, error: 'A contradiction record is itself final.' };
    if (!row.retrievalId) return { ok: false as const, error: 'This source has not been retrieved yet. Run evidence:fetch first — nobody can quote a page that was never read.' };
    const [retrieval] = await tx.select().from(schema.evidenceRetrieval).where(eq(schema.evidenceRetrieval.id, row.retrievalId));
    if (!retrieval || retrieval.outcome !== 'OK' || !retrieval.textContent) return { ok: false as const, error: 'The linked retrieval holds no page text.' };
    if (excerpt && !containsVerbatim(retrieval.textContent, excerpt)) {
      return { ok: false as const, error: 'That excerpt does not appear in the retrieved page. Copy the passage exactly as the page shows it (at least 8 characters).' };
    }

    const now = new Date();
    const who = { reviewedByUserId: actor.userId, reviewedByLabel: actor.name, reviewedAt: now };
    if (verdict === 'SUPPORTS') {
      await tx
        .update(schema.leadEvidence)
        .set({ ...who, reviewStatus: 'CHECKED', supportingExcerpt: excerpt, validator: 'HUMAN', reviewNote: note || null })
        .where(and(eq(schema.leadEvidence.id, row.id), eq(schema.leadEvidence.reviewStatus, 'UNREVIEWED')));
    } else {
      await tx
        .update(schema.leadEvidence)
        .set({ ...who, reviewStatus: 'REJECTED', reviewNote: verdict === 'CONTRADICTS' ? `Contradicted by the retrieved page. ${note}`.trim() : note })
        .where(and(eq(schema.leadEvidence.id, row.id), eq(schema.leadEvidence.reviewStatus, 'UNREVIEWED')));
    }
    let contradictionId: string | null = null;
    if (verdict === 'CONTRADICTS') {
      const [c] = await tx
        .insert(schema.leadEvidence)
        .values({
          leadId: row.leadId,
          field: row.field,
          claimValue: null,
          sourceUrl: retrieval.finalUrl ?? row.sourceUrl,
          sourceType: row.sourceType,
          observedAt: retrieval.fetchedAt.toISOString(),
          origin: 'HUMAN_RECORD',
          validator: 'HUMAN',
          retrievalId: retrieval.id,
          supportingExcerpt: excerpt,
          contradictsEvidenceId: row.id,
          recordedByUserId: actor.userId,
          recordedByLabel: actor.name,
          ...who,
          reviewStatus: 'CHECKED',
          reviewNote: note || null,
        })
        .returning({ id: schema.leadEvidence.id });
      contradictionId = c.id;
    }
    await recordAudit(tx, {
      actor: { userId: actor.userId, label: actor.name },
      action: verdict === 'CONTRADICTS' ? 'evidence.contradiction_recorded' : 'evidence.reviewed',
      target: { type: 'lead_evidence', id: row.id },
      // The field and verdict, never the excerpt: the page may quote a phone number or an email address.
      metadata: { leadId: row.leadId, field: row.field, verdict, retrievalId: retrieval.id, contradictionId, excerptChars: excerpt.length },
    });
    const message =
      verdict === 'SUPPORTS'
        ? 'Recorded: the retrieved page supports this claim (SUPPORTED). The lead itself is unchanged — record any provenance change separately.'
        : verdict === 'CONTRADICTS'
          ? 'Recorded: the retrieved page contradicts this claim (CONTRADICTED). The lead itself is unchanged — correct it with a research record if needed.'
          : 'Recorded: the page does not support this claim. It stays RETRIEVED.';
    return { ok: true as const, message };
  });
}
