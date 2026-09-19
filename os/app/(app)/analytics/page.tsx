import { requirePermission } from '@/server/auth/current-actor';
import { getAnalytics } from '@/server/services/operations';

export const dynamic = 'force-dynamic';

/**
 * Measured, never estimated. Ratios below the sample floor are shown as raw counts, and no conversion probability
 * is produced anywhere — `conversion_probability` stays UNKNOWN by design until there is real Kachmo data.
 */
export default async function AnalyticsPage() {
  await requirePermission('analytics.view');
  const a = await getAnalytics();
  const r = a.report;

  return (
    <>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div>
          <h1>Analytics</h1>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            Operational performance · Measured, never estimated
          </p>
        </div>
        <span className="small muted">week {r.week.start} → {r.week.end}</span>
      </div>
      <p className="lede" style={{ marginBottom: 20 }}>{r.note}</p>

      <h2>Funnel (all time)</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Stage</th><th className="num">Count</th></tr></thead>
          <tbody>
            {r.funnel.map(f => (
              <tr key={f.stage}><td>{f.stage}</td><td className="num">{f.count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Stage conversion</h2>
      <div className="panel small">
        {r.conversions.map(c => (
          <p key={`${c.from}-${c.to}`} style={{ margin: '0 0 4px' }}>
            {c.from} → {c.to}: <strong>{c.display}</strong>
          </p>
        ))}
        <p className="muted" style={{ margin: '8px 0 0' }}>
          Conversion probability: <strong>{r.conversion_probability}</strong>. Nothing is predicted from this few data points.
        </p>
      </div>

      <h2>Channels</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Channel</th><th className="num">Attempted</th><th>Responded</th><th>Positive</th></tr></thead>
          <tbody>
            {r.channels.map(c => (
              <tr key={c.channel}>
                <td>{c.channel}</td>
                <td className="num">{c.attempted}</td>
                <td className="small">{c.responded.display}</td>
                <td className="small">{c.positive.display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Archetypes (counts only)</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Archetype</th><th className="num">Leads</th><th className="num">Contacted</th><th className="num">Responded</th><th className="num">Meetings</th><th className="num">Won</th></tr>
          </thead>
          <tbody>
            {r.archetypes.map(x => (
              <tr key={x.archetype}>
                <td className="wrap">{x.archetype}</td>
                <td className="num">{x.leads}</td>
                <td className="num">{x.contacted}</td>
                <td className="num">{x.responded}</td>
                <td className="num">{x.meetings}</td>
                <td className="num">{x.won}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Research throughput</h2>
      <dl className="stats">
        <div><dt>Research recorded</dt><dd>{a.researchThroughput.recorded}</dd></div>
        <div><dt>Provenance updates</dt><dd>{a.researchThroughput.provenanceUpdates}</dd></div>
        <div><dt>Leads discovered</dt><dd>{a.researchThroughput.discovered}</dd></div>
      </dl>

      <h2>Email states</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Status</th><th className="num">Leads</th></tr></thead>
          <tbody>
            {a.emailStates.map(e => <tr key={e.status}><td>{e.status}</td><td className="num">{e.count}</td></tr>)}
          </tbody>
        </table>
      </div>

      <h2>Events</h2>
      <div className="grid2">
        <div className="panel">
          <h3 className="small muted" style={{ margin: '0 0 8px' }}>By type</h3>
          {a.eventsByType.map(e => (
            <p key={e.type} className="small" style={{ margin: '0 0 3px' }}>{e.type}: <strong>{e.count}</strong></p>
          ))}
        </div>
        <div className="panel">
          <h3 className="small muted" style={{ margin: '0 0 8px' }}>By week (last 12)</h3>
          {a.eventsByWeek.map(e => (
            <p key={e.week} className="small" style={{ margin: '0 0 3px' }}>{e.week}: <strong>{e.count}</strong></p>
          ))}
          {a.eventsByWeek.length === 0 ? <p className="small muted">No dated events yet.</p> : null}
        </div>
      </div>

      {Object.keys(r.objections).length ? (
        <>
          <h2>Objections</h2>
          <div className="panel small">
            {Object.entries(r.objections).map(([k, v]) => <p key={k} style={{ margin: '0 0 3px' }}>{k}: {v}</p>)}
          </div>
        </>
      ) : null}

      <p className="small muted" style={{ marginTop: 16 }}>{r.sources}</p>
    </>
  );
}
