import 'server-only';
import { buildWarRoomSummary, leadBaseCounts } from '@kachmo/core/reports/war-room.js';
import { selectCallQueue } from '@kachmo/core/queues/calls.js';
import { selectWhatsAppQueue } from '@kachmo/core/queues/whatsapp.js';
import { buildResearchQueue } from '@kachmo/core/research/tasks.js';
import { buildInventoryReport, researchNeeds } from '@kachmo/core/research/inventory.js';
import { outreachBlock } from '@kachmo/core/suppression/match.js';
import { loadCanonical, ledgerStatusOf, type CanonicalSnapshot } from '../repo/canonical';
import { phaseBanner } from '../repo/phase';

/**
 * THE OPERATIONAL DASHBOARD.
 *
 * Answers three questions, in this order: what is happening, what needs attention, what should we do next.
 *
 * Every number is derived by `core/` from the canonical store — the same functions that produce
 * DAILY_WAR_ROOM.md — so the dashboard and the morning markdown can never disagree. The "next action" column is
 * the lead's STORED next_action, computed by the engine; there is no second recommendation engine here.
 */

export interface AttentionItem {
  /** Stable key for the UI. */
  id: string;
  label: string;
  count: number;
  href: string;
  /** Why this matters, in one operator-facing line. */
  detail: string;
  severity: 'critical' | 'warn' | 'info';
}

export interface DashboardData {
  phase: ReturnType<typeof phaseBanner> & { phase: CanonicalSnapshot['phase']; source: CanonicalSnapshot['source'] };
  /** What is happening. */
  base: Record<string, number>;
  usable: number;
  suppressed: number;
  /** What needs attention, worst first. */
  attention: AttentionItem[];
  /** What to do next: the highest-priority leads with work actually due. */
  nextActions: Array<{ targetNumber: string; company: string; action: string; due: string | null; owner: string | null; priority: string }>;
  callQueue: { callable: number; excluded: number };
  whatsappQueue: { pendingReview: number; approved: number };
  researchQueue: { open: number; topFields: Array<{ field: string; leads: number }> };
  inventory: { segments: number; low: number; critical: number; worst: Array<{ label: string; usable: number; status: string; blockingGate: string | null }> };
  email: { scheduled: number; sent: number; followUpsDue: number; repliesWaiting: number };
  pipeline: { meetings: number; proposals: number; won: number; lost: number };
  warnings: string[];
  today: string;
}

