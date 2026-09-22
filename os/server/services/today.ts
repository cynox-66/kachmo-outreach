import 'server-only';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { selectCallQueue } from '@kachmo/core/queues/calls.js';
import { selectWhatsAppQueue } from '@kachmo/core/queues/whatsapp.js';
import { buildResearchQueue } from '@kachmo/core/research/tasks.js';
import { buildTodayList, TODAY_KINDS, type TodayItem, type TodayKind, type CandidateToReview, type EvidenceToReview } from '@kachmo/core/queues/today.js';
import * as schema from '../db/schema/index';
import { getServer } from '../auth/instance';
import type { Actor } from '../authz/authorize';
import { loadCanonical, ledgerStatusOf, type CanonicalSnapshot } from '../repo/canonical';
import { activeEngineActor } from '../leads/actor-binding';
import { REVIEWABLE_STATUSES } from '../research/service';
import { describeWork, type WorkLine, type Urgency } from './operator';
import { recordFieldForTask } from './research-queue';

/**
 * TODAY (Phase C, ADR-028) — the operating loop's front page.
 *
 * Gathers the inputs core's `buildTodayList` needs: the canonical snapshot, core's call / WhatsApp / research
 * selectors, and — after cutover, from Postgres — the research candidates and retrieved evidence awaiting a person.
 * Everything is read; nothing is stored. Items the actor may not act on are left out rather than shown dead.
 */

export interface TodayView {
  today: string;
  source: 'GIT_JSON' | 'POSTGRES';
  /** The actor's engine identity, when bound: "mine" means items owned by this actor. */
  me: 'DEV' | 'AADI' | null;
  items: Array<TodayItem & { href: string; line: WorkLine }>;
  counts: Record<TodayKind, number>;
  byUrgency: Record<Urgency, number>;
}

const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/**
 * Where each kind of work is done. Email work opens the company, where its email history and the next step are — the
 * email itself is sent from the studio inbox (Titan), never from here. Research opens the right record form.
 */
function hrefFor(i: TodayItem): string {
  const lead = `/leads/${i.targetNumber}`;
  switch (i.kind) {
    case 'CALL_READY':
      return `/calls#call-${i.targetNumber}`;
    case 'WHATSAPP_TO_SEND':
    case 'WHATSAPP_TO_APPROVE':
      return `/whatsapp#wa-${i.targetNumber}`;
    case 'CANDIDATE_REVIEW':
      return `/research/candidates/${i.ref}`;
    case 'EVIDENCE_REVIEW':
    case 'EVIDENCE_RECHECK':
    case 'EVIDENCE_CONTRADICTION':
      return `${lead}#sources`;
    case 'RESEARCH': {
      const next = i.why.find(w => w.startsWith('next task:'))?.slice('next task:'.length).trim();
      const field = next ? recordFieldForTask(next) : null;
      return field ? `${lead}?record=${field}#record` : `${lead}#record`;
    }
    default:
      return lead;
  }
}

/** Which permission a kind of work needs. An item the actor cannot act on is not shown. */
const PERMISSION_FOR: Record<TodayKind, Parameters<Actor['permissions']['has']>[0]> = {
  REPLY_WAITING: 'outreach.email',
  EMAIL_FOLLOW_UP_DUE: 'outreach.email',
  POSITIVE_NO_MEETING: 'pipeline.update',
  EVIDENCE_CONTRADICTION: 'lead.edit',
  EVIDENCE_RECHECK: 'evidence.review',
  FOLLOW_UP_DUE: 'lead.view',
  WHATSAPP_TO_SEND: 'outreach.whatsapp',
  WHATSAPP_TO_APPROVE: 'outreach.whatsapp',
  CALL_READY: 'outreach.call',
  CANDIDATE_REVIEW: 'research.approve',
  EVIDENCE_REVIEW: 'evidence.review',
  RESEARCH: 'lead.edit',
};

