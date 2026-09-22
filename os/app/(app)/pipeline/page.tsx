import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { getPipeline } from '@/server/services/operations';
import { requestSnapshot } from '@/server/services/snapshot';
import { actorName, eventLabel, momentLabel } from '@/server/services/operator';
import { PageHead } from '../components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pipeline' };

/**
 * PIPELINE — Commercial deal and conversation stages.
 *
 * Uses existing recorded canonical stages (contacted, replied, meeting, proposal, won, lost).
 * No probability model or conversion likelihood is estimated.
 */
export default async function PipelinePage() {
  await requirePermission('pipeline.update');
  const p = await getPipeline(await requestSnapshot());

  return (
    <>
      <PageHead
        label={`${p.totals.inPipeline} in conversation`}
        title="Pipeline"
        sub="Every company, by where the conversation stands — from the email records and what has been recorded here. No chance of winning is estimated."
      />

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
          <dd>{p.totals.won}</dd>
        </div>
        <div>
          <dt>Lost</dt>
          <dd className="muted">{p.totals.lost}</dd>
        </div>
      </dl>

      {/* ── KANBAN BOARD WORKSPACE ───────────────────────────────────────── */}
      <h2>By stage</h2>
      <div className="board" style={{ marginBottom: 28 }}>
        {p.columns.filter(c => c.leads.length > 0).map(c => (
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
      <h2>Recent activity</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>#</th>
              <th>Company</th>
              <th>What happened</th>
              <th>How</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {p.transitions.map((t, i) => (
              <tr key={`${t.at}-${i}`}>
                <td className="small nowrap">{momentLabel(t.at)}</td>
                <td className="small" style={{ fontFamily: 'var(--mono)' }}>
                  <Link href={`/leads/${t.targetNumber}`} style={{ textDecoration: 'none' }}>
                    {t.targetNumber}
                  </Link>
                </td>
                <td>
                  <strong>{t.company}</strong>
                </td>
                <td className="small">{eventLabel(t.event)}</td>
                <td className="small muted">{t.channel.toLowerCase()}</td>
                <td className="small">{actorName(t.actor)}</td>
              </tr>
            ))}
            {p.transitions.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty">
                  Nothing has been recorded yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
