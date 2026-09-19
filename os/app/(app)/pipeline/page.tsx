import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { getPipeline } from '@/server/services/operations';

export const dynamic = 'force-dynamic';

/**
 * PIPELINE — Commercial deal and conversation stages.
 *
 * Uses existing recorded canonical stages (contacted, replied, meeting, proposal, won, lost).
 * No probability model or conversion likelihood is estimated.
 */
export default async function PipelinePage() {
  await requirePermission('pipeline.update');
  const p = await getPipeline();

  return (
    <>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div>
          <h1>Pipeline</h1>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            Active commercial conversations and deal progression
          </p>
        </div>
        <span className="badge info">
          {p.totals.inPipeline} in pipeline
        </span>
      </div>

      <p className="lede" style={{ marginBottom: 20 }}>
        Every lead is presented in the state recorded in the canonical database or Titan ledger.
        No conversion probability or win likelihood is estimated.
      </p>

      {/* ── STAGE METRICS ────────────────────────────────────────────────── */}
      <dl className="stats" style={{ marginBottom: 24 }}>
        <div>
          <dt>In Pipeline</dt>
          <dd>{p.totals.inPipeline}</dd>
        </div>
        <div>
          <dt>Meetings</dt>
          <dd>{p.totals.meetings}</dd>
        </div>
        <div>
          <dt>Proposals</dt>
          <dd>{p.totals.proposals}</dd>
        </div>
        <div>
          <dt>Won</dt>
          <dd style={{ color: '#1f5132' }}>{p.totals.won}</dd>
        </div>
        <div>
          <dt>Lost</dt>
          <dd className="muted">{p.totals.lost}</dd>
        </div>
      </dl>

      {/* ── KANBAN BOARD WORKSPACE ───────────────────────────────────────── */}
      <h2>Pipeline Stages</h2>
      <div className="board" style={{ marginBottom: 28 }}>
        {p.columns.map(c => (
          <div className="col" key={c.key}>
            <h3>
              <span>{c.label}</span>
              <span className="badge">{c.leads.length}</span>
            </h3>
            {c.leads.slice(0, 25).map(l => (
              <div className="card" key={l.targetNumber}>
                <Link
                  href={`/leads/${l.targetNumber}`}
                  style={{ textDecoration: 'none', color: 'var(--ink)' }}
                >
                  <strong style={{ fontFamily: 'var(--mono)', fontSize: '11.5px', marginRight: 4 }}>
                    {l.targetNumber}
                  </strong>{' '}
                  {l.company}
                </Link>
                {l.value ? <div className="muted small" style={{ marginTop: 2 }}>{l.value}</div> : null}
                {l.nextAction ? (
                  <div className="small" style={{ marginTop: 4, color: 'var(--ink-muted)' }}>
                    {l.nextAction}
                    {l.due ? ` · ${l.due}` : ''}
                  </div>
                ) : null}
              </div>
            ))}
            {c.leads.length > 25 ? (
              <p className="small muted" style={{ margin: '6px 0 0' }}>
                …and {c.leads.length - 25} more
              </p>
            ) : null}
            {c.leads.length === 0 ? <p className="small muted" style={{ margin: 0 }}>—</p> : null}
          </div>
        ))}
      </div>

      {/* ── RECENT TRANSITIONS ───────────────────────────────────────────── */}
      <h2>Recent Activity</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Target</th>
              <th>Company</th>
              <th>Stage Event</th>
              <th>Channel</th>
              <th>Recorded By</th>
            </tr>
          </thead>
          <tbody>
            {p.transitions.map((t, i) => (
              <tr key={`${t.at}-${i}`}>
                <td className="small">{t.at.slice(0, 16).replace('T', ' ')}</td>
                <td className="small" style={{ fontFamily: 'var(--mono)' }}>
                  <Link href={`/leads/${t.targetNumber}`} style={{ textDecoration: 'none' }}>
                    {t.targetNumber}
                  </Link>
                </td>
                <td>
                  <strong>{t.company}</strong>
                </td>
                <td>
                  <span className="badge">{t.event}</span>
                </td>
                <td className="small muted">{t.channel}</td>
                <td className="small">{t.actor}</td>
              </tr>
            ))}
            {p.transitions.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty">
                  No pipeline transitions have been recorded yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
