import Link from 'next/link';
import { requirePermission, requireActor } from '@/server/auth/current-actor';
import { getDashboard } from '@/server/services/dashboard';
import { ActionCard } from './components/ActionCard';
import { EmptyState } from './components/EmptyState';

export const dynamic = 'force-dynamic';

/**
 * TODAY — Kachmo's operational workspace.
 *
 * Answers five core operator questions:
 * 1. What needs my attention today?
 * 2. Which client does it concern?
 * 3. Why does it need attention?
 * 4. What should I do next?
 * 5. Where do I click?
 *
 * All metrics and actions are derived by core/ from canonical state.
 * No priority algorithm or scoring band is invented here.
 */
export default async function DashboardPage() {
  await requirePermission('lead.view');
  const actor = await requireActor();
  const d = await getDashboard();

  // Compute total actionable count from real attention items and next actions due
  const totalActionsCount = d.attention.reduce((acc, a) => acc + a.count, 0) + d.nextActions.length;

  return (
    <>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div>
          <h1>Today</h1>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            Good day, {actor.name} · {d.today} (IST)
          </p>
        </div>
        <span className="badge info">
          {totalActionsCount} action{totalActionsCount === 1 ? '' : 's'} recorded
        </span>
      </div>

      <p className="lede" style={{ marginBottom: 16 }}>{d.phase.detail}</p>

      {d.warnings.length ? (
        <div className="notice" style={{ marginBottom: 20 }}>
          {d.warnings.map(w => (
            <p key={w} className="small">
              {w}
            </p>
          ))}
        </div>
      ) : null}

      {/* ── SECTION 1: WHAT NEEDS ATTENTION (Attention Queue) ─────────────── */}
      <h2 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span>Needs Attention</span>
        <span className="small muted font-normal">{d.attention.length} active queue{d.attention.length === 1 ? '' : 's'}</span>
      </h2>

      {d.attention.length ? (
        <div className="attention" style={{ marginBottom: 24 }}>
          {d.attention.map(a => (
            <Link key={a.id} href={a.href} className={a.severity}>
              <span>
                <strong>{a.label}</strong>
                <span className="d">{a.detail}</span>
              </span>
              <span className="n">{a.count}</span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          title="You're all clear."
          description="No blocking issues or queue warnings require immediate intervention."
          style={{ marginBottom: 24 }}
        />
      )}

      {/* ── SECTION 2: WORK DUE TODAY (Action Cards) ───────────────────────── */}
      <h2>Work Due Today</h2>

      {d.nextActions.length === 0 ? (
        <EmptyState
          title="No lead tasks due today."
          description="All scheduled follow-ups and next actions are currently up to date."
          style={{ marginBottom: 24 }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {d.nextActions.map(n => {
            const isResearch = /research|decision-maker|contact route|verify/i.test(n.action);
            const isContact = /draft|send|call|email|outreach/i.test(n.action);
            const actionHref = isContact
              ? /call/i.test(n.action)
                ? '/calls'
                : /email|draft/i.test(n.action)
                  ? '/email'
                  : `/leads/${n.targetNumber}`
              : `/leads/${n.targetNumber}`;

            const actionLabel = isContact
              ? /call/i.test(n.action)
                ? 'Call'
                : /email|draft/i.test(n.action)
                  ? 'Open email'
                  : 'Open'
              : isResearch
                ? 'Research'
                : 'Open';

            return (
              <ActionCard
                key={n.targetNumber}
                title={n.company}
                targetNumber={n.targetNumber}
                what={n.action}
                owner={n.owner}
                due={n.due}
                statusBadge={n.priority}
                actionHref={actionHref}
                actionLabel={actionLabel}
                secondaryHref={`/leads/${n.targetNumber}`}
                secondaryLabel="View lead"
              />
            );
          })}
        </div>
      )}

      {/* ── SECTION 3: WORKFLOW CHANNELS & ACTIVITY SUMMARY ───────────────── */}
      <h2>Workflow Channels</h2>
      <div className="grid3" style={{ marginBottom: 24 }}>
        <div className="subtle-card">
          <div className="row between" style={{ marginBottom: 6 }}>
            <h3 className="small" style={{ margin: 0 }}>Follow-ups & Email</h3>
            <span className="badge info">Titan</span>
          </div>
          <p style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            {d.email.followUpsDue} <span className="small font-normal muted">due</span>
          </p>
          <p className="small muted" style={{ margin: '4px 0 10px' }}>
            {d.email.sent} sent · {d.email.scheduled} queued
          </p>
          <Link href="/email" className="badge ghost" style={{ textDecoration: 'none' }}>
            Open email ledger →
          </Link>
        </div>

        <div className="subtle-card">
          <div className="row between" style={{ marginBottom: 6 }}>
            <h3 className="small" style={{ margin: 0 }}>Phone Calls</h3>
            <span className={`badge ${d.callQueue.callable > 0 ? 'ok' : ''}`}>
              {d.callQueue.callable} callable
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            {d.callQueue.callable} <span className="small font-normal muted">ready</span>
          </p>
          <p className="small muted" style={{ margin: '4px 0 10px' }}>
            {d.callQueue.excluded} excluded (unsourced)
          </p>
          <Link href="/calls" className="badge ghost" style={{ textDecoration: 'none' }}>
            Open call queue →
          </Link>
        </div>

        <div className="subtle-card">
          <div className="row between" style={{ marginBottom: 6 }}>
            <h3 className="small" style={{ margin: 0 }}>Research Pipeline</h3>
            <span className="badge">{d.researchQueue.open} open</span>
          </div>
          <p style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            {d.researchQueue.open} <span className="small font-normal muted">leads need info</span>
          </p>
          <p className="small muted" style={{ margin: '4px 0 10px' }}>
            {d.researchQueue.topFields[0] ? `Top gap: ${d.researchQueue.topFields[0].field}` : 'Queues healthy'}
          </p>
          <Link href="/research" className="badge ghost" style={{ textDecoration: 'none' }}>
            Open research →
          </Link>
        </div>
      </div>

      {/* ── SECTION 4: PIPELINE PULSE ─────────────────────────────────────── */}
      <h2>Pipeline at a Glance</h2>
      <dl className="stats" style={{ marginBottom: 20 }}>
        <div>
          <dt>Contacted</dt>
          <dd>{d.email.sent}</dd>
        </div>
        <div>
          <dt>Replies Waiting</dt>
          <dd>{d.email.repliesWaiting}</dd>
        </div>
        <div>
          <dt>Meetings</dt>
          <dd>{d.pipeline.meetings}</dd>
        </div>
        <div>
          <dt>Proposals</dt>
          <dd>{d.pipeline.proposals}</dd>
        </div>
        <div>
          <dt>Won</dt>
          <dd>{d.pipeline.won}</dd>
        </div>
      </dl>
      <p className="small muted">
        Numbers reflect recorded states in the canonical database and Titan ledger. No conversion probabilities are estimated.
      </p>
    </>
  );
}