export async function getDashboard(snapshot?: CanonicalSnapshot): Promise<DashboardData> {
  const snap = snapshot ?? (await loadCanonical());
  const ledger = ledgerStatusOf(snap);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const now = Date.now();

  const calls = selectCallQueue(snap.leads, snap.suppression, ledger, today, now);
  const whatsapp = selectWhatsAppQueue(snap.leads, snap.suppression, ledger);
  const research = buildResearchQueue(snap.leads, snap.suppression, ledger, new Map(), new Date().toISOString());
  const inventory = buildInventoryReport(snap.leads, snap.suppression, ledger, new Date().toISOString());
  const needs = researchNeeds(inventory);

  const warRoom = buildWarRoomSummary({
    today,
    generatedAt: new Date().toISOString(),
    leads: snap.leads,
    suppression: snap.suppression,
    tracker: snap.tracker,
    scheduled: snap.scheduled,
    callCards: calls.cards,
    whatsappItems: whatsapp.items,
    researchItems: research,
    alerts: [],
  });

  const suppressed = snap.leads.filter(l => outreachBlock(l, snap.suppression, ledger(l.target_number)).blocked).length;
  const trackerRows = [...snap.tracker.values()];

  // Research fields blocking the most leads — what to commission first.
  const fieldCounts = new Map<string, number>();
  for (const item of research) for (const f of item.missing_fields) fieldCounts.set(f, (fieldCounts.get(f) ?? 0) + 1);
  const topFields = [...fieldCounts.entries()]
    .map(([field, leads]) => ({ field, leads }))
    .sort((a, b) => b.leads - a.leads || a.field.localeCompare(b.field))
    .slice(0, 5);

  const attention: AttentionItem[] = [];
  const push = (item: AttentionItem) => {
    if (item.count > 0) attention.push(item);
  };
  push({
    id: 'inventory',
    label: 'Segments below inventory threshold',
    count: inventory.needsResearch.length,
    href: '/inventory',
    detail: `${needs.filter(n => n.approach !== 'FIND_NEW').length} could be recovered by researching leads you already have.`,
    severity: inventory.needsResearch.some(s => s.status === 'CRITICAL') ? 'critical' : 'warn',
  });
  push({
    id: 'whatsapp-review',
    label: 'WhatsApp drafts awaiting approval',
    count: whatsapp.items.filter(i => i.status === 'PENDING_HUMAN_REVIEW').length,
    href: '/whatsapp',
    detail: 'Nothing is sent until a human approves and sends it by hand.',
    severity: 'warn',
  });
  push({
    id: 'calls-due',
    label: 'Calls ready to make',
    count: calls.cards.length,
    href: '/calls',
    detail: 'Only phones with a recorded public source or verified basis appear here.',
    severity: 'info',
  });
  push({
    id: 'email-followups',
    label: 'Email follow-ups due',
    count: warRoom.dev.email_follow_ups_due.length,
    href: '/email',
    detail: 'From the Titan ledger. One bump only — the protocol allows no second follow-up.',
    severity: 'warn',
  });
  push({
    id: 'replies',
    label: 'Replies waiting for an answer',
    count: warRoom.dev.replies_to_answer.length,
    href: '/email',
    detail: 'Someone replied and has not been answered.',
    severity: 'critical',
  });
  push({
    id: 'positive-no-meeting',
    label: 'Positive replies with no meeting booked',
    count: warRoom.dev.positive_without_meeting.length,
    href: '/pipeline',
    detail: 'Interest recorded but nothing scheduled.',
    severity: 'critical',
  });
  push({
    id: 'research',
    label: 'Leads with open research tasks',
    count: research.length,
    href: '/research',
    detail: topFields.length ? `Most common gap: ${topFields[0].field} (${topFields[0].leads} leads).` : 'Every lead has what the methodology needs.',
    severity: 'info',
  });
  attention.sort((a, b) => ({ critical: 0, warn: 1, info: 2 })[a.severity] - ({ critical: 0, warn: 1, info: 2 })[b.severity] || b.count - a.count);

  const dueSoon = snap.leads
    .filter(l => l.next_action && l.research_state !== 'DISQUALIFIED' && !outreachBlock(l, snap.suppression, ledger(l.target_number)).blocked)
    .filter(l => !l.next_action_date || l.next_action_date <= today)
    .sort((a, b) => (a.next_action_date ?? '9999').localeCompare(b.next_action_date ?? '9999') || (b.kachmo_score ?? -1) - (a.kachmo_score ?? -1))
    .slice(0, 12)
    .map(l => ({
      targetNumber: l.target_number,
      company: l.company_name,
      action: l.next_action!,
      due: l.next_action_date,
      owner: l.owner,
      priority: l.lead_priority ?? 'UNSCORED',
    }));

  return {
    phase: { ...phaseBanner(snap.phase), phase: snap.phase, source: snap.source },
    base: leadBaseCounts(snap.leads),
    usable: inventory.totals.usable,
    suppressed,
    attention,
    nextActions: dueSoon,
    callQueue: { callable: calls.cards.length, excluded: calls.excluded.length },
    whatsappQueue: {
      pendingReview: whatsapp.items.filter(i => i.status === 'PENDING_HUMAN_REVIEW').length,
      approved: whatsapp.items.filter(i => i.status === 'APPROVED').length,
    },
    researchQueue: { open: research.length, topFields },
    inventory: {
      segments: inventory.segments.length,
      low: inventory.segments.filter(s => s.status === 'LOW').length,
      critical: inventory.segments.filter(s => s.status === 'CRITICAL').length,
      worst: inventory.needsResearch.slice(0, 5).map(s => ({
        label: `${s.segment.archetypeId}${s.segment.vertical ? ` · ${s.segment.vertical}` : ''} · ${s.segment.country}`,
        usable: s.usable,
        status: s.status,
        blockingGate: s.blockingGates[0]?.gate ?? null,
      })),
    },
    email: {
      scheduled: snap.scheduled.length,
      sent: trackerRows.filter(r => r.status === 'SENT').length,
      followUpsDue: warRoom.dev.email_follow_ups_due.length,
      repliesWaiting: warRoom.dev.replies_to_answer.length,
    },
    pipeline: {
      meetings: snap.leads.filter(l => l.meeting_status).length,
      proposals: snap.leads.filter(l => l.proposal_status === 'SENT').length,
      won: snap.leads.filter(l => l.deal_stage === 'WON').length,
      lost: snap.leads.filter(l => l.deal_stage === 'LOST').length,
    },
    warnings: snap.warnings,
    today,
  };
}
