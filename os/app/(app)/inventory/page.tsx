import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { getInventory } from '@/server/services/operations';
import { presentGate, presentField } from '@/server/services/presentation';
import { EmptyState } from '../components/EmptyState';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, string> = { CRITICAL: 'bad', LOW: 'warn', HEALTHY: 'ok' };

/**
 * INVENTORY — Actionable lead stock and segment health.
 *
 * Answers:
 * 1. Where are we running low?
 * 2. Why are we running low? (Translated blocking gates)
 * 3. What should we do? (Research existing leads or replenish)
 */
export default async function InventoryPage() {
  await requirePermission('lead.view');
  const { report, needs } = await getInventory();
  const t = report.thresholds;

  return (
    <>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div>
          <h1>Inventory</h1>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            Usable lead volume across commercial archetypes and geographies
          </p>
        </div>
      </div>

      <p className="lede" style={{ marginBottom: 20 }}>
        A segment is <strong>Low</strong> below {t.low} usable leads and <strong>Critical</strong> at or below {t.critical}.
        Only segments with at least {t.minSegmentSize} total leads are evaluated.
      </p>

      {/* ── TOTALS OVERVIEW ──────────────────────────────────────────────── */}
      <dl className="stats" style={{ marginBottom: 24 }}>
        <div>
          <dt>Total Leads</dt>
          <dd>{report.totals.leads}</dd>
        </div>
        <div>
          <dt>Usable Today</dt>
          <dd>{report.totals.usable}</dd>
        </div>
        <div>
          <dt>Recoverable by Research</dt>
          <dd>{report.totals.recoverableByResearch}</dd>
        </div>
        <div>
          <dt>Segments Monitored</dt>
          <dd>{report.segments.length}</dd>
        </div>
        <div>
          <dt>Segments Below Target</dt>
          <dd>{report.needsResearch.length}</dd>
        </div>
      </dl>

      {/* ── SECTION 1: WHERE ARE WE RUNNING LOW? ─────────────────────────── */}
      <h2>Where Are We Running Low?</h2>

      {needs.length === 0 ? (
        <EmptyState
          title="All monitored segments are healthy."
          description="Every segment meets or exceeds minimum usable lead thresholds."
          style={{ marginBottom: 28 }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
          {needs.map(n => {
            const segmentRow = report.segments.find(
              s =>
                s.segment.archetypeId === n.segment.archetypeId &&
                s.segment.vertical === n.segment.vertical &&
                s.segment.country === n.segment.country
            );
            const usableCount = segmentRow?.usable ?? 0;
            const segmentTitle = `${n.segment.archetypeId}${n.segment.vertical ? ` · ${n.segment.vertical}` : ''} · ${n.segment.country}`;
            const translatedGate = presentGate(n.blockingGate);
            const translatedFields = n.missingFields.map(f => presentField(f)).join(', ');

            return (
              <div
                key={`${n.segment.archetypeId}-${n.segment.vertical ?? ''}-${n.segment.country}`}
                className={`action-card ${n.status === 'CRITICAL' ? 'critical' : 'warn'}`}
              >
                <div className="action-card-header">
                  <div>
                    <div className="action-card-company">
                      <strong>{segmentTitle}</strong>
                      <span className={`badge ${STATUS_BADGE[n.status]}`}>{n.status}</span>
                    </div>
                    <p className="action-card-sub muted small">
                      {usableCount} usable lead{usableCount === 1 ? '' : 's'} · short by {n.shortfall}
                    </p>
                  </div>

                  <div className="action-card-actions">
                    <Link
                      href={`/leads?archetype=${encodeURIComponent(n.segment.archetypeId)}&country=${encodeURIComponent(n.segment.country)}`}
                      className="badge ghost"
                      style={{ textDecoration: 'none' }}
                    >
                      View leads
                    </Link>
                    <Link
                      href={`/leads?archetype=${encodeURIComponent(n.segment.archetypeId)}&country=${encodeURIComponent(n.segment.country)}&state=RESEARCH_REQUIRED`}
                      className="action-card-btn"
                    >
                      Research existing →
                    </Link>
                  </div>
                </div>

                <div className="action-card-body">
                  <p className="action-card-what">
                    <span className="action-tag">BLOCKING REASON:</span> {translatedGate}
                  </p>
                  {translatedFields ? (
                    <p className="action-card-why muted small">
                      <span className="action-tag-muted">MISSING INTELLIGENCE:</span> {translatedFields}
                    </p>
                  ) : null}
                  {n.rationale ? (
                    <p className="action-card-why muted small" style={{ marginTop: 2 }}>
                      {n.rationale}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── SECTION 2: ALL SEGMENTS ──────────────────────────────────────── */}
      <h2>All Segments ({report.segments.length})</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Segment</th>
              <th>Status</th>
              <th className="num">Total</th>
              <th className="num">Usable</th>
              <th className="num">Recoverable</th>
              <th className="num">Unavailable</th>
              <th>Top Bottleneck</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {report.segments.map(s => {
              const segLabel = `${s.segment.archetypeId}${s.segment.vertical ? ` · ${s.segment.vertical}` : ''} · ${s.segment.country}`;
              const topGate = s.blockingGates[0]?.gate ? presentGate(s.blockingGates[0].gate) : 'None';

              return (
                <tr key={`${s.segment.archetypeId}-${s.segment.vertical ?? ''}-${s.segment.country}`}>
                  <td>
                    <strong>{segLabel}</strong>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[s.status]}`}>{s.status}</span>
                  </td>
                  <td className="num">{s.total}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{s.usable}</td>
                  <td className="num">{s.recoverableByResearch}</td>
                  <td className="num muted">{s.permanentlyUnavailable}</td>
                  <td className="small muted">{topGate}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Link
                      href={`/leads?archetype=${encodeURIComponent(s.segment.archetypeId)}&country=${encodeURIComponent(s.segment.country)}`}
                      className="badge ghost"
                      style={{ textDecoration: 'none' }}
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
