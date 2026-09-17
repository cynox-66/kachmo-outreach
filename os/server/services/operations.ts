import 'server-only';
import { selectCallQueue, buildCallCard } from '@kachmo/core/queues/calls.js';
import { selectWhatsAppQueue } from '@kachmo/core/queues/whatsapp.js';
import { buildInventoryReport, researchNeeds, type InventoryReport } from '@kachmo/core/research/inventory.js';
import { buildWeeklyReport } from '@kachmo/core/reports/weekly.js';
import { findEmailQueueIssues } from '@kachmo/core/email-ledger/queue-check.js';
import { EMAIL_SENT_STATUSES } from '@kachmo/core/email-ledger/tracker.js';
import { verifySuppressionArtifact } from '@kachmo/core/reconciliation/suppression-artifact.js';
import { readSuppressionArtifact, sha256 } from '../sync/suppression-artifact-store';
import type { KachmoLead } from '@kachmo/core/leads/schema.js';
import type { Actor } from '../authz/authorize';
import { contactsFor } from './contacts';
import { loadCanonical, ledgerStatusOf, type CanonicalSnapshot } from '../repo/canonical';

/**
 * Read surfaces for the operational pages: calls, WhatsApp, email, pipeline, inventory and analytics.
 *
 * All selection and eligibility comes from `core/`. Nothing here decides who may be contacted; it only presents
 * what the engine already decided, with contact values gated by the actor's permissions.
 */

const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// ── Calls ────────────────────────────────────────────────────────────────────

export interface CallQueueView {
  today: string;
  cards: Array<{
    targetNumber: string;
    company: string;
    decisionMaker: string;
    title: string;
    phone: string;
    phoneVisible: boolean;
    phoneStatus: string;
    phoneSource: string | null;
    city: string;
    timezone: string | null;
    priority: string;
    score: number | null;
    researchCompleteness: number;
    archetype: string;
    whyThem: string;
    friction: string;
    angle: string;
    whyNow: string | null;
    objective: string;
    opening: string;
    bridge: string;
    questions: string[];
    objections: Array<{ objection: string; response: string }>;
    doNotSay: string[];
    verifyFirst: string[];
    previousAttempts: number;
    logCommand: string;
  }>;
  excluded: Array<{ targetNumber: string; company: string; reason: string }>;
  /** Leads with a phone on file that no one may call, and why — the honest denominator. */
  unsourcedPhones: number;
}

export async function getCallQueue(actor: Actor, snapshot?: CanonicalSnapshot): Promise<CallQueueView> {
  const snap = snapshot ?? (await loadCanonical());
  const today = istToday();
  const { cards, excluded } = selectCallQueue(snap.leads, snap.suppression, ledgerStatusOf(snap), today, Date.now());
  const byTn = new Map(snap.leads.map(l => [l.target_number, l]));

  return {
    today,
    cards: cards.map(c => {
      const lead = byTn.get(c.target_number)!;
      const contacts = contactsFor(lead, actor);
      return {
        targetNumber: c.target_number,
        company: c.company_name,
        decisionMaker: c.decision_maker_name,
        title: c.decision_maker_title,
        phone: contacts.phone.visible ? c.phone_number : contacts.phone.masked,
        phoneVisible: contacts.phone.visible,
        phoneStatus: c.phone_status,
        phoneSource: c.phone_source,
        city: c.location_city,
        timezone: c.timezone,
        priority: c.priority ?? 'UNSCORED',
        score: c.kachmo_score,
        researchCompleteness: c.research_completeness_score,
        archetype: c.archetype,
        whyThem: c.commercial_signal,
        friction: c.observable_friction,
        angle: c.kachmo_angle,
        whyNow: c.why_now,
        objective: c.call_objective,
        opening: c.recommended_opening,
        bridge: c.bridge,
        questions: c.discovery_questions,
        objections: c.objections,
        doNotSay: c.what_not_to_say,
        verifyFirst: c.verify_before_call,
        previousAttempts: c.previous_attempts,
        logCommand: c.log_command,
      };
    }),
    excluded: excluded.map(e => ({ targetNumber: e.target_number, company: e.company, reason: e.reason })),
    unsourcedPhones: snap.leads.filter(l => l.decision_maker_phone && l.phone_status !== 'PUBLICLY_LISTED' && l.phone_status !== 'VERIFIED').length,
  };
}

