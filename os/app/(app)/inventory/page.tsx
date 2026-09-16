import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { getInventory } from '@/server/services/operations';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, string> = { CRITICAL: 'bad', LOW: 'warn', HEALTHY: 'ok' };

/**
 * Lead inventory by archetype / vertical / geography, counted from state against explicit thresholds.
 * There is no model here and nothing is predicted: a shortage is a count below a configured number.
 */
export default async function InventoryPage() {
  await requirePermission('lead.view');
  const { report, needs } = await getInventory();
  const t = report.thresholds;

  return (
    <>
      <h1>Inventory</h1>
      <p className="lede">
        How many leads could actually be contacted today, per segment. A segment is <strong>LOW</strong> below {t.low}{' '}
        usable leads and <strong>CRITICAL</strong> at or below {t.critical}. Segments with fewer than {t.minSegmentSize}{' '}
        leads in total are not reported, because the sample is too small to mean anything.
      </p>

      <dl className="stats">
        <div><dt>Leads</dt><dd>{report.totals.leads}</dd></div>
        <div><dt>Usable today</dt><dd>{report.totals.usable}</dd></div>
        <div><dt>Recoverable by research</dt><dd>{report.totals.recoverableByResearch}</dd></div>
        <div><dt>Permanently unavailable</dt><dd>{report.totals.permanentlyUnavailable}</dd></div>
        <div><dt>Segments</dt><dd>{report.segments.length}</dd></div>
        <div><dt>Needing research</dt><dd>{report.needsResearch.length}</dd></div>
      </dl>

      <h2>What is low, and why</h2>
      {needs.length ? (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Segment</th>
                <th>Status</th>
                <th className="num">Usable</th>
                <th className="num">Short by</th>
                <th>Approach</th>
                <th>Blocking gate</th>
                <th>Missing fields</th>
                <th>Why</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {needs.map(n => (
                <tr key={`${n.segment.archetypeId}-${n.segment.vertical ?? ''}-${n.segment.country}`}>
                  <td>
                    {n.segment.archetypeId}
                    {n.segment.vertical ? ` · ${n.segment.vertical}` : ''} · {n.segment.country}
                  </td>
                  <td><span className={`badge ${STATUS_BADGE[n.status]}`}>{n.status}</span></td>
                  <td className="num">{report.segments.find(s => s.segment.archetypeId === n.segment.archetypeId && s.segment.vertical === n.segment.vertical && s.segment.country === n.segment.country)?.usable ?? 0}</td>
                  <td className="num">{n.shortfall}</td>
                  <td><span className="badge info">{n.approach.replace('_', ' ').toLowerCase()}</span></td>
                  <td className="small">{n.blockingGate ?? '—'}</td>
                  <td className="small muted wrap">{n.missingFields.join(', ') || '—'}</td>
                  <td className="wrap small">{n.rationale}</td>
                  <td>
                    <Link
                      className="badge"
                      href={`/research/briefs?archetype=${encodeURIComponent(n.segment.archetypeId)}&country=${encodeURIComponent(n.segment.country)}${n.segment.vertical ? `&vertical=${encodeURIComponent(n.segment.vertical)}` : ''}&count=${Math.min(50, Math.max(1, n.shortfall))}`}
                    >
                      Brief →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel empty">Every reportable segment is at or above the threshold.</div>
      )}

      <h2>All segments</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Archetype</th>
              <th>Vertical</th>
              <th>Geography</th>
              <th className="num">Total</th>
              <th className="num">Usable</th>
              <th className="num">Recoverable</th>
              <th className="num">Unavailable</th>
              <th>Status</th>
              <th>Top blocking gate</th>
            </tr>
          </thead>
          <tbody>
            {report.segments.map(s => (
              <tr key={`${s.segment.archetypeId}-${s.segment.vertical ?? ''}-${s.segment.country}`}>
                <td>{s.segment.archetypeId}</td>
                <td className="small">{s.segment.vertical ?? '—'}</td>
                <td className="small">{s.segment.country}</td>
                <td className="num">{s.total}</td>
                <td className="num">{s.usable}</td>
                <td className="num">{s.recoverableByResearch}</td>
                <td className="num">{s.permanentlyUnavailable}</td>
                <td><span className={`badge ${STATUS_BADGE[s.status]}`}>{s.status}</span></td>
                <td className="small muted">{s.blockingGates[0] ? `${s.blockingGates[0].gate} (${s.blockingGates[0].leads})` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Thresholds are configuration, not methodology. Changing them changes what is flagged, never how a lead is qualified.
      </p>
    </>
  );
}
