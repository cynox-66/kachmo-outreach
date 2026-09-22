import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { getInventory } from '@/server/services/operations';
import { presentGate } from '@/server/services/presentation';
import { requestSnapshot } from '@/server/services/snapshot';
import { researchTaskLabel } from '@/server/services/operator';
import { archetypeById } from '@kachmo/core/config/taxonomy.js';
import { EmptyNote, PageHead } from '../components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inventory' };

const segmentName = (s: { archetypeId: string; vertical: string | null; country: string }) =>
  `${archetypeById(s.archetypeId)?.name ?? s.archetypeId}${s.vertical ? ` · ${s.vertical}` : ''} · ${s.country}`;

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
  const { report, needs } = await getInventory(await requestSnapshot());
  const t = report.thresholds;

  return (
    <>
      <PageHead
        label="System"
        title="Inventory"
        sub={`Where we are running low on companies we can actually contact. A group is low below ${t.low} usable companies and critical at ${t.critical} or fewer; groups with fewer than ${t.minSegmentSize} companies are not judged.`}
      />

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
      <h2>Running low</h2>

      {needs.length === 0 ? (
        <EmptyNote title="No group is running low." />
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
            const segmentTitle = segmentName(n.segment);
            const translatedGate = presentGate(n.blockingGate);
            const translatedFields = n.missingFields.map(f => researchTaskLabel(f)).join(', ');

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
                      className="btn btn-sm"
                    >
                      View companies
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
                    <span className="label" style={{ display: 'inline', marginRight: 6 }}>Held back by</span> {translatedGate}
                  </p>
                  {translatedFields ? (
                    <p className="action-card-why muted small">
                      <span className="label" style={{ display: 'inline', marginRight: 6 }}>Missing</span> {translatedFields}
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
      <h2>All groups ({report.segments.length})</h2>
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
              const segLabel = segmentName(s.segment);
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
                      className="btn btn-sm"
                    >
                      View
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