/** A single call card, for the lead detail page. Returns null when the lead has no callable phone. */
export function callCardFor(lead: KachmoLead) {
  return buildCallCard(lead);
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────

export interface WhatsAppQueueView {
  items: Array<{
    targetNumber: string;
    company: string;
    decisionMaker: string;
    number: string;
    numberVisible: boolean;
    basis: string;
    priority: string;
    score: number | null;
    draft: string;
    wordCount: number;
    angle: string;
    status: string;
    approveCommand: string;
    sentCommand: string;
  }>;
  excluded: Array<{ targetNumber: string; company: string; reason: string }>;
}

export async function getWhatsAppQueue(actor: Actor, snapshot?: CanonicalSnapshot): Promise<WhatsAppQueueView> {
  const snap = snapshot ?? (await loadCanonical());
  const { items, excluded } = selectWhatsAppQueue(snap.leads, snap.suppression, ledgerStatusOf(snap));
  const byTn = new Map(snap.leads.map(l => [l.target_number, l]));
  return {
    items: items.map(i => {
      const contacts = contactsFor(byTn.get(i.target_number)!, actor);
      return {
        targetNumber: i.target_number,
        company: i.company_name,
        decisionMaker: i.decision_maker_name,
        number: contacts.phone.visible ? i.whatsapp_number : contacts.phone.masked,
        numberVisible: contacts.phone.visible,
        basis: i.whatsapp_basis,
        priority: i.priority ?? 'UNSCORED',
        score: i.kachmo_score,
        draft: i.message_draft,
        wordCount: i.word_count,
        angle: i.outreach_angle,
        status: i.status,
        approveCommand: `npm run whatsapp:log -- --lead=${i.target_number} --status=APPROVED --by=DEV`,
        sentCommand: `npm run whatsapp:log -- --lead=${i.target_number} --status=SENT --by=AADI`,
      };
    }),
    excluded: excluded.map(e => ({ targetNumber: e.target_number, company: e.company, reason: e.reason })),
  };
}

// ── Email (read-only Titan ledger) ───────────────────────────────────────────

export interface EmailLedgerView {
  /** Every row of OUTREACH_TRACKER.md, contact values gated. */
  rows: Array<{
    targetNumber: string;
    company: string;
    batch: string;
    status: string;
    email: string;
    emailVisible: boolean;
    sentDate: string | null;
    followUpDue: string | null;
    followUpOverdue: boolean;
    alreadyFollowedUp: boolean;
  }>;
  byStatus: Array<{ status: string; count: number }>;
  scheduled: Array<{ targetNumber: string; company: string; to: string; toVisible: boolean; sendAt: string | null }>;
  /** Blocking problems the pre-push guard would report about the production queue. */
  queueIssues: Array<{ message: string; blocking: boolean }>;
  /** Whether suppression has reached the file the cron actually reads (ADR-010). */
  suppressionFreshness: { fresh: boolean; unpublished: number; outreachAllowed: boolean; reason: string };
  today: string;
}

export async function getEmailLedger(actor: Actor, snapshot?: CanonicalSnapshot): Promise<EmailLedgerView> {
  const snap = snapshot ?? (await loadCanonical());
  const today = istToday();
  const byTn = new Map(snap.leads.map(l => [l.target_number, l]));

  const rows = [...snap.tracker.values()].map(r => {
    const lead = byTn.get(r.target_number);
    const contacts = lead ? contactsFor(lead, actor) : null;
    const visible = !!contacts?.email.visible;
    return {
      targetNumber: r.target_number,
      company: lead?.company_name ?? '(not in the lead database)',
      batch: r.batch,
      status: r.status,
      email: visible ? (r.email ?? '—') : contacts?.email.masked ?? '•••',
      emailVisible: visible,
      sentDate: r.sent_date,
      followUpDue: r.follow_up_due,
      followUpOverdue: r.status === 'SENT' && !!r.follow_up_due && r.follow_up_due <= today && !lead?.email_follow_up_sent_at,
      alreadyFollowedUp: !!lead?.email_follow_up_sent_at || r.status === 'FOLLOWED_UP',
    };
  });

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);

  const issues = findEmailQueueIssues(snap.scheduled, snap.leads, snap.suppression, snap.tracker);

  // The artifact the dispatcher reads is a FILE, and after cutover canonical suppression is in Postgres. Comparing
  // the canonical list against itself would report "fresh" no matter what the file actually contains, which is the
  // one answer that can get someone emailed after they opted out. Read the artifact and compare against it.
  const artifact = readSuppressionArtifact();
  const verdict = verifySuppressionArtifact({ canonicalActive: snap.suppression, artifactRaw: artifact.raw, hash: sha256 });
  const freshness = {
    fresh: verdict.status === 'IN_SYNC',
    unpublished: verdict.missing.length,
    outreachAllowed: verdict.outreachAllowed,
    reason: verdict.reason,
  };

  return {
    rows: rows.sort((a, b) => a.targetNumber.localeCompare(b.targetNumber)),
    byStatus: [...counts.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    scheduled: snap.scheduled.map(s => {
      const lead = byTn.get(s.targetNumber);
      const contacts = lead ? contactsFor(lead, actor) : null;
      return {
        targetNumber: s.targetNumber,
        company: s.companyName,
        to: contacts?.email.visible ? s.to : contacts?.email.masked ?? '•••',
        toVisible: !!contacts?.email.visible,
        sendAt: (s as { sendAt?: string }).sendAt ?? null,
      };
    }),
    queueIssues: issues.map(i => ({ message: i.message, blocking: i.blocking })),
    suppressionFreshness: {
      fresh: freshness.fresh,
      unpublished: freshness.unpublished,
      outreachAllowed: freshness.outreachAllowed,
      reason: freshness.reason,
    },
    today,
  };
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

/** The states the system actually records. Not a new model — the union of the ledger and the lead record. */
export const PIPELINE_COLUMNS = [
  { key: 'DRAFTED', label: 'Drafted' },
  { key: 'SCHEDULED', label: 'Scheduled' },
  { key: 'SENT', label: 'Sent' },
  { key: 'FOLLOW_UP_DUE', label: 'Follow-up due' },
  { key: 'FOLLOWED_UP', label: 'Followed up' },
  { key: 'REPLIED_WARM', label: 'Replied (warm)' },
  { key: 'REPLIED_NOT_NOW', label: 'Replied (not now)' },
  { key: 'REPLIED_NO', label: 'Replied (no)' },
  { key: 'CALL_BOOKED', label: 'Call booked' },
  { key: 'PROPOSAL_SENT', label: 'Proposal sent' },
  { key: 'WON', label: 'Won' },
  { key: 'DISQUALIFIED', label: 'Disqualified' },
] as const;

export interface PipelineView {
  columns: Array<{
    key: string;
    label: string;
    leads: Array<{ targetNumber: string; company: string; owner: string | null; value: string | null; nextAction: string | null; due: string | null }>;
  }>;
  transitions: Array<{ at: string; targetNumber: string; company: string; event: string; actor: string; channel: string }>;
  totals: { inPipeline: number; meetings: number; proposals: number; won: number; lost: number };
}

/** Where a lead sits, preferring the lead record's sales state over the email ledger when both exist. */
function stageOf(lead: KachmoLead, ledgerStatus: string | null): string {
  if (lead.deal_stage === 'WON') return 'WON';
  if (lead.deal_stage === 'LOST' || lead.research_state === 'DISQUALIFIED') return 'DISQUALIFIED';
  if (lead.proposal_status === 'SENT') return 'PROPOSAL_SENT';
  if (lead.meeting_status) return 'CALL_BOOKED';
  if (lead.response_status === 'REPLIED_POSITIVE') return 'REPLIED_WARM';
  if (lead.response_status === 'REPLIED_NOT_NOW') return 'REPLIED_NOT_NOW';
  if (lead.response_status === 'NOT_INTERESTED') return 'REPLIED_NO';
  return ledgerStatus ?? lead.lead_state ?? 'DRAFTED';
}

export async function getPipeline(snapshot?: CanonicalSnapshot): Promise<PipelineView> {
  const snap = snapshot ?? (await loadCanonical());
  const ledger = ledgerStatusOf(snap);
  const byTn = new Map(snap.leads.map(l => [l.target_number, l]));

  const buckets = new Map<string, PipelineView['columns'][number]['leads']>();
  for (const col of PIPELINE_COLUMNS) buckets.set(col.key, []);
  for (const lead of snap.leads) {
    const stage = stageOf(lead, ledger(lead.target_number));
    if (!buckets.has(stage)) continue; // States outside the recorded model are not invented into a new column.
    buckets.get(stage)!.push({
      targetNumber: lead.target_number,
      company: lead.company_name,
      owner: lead.owner,
      value: lead.deal_value,
      nextAction: lead.next_action,
      due: lead.next_action_date,
    });
  }

  const PIPELINE_EVENTS = new Set(['REPLY_RECEIVED', 'MEETING_BOOKED', 'MEETING_DONE', 'PROPOSAL_SENT', 'DEAL_WON', 'DEAL_LOST', 'FOLLOW_UP_SENT', 'CALL_CONNECTED', 'WHATSAPP_SENT']);
  const transitions = snap.events
    .filter(e => PIPELINE_EVENTS.has(e.event_type))
    .slice(-60)
    .reverse()
    .map(e => ({
      at: e.timestamp,
      targetNumber: e.target_number ?? '—',
      company: byTn.get(e.target_number ?? '')?.company_name ?? e.company_name ?? '—',
      event: e.event_type,
      actor: e.actor,
      channel: e.channel,
    }));

  return {
    columns: PIPELINE_COLUMNS.map(c => ({ key: c.key, label: c.label, leads: buckets.get(c.key) ?? [] })),
    transitions,
    totals: {
      inPipeline: snap.leads.filter(l => l.meeting_status || l.proposal_status || l.deal_stage || l.response_status).length,
      meetings: snap.leads.filter(l => l.meeting_status).length,
      proposals: snap.leads.filter(l => l.proposal_status === 'SENT').length,
      won: snap.leads.filter(l => l.deal_stage === 'WON').length,
      lost: snap.leads.filter(l => l.deal_stage === 'LOST').length,
    },
  };
}

// ── Inventory ────────────────────────────────────────────────────────────────

export interface InventoryView {
  report: InventoryReport;
  needs: ReturnType<typeof researchNeeds>;
}

export async function getInventory(snapshot?: CanonicalSnapshot): Promise<InventoryView> {
  const snap = snapshot ?? (await loadCanonical());
  const report = buildInventoryReport(snap.leads, snap.suppression, ledgerStatusOf(snap), new Date().toISOString());
  return { report, needs: researchNeeds(report) };
}

// ── Analytics ────────────────────────────────────────────────────────────────

export interface AnalyticsView {
  report: ReturnType<typeof buildWeeklyReport>;
  eventsByType: Array<{ type: string; count: number }>;
  eventsByWeek: Array<{ week: string; count: number }>;
  researchThroughput: { recorded: number; provenanceUpdates: number; discovered: number };
  emailStates: Array<{ status: string; count: number }>;
}

export async function getAnalytics(snapshot?: CanonicalSnapshot): Promise<AnalyticsView> {
  const snap = snapshot ?? (await loadCanonical());
  const report = buildWeeklyReport({ today: istToday(), generatedAt: new Date().toISOString(), leads: snap.leads, events: snap.events, tracker: snap.tracker });

  const byType = new Map<string, number>();
  const byWeek = new Map<string, number>();
  for (const e of snap.events) {
    byType.set(e.event_type, (byType.get(e.event_type) ?? 0) + 1);
    const d = new Date(e.timestamp);
    if (!Number.isNaN(d.getTime())) {
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const week = monday.toISOString().slice(0, 10);
      byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
    }
  }

  const emailCounts = new Map<string, number>();
  for (const r of snap.tracker.values()) emailCounts.set(r.status, (emailCounts.get(r.status) ?? 0) + 1);

  return {
    report,
    eventsByType: [...byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    eventsByWeek: [...byWeek.entries()].map(([week, count]) => ({ week, count })).sort((a, b) => a.week.localeCompare(b.week)).slice(-12),
    researchThroughput: {
      recorded: byType.get('RESEARCH_RECORDED') ?? 0,
      provenanceUpdates: byType.get('CONTACT_PROVENANCE_UPDATED') ?? 0,
      discovered: byType.get('LEAD_DISCOVERED') ?? 0,
    },
    emailStates: [...emailCounts.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
  };
}

/** Re-exported so the email page can name the statuses that count as sent without redefining them. */
export { EMAIL_SENT_STATUSES };
