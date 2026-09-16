import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { getPipeline } from '@/server/services/operations';

export const dynamic = 'force-dynamic';

/** The pipeline, using only the states the system already records. No new stage model is invented here. */
export default async function PipelinePage() {
  await requirePermission('pipeline.update');
  const p = await getPipeline();

  return (
    <>
      <h1>Pipeline</h1>
      <p className="lede">
        Every lead in the state the system actually recorded — the lead&rsquo;s own sales state where one exists,
        otherwise the Titan ledger&rsquo;s. No probability is attached to any stage.
      </p>

      <dl className="stats">
        <div><dt>In pipeline</dt><dd>{p.totals.inPipeline}</dd></div>
        <div><dt>Meetings</dt><dd>{p.totals.meetings}</dd></div>
        <div><dt>Proposals</dt><dd>{p.totals.proposals}</dd></div>
        <div><dt>Won</dt><dd>{p.totals.won}</dd></div>
        <div><dt>Lost</dt><dd>{p.totals.lost}</dd></div>
      </dl>

      <h2>Board</h2>
      <div className="board">
        {p.columns.map(c => (
          <div className="col" key={c.key}>
            <h3>
              <span>{c.label}</span>
              <span>{c.leads.length}</span>
            </h3>
            {c.leads.slice(0, 25).map(l => (
              <div className="card" key={l.targetNumber}>
                <Link href={`/leads/${l.targetNumber}`}>
                  <strong>{l.targetNumber}</strong> {l.company}
                </Link>
                {l.value ? <div className="muted">{l.value}</div> : null}
                {l.nextAction ? <div className="muted">{l.nextAction}{l.due ? ` · ${l.due}` : ''}</div> : null}
              </div>
            ))}
            {c.leads.length > 25 ? <p className="small muted">…and {c.leads.length - 25} more</p> : null}
            {c.leads.length === 0 ? <p className="small muted">—</p> : null}
          </div>
        ))}
      </div>

      <h2>Recent transitions</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>When</th><th>Target</th><th>Company</th><th>Event</th><th>Channel</th><th>Actor</th></tr></thead>
          <tbody>
            {p.transitions.map((t, i) => (
              <tr key={`${t.at}-${i}`}>
                <td className="small">{t.at.slice(0, 16).replace('T', ' ')}</td>
                <td><Link href={`/leads/${t.targetNumber}`}>{t.targetNumber}</Link></td>
                <td>{t.company}</td>
                <td><span className="badge">{t.event}</span></td>
                <td className="small muted">{t.channel}</td>
                <td className="small">{t.actor}</td>
              </tr>
            ))}
            {p.transitions.length === 0 ? (
              <tr><td colSpan={6} className="empty">No pipeline transition has been recorded yet.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