export async function getToday(actor: Actor, opts: { mine?: boolean; snapshot?: CanonicalSnapshot } = {}): Promise<TodayView> {
  const snap = opts.snapshot ?? (await loadCanonical());
  const today = istToday();
  const ledger = ledgerStatusOf(snap);
  const { db } = getServer();

  let candidates: CandidateToReview[] = [];
  let evidence: EvidenceToReview[] = [];
  if (snap.source === 'POSTGRES') {
    if (actor.permissions.has('research.approve')) {
      const rows = await db
        .select({ id: schema.researchCandidate.id, company: schema.researchCandidate.companyName, status: schema.researchCandidate.status, createdAt: schema.researchCandidate.createdAt })
        .from(schema.researchCandidate)
        .where(inArray(schema.researchCandidate.status, REVIEWABLE_STATUSES))
        .orderBy(desc(schema.researchCandidate.createdAt))
        .limit(50);
      candidates = rows.map(r => ({ id: r.id, company: r.company ?? '(unnamed candidate)', status: r.status, createdOn: r.createdAt.toISOString().slice(0, 10) }));
    }
    if (actor.permissions.has('evidence.review') && actor.permissions.has('lead.view_contacts')) {
      // Every claim whose evidence has been fetched: unreviewed ones need a first check, reviewed ones need a
      // re-check when the page has changed since (ADR-031), and contradictions need the lead record corrected.
      const rows = await db
        .select({
          id: schema.leadEvidence.id,
          leadId: schema.leadEvidence.leadId,
          field: schema.leadEvidence.field,
          url: schema.leadEvidence.sourceUrl,
          reviewStatus: schema.leadEvidence.reviewStatus,
          contradicts: schema.leadEvidence.contradictsEvidenceId,
          retrievalId: schema.leadEvidence.retrievalId,
          sha: schema.evidenceRetrieval.contentSha256,
          fetchedAt: schema.evidenceRetrieval.fetchedAt,
        })
        .from(schema.leadEvidence)
        .innerJoin(schema.evidenceRetrieval, eq(schema.evidenceRetrieval.id, schema.leadEvidence.retrievalId))
        .where(and(isNotNull(schema.leadEvidence.retrievalId), eq(schema.evidenceRetrieval.outcome, 'OK')))
        .limit(300);
      const urls = [...new Set(rows.map(r => r.url).filter((u): u is string => !!u))];
      const latest = urls.length
        ? await db
            .select({ id: schema.evidenceRetrieval.id, url: schema.evidenceRetrieval.requestedUrl, sha: schema.evidenceRetrieval.contentSha256, fetchedAt: schema.evidenceRetrieval.fetchedAt })
            .from(schema.evidenceRetrieval)
            .where(and(inArray(schema.evidenceRetrieval.requestedUrl, urls), eq(schema.evidenceRetrieval.outcome, 'OK')))
            .orderBy(desc(schema.evidenceRetrieval.fetchedAt))
        : [];
      evidence = rows.flatMap(r => {
        const newest = latest.find(x => x.url === r.url);
        const state: 'RETRIEVED' | 'SOURCE_CHANGED' | 'CONTRADICTED' | null = r.contradicts
          ? 'CONTRADICTED'
          : r.reviewStatus === 'UNREVIEWED'
            ? 'RETRIEVED'
            : newest && newest.id !== r.retrievalId && newest.sha !== r.sha
              ? 'SOURCE_CHANGED'
              : null;
        if (!state) return [];
        return [{ evidenceId: r.id, leadId: r.leadId, field: r.field, fetchedOn: (newest?.fetchedAt ?? r.fetchedAt).toISOString().slice(0, 10), state }];
      });
    }
  }

  const all = buildTodayList({
    today,
    leads: snap.leads,
    suppression: snap.suppression,
    tracker: snap.tracker,
    callCards: selectCallQueue(snap.leads, snap.suppression, ledger, today, Date.now()).cards,
    whatsappItems: selectWhatsAppQueue(snap.leads, snap.suppression, ledger).items,
    researchItems: buildResearchQueue(snap.leads, snap.suppression, ledger, new Map(), new Date().toISOString()),
    candidates,
    evidence,
  });

  const me = snap.source === 'POSTGRES' ? await activeEngineActor(db, actor.userId).catch(() => null) : null;
  const visible = all.filter(i => actor.permissions.has(PERMISSION_FOR[i.kind])).filter(i => !opts.mine || !me || i.owner === me);
  const counts = Object.fromEntries(TODAY_KINDS.map(k => [k, visible.filter(i => i.kind === k).length])) as Record<TodayKind, number>;
  const byTn = new Map(snap.leads.map(l => [l.target_number, l]));
  const items = visible.map(i => ({
    ...i,
    href: hrefFor(i),
    line: describeWork(i, { today, ledger: snap.tracker.get(i.targetNumber) ?? null, nextAction: byTn.get(i.targetNumber)?.next_action ?? null }),
  }));
  const byUrgency: Record<Urgency, number> = { now: 0, today: 0, later: 0 };
  for (const i of items) byUrgency[i.line.urgency]++;
  return { today, source: snap.source, me, items, counts, byUrgency };
}
