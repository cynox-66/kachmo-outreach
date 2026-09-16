import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { getDashboard } from '@/server/services/dashboard';

export const dynamic = 'force-dynamic';

/**
 * The operational dashboard. Three questions, in order: what is happening, what needs attention, what next.
 * Every number is derived by core/ from the canonical store, so this page and DAILY_WAR_ROOM.md always agree.
 */
export default async function DashboardPage() {
  await requirePermission('lead.view');
  const d = await getDashboard();

  return (
    <>
      <div className="row between">
        <h1>Dashboard</h1>
        <span className="small muted">{d.today} (IST)</span>
      </div>
      <p className="lede">{d.phase.detail}</p>

      {d.warnings.length ? (
        <div className="notice">
          {d.warnings.map(w => (
            <p key={w} className="small">
              {w}
            </p>
          ))}
        </div>
      ) : null}

      <h2>What is happening</h2>
      <dl className="stats">
        <div>
          <dt>Leads</dt>
          <dd>{d.base.total}</dd>
        </div>
        <div>
          <dt>Usable today</dt>
          <dd>{d.usable}</dd>
        </div>
        <div>
          <dt>Qualified</dt>
          <dd>{d.base.qualified + d.base.outreach_ready}</dd>
        </div>
        <div>
          <dt>Research required</dt>
          <dd>{d.base.research_required}</dd>
        </div>
        <div>
          <dt>Suppressed</dt>
          <dd>{d.suppressed}</dd>
        </div>
        <div>
          <dt>A / A+ (provisional)</dt>
          <dd>
            {d.base.a_or_a_plus}
            <span className="small muted"> / {d.base.a_or_a_plus_provisional}</span>
          </dd>
        </div>
      </dl>

      <h2>What needs attention</h2>
      {d.attention.length ? (
        <div className="attention">
          {d.attention.map(a => (
            <Link key={a.id} href={a.href} className={a.severity}>
              <span>
                {a.label}
                <span className="d">{a.detail}</span>
              </span>
              <span className="n">{a.count}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="panel empty">Nothing is waiting. Every queue is clear.</div>
      )}

      <h2>What to do next</h2>
      {d.nextActions.length ? (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Target</th>
                <th>Company</th>
                <th>Next action</th>
                <th>Due</th>
                <th>Owner</th>
                <th>Priority</th>
              </tr>
            </thead>
            <tbody>
              {d.nextActions.map(n => (
                <tr key={n.targetNumber}>
                  <td>
                    <Link href={`/leads/${n.targetNumber}`}>{n.targetNumber}</Link>
                  </td>
                  <td>{n.company}</td>
                  <td className="wrap">{n.action}</td>
                  <td>{n.due ?? '—'}</td>
                  <td>{n.owner ?? '—'}</td>
                  <td>
                    <span className="badge">{n.priority}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel empty">No lead has work due today.</div>
      )}
      <p className="small muted" style={{ marginTop: 8 }}>
        These are each lead&rsquo;s stored <code>next_action</code>, computed by the engine. There is no second
        recommendation system.
      </p>

      <h2>Queues</h2>
      <div className="grid3">
        <div className="panel">
          <h3 className="small muted" style={{ margin: '0 0 6px' }}>
            Calls
          </h3>
          <p style={{ margin: 0 }}>
            <strong>{d.callQueue.callable}</strong> callable · {d.callQueue.excluded} excluded
          </p>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            A phone with no recorded source is not callable.
          </p>
        </div>
        <div className="panel">
          <h3 className="small muted" style={{ margin: '0 0 6px' }}>
            WhatsApp
          </h3>
          <p style={{ margin: 0 }}>
            <strong>{d.whatsappQueue.pendingReview}</strong> to review · {d.whatsappQueue.approved} approved
          </p>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            Nothing is ever sent by this system.
          </p>
        </div>
        <div className="panel">
          <h3 className="small muted" style={{ margin: '0 0 6px' }}>
            Email (Titan)
          </h3>
          <p style={{ margin: 0 }}>
            <strong>{d.email.sent}</strong> sent · {d.email.scheduled} queued · {d.email.followUpsDue} follow-ups due
          </p>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            Read-only. Titan owns email.
          </p>
        </div>
        <div className="panel">
          <h3 className="small muted" style={{ margin: '0 0 6px' }}>
            Research
          </h3>
          <p style={{ margin: 0 }}>
            <strong>{d.researchQueue.open}</strong> leads with open tasks
          </p>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            {d.researchQueue.topFields.map(f => `${f.field} (${f.leads})`).join(', ') || 'none'}
          </p>
        </div>
        <div className="panel">
          <h3 className="small muted" style={{ margin: '0 0 6px' }}>
            Inventory
          </h3>
          <p style={{ margin: 0 }}>
            <strong>{d.inventory.critical}</strong> critical · {d.inventory.low} low · {d.inventory.segments} segments
          </p>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            {d.inventory.worst[0] ? `Worst: ${d.inventory.worst[0].label} (${d.inventory.worst[0].usable} usable)` : 'all healthy'}
          </p>
        </div>
        <div className="panel">
          <h3 className="small muted" style={{ margin: '0 0 6px' }}>
            Pipeline
          </h3>
          <p style={{ margin: 0 }}>
            <strong>{d.pipeline.meetings}</strong> meetings · {d.pipeline.proposals} proposals · {d.pipeline.won} won
          </p>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            No conversion probability is estimated.
          </p>
        </div>
      </div>
    </>
  );
}
