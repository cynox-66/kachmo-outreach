import { requirePermission } from '@/server/auth/current-actor';
import { getSystemStatus } from '@/server/services/admin';
import { loadCanonical } from '@/server/repo/canonical';
import { phaseBanner, leadWritesEnabled } from '@/server/repo/phase';
import { DEFAULT_THRESHOLDS } from '@kachmo/core/research/inventory.js';
import { ARCHETYPES_V1, TAXONOMY_VERSION } from '@kachmo/core/config/taxonomy.js';
import { METHODOLOGY_V1_0 } from '@/server/methodology/v1';
import { FIELD_OWNERSHIP, PHASES, CUTOVER_PHASES } from '@kachmo/core/reconciliation/ownership.js';

export const dynamic = 'force-dynamic';

/**
 * Configuration, shown read-only.
 *
 * Nothing that changes qualification semantics is editable from a form. Methodology and taxonomy are versioned,
 * code-defined and golden-tested; changing them is a reviewed code change, not a settings toggle.
 */
export default async function SettingsPage() {
  await requirePermission('settings.manage');
  const [status, snapshot] = await Promise.all([getSystemStatus(), loadCanonical().catch(() => null)]);
  const phase = snapshot?.phase ?? 'PRE_CUTOVER';
  const banner = phaseBanner(phase);

  return (
    <>
      <h1>Settings</h1>
      <p className="lede">
        Everything that decides how a lead is qualified is versioned in code and pinned by the golden regression.
        This page shows what is configured; it does not let you change qualification semantics from a form.
      </p>

      <h2>State</h2>
      <div className="panel">
        <dl className="kv">
          <dt>Cutover phase</dt>
          <dd><span className={`badge ${banner.level === 'warn' ? 'warn' : 'info'}`}>{phase}</span> <span className="small muted">{banner.title}</span></dd>
          <dt>Canonical store</dt>
          <dd>{PHASES[phase].canonicalLeadStore} <span className="small muted">(suppression: {PHASES[phase].canonicalSuppressionStore})</span></dd>
          <dt>Lead writes</dt>
          <dd>{leadWritesEnabled(phase) ? <span className="badge ok">enabled</span> : <span className="badge warn">read-only</span>}</dd>
          <dt>Reading from</dt>
          <dd>{snapshot?.source ?? 'unavailable'}</dd>
        </dl>
        <p className="small muted" style={{ margin: '10px 0 0' }}>{banner.detail}</p>
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          Set with <code>KACHMO_CUTOVER_PHASE</code> ({CUTOVER_PHASES.join(' · ')}). Unset means PRE_CUTOVER — the safe direction.
        </p>
      </div>

      <h2>Methodology</h2>
      <div className="panel">
        <dl className="kv">
          <dt>Active version</dt>
          <dd><strong>{status.methodology?.title ?? METHODOLOGY_V1_0.title}</strong></dd>
          <dt>Engine</dt>
          <dd><code>core/</code> — the same code the CLI runs</dd>
          <dt>Golden baseline</dt>
          <dd><code className="small">{METHODOLOGY_V1_0.config.goldenInputCommit.slice(0, 12)}</code></dd>
          <dt>Gates</dt>
          <dd className="small">{METHODOLOGY_V1_0.config.gates.length} — {METHODOLOGY_V1_0.config.gates.filter(g => g.blocksWhenPending).length} blocking</dd>
          <dt>Outreach-usable provenance</dt>
          <dd className="small">{METHODOLOGY_V1_0.config.outreachUsableProvenance.join(', ')}</dd>
        </dl>
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          Known limitation: {METHODOLOGY_V1_0.config.knownLimitations[0]}
        </p>
      </div>

      <h2>Inventory thresholds</h2>
      <div className="panel">
        <dl className="kv">
          <dt>Low below</dt>
          <dd>{DEFAULT_THRESHOLDS.low} usable leads</dd>
          <dt>Critical at or below</dt>
          <dd>{DEFAULT_THRESHOLDS.critical} usable leads</dd>
          <dt>Minimum segment size</dt>
          <dd>{DEFAULT_THRESHOLDS.minSegmentSize} leads before a segment is reported</dd>
        </dl>
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          Configuration, not methodology: changing these changes what is flagged, never how a lead is qualified.
        </p>
      </div>

      <h2>Taxonomy (version {TAXONOMY_VERSION})</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Default owner</th><th>Observed labels</th></tr></thead>
          <tbody>
            {ARCHETYPES_V1.map(a => (
              <tr key={a.id}>
                <td>{a.id}</td>
                <td>{a.name}</td>
                <td className="small">{a.defaultOwner}</td>
                <td className="wrap small muted">
                  {a.observedLabels.join(' · ')}
                  {a.labelsAreVerticals ? <span className="badge warn" style={{ marginLeft: 6 }}>these are verticals, not archetype names</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        Archetype 6 carries ten industry verticals as labels and archetype 2 carries two names. That inconsistency is
        declared rather than silently corrected — see ADR-013. It is an open product decision.
      </p>

      <h2>Field ownership</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Group</th><th className="num">Fields</th><th>Writer (pre → post)</th><th>Immutable</th><th>Why</th></tr></thead>
          <tbody>
            {FIELD_OWNERSHIP.map(g => (
              <tr key={g.group}>
                <td>{g.group}</td>
                <td className="num">{g.fields.length}</td>
                <td className="small">{g.writer.PRE_CUTOVER} → {g.writer.POST_CUTOVER}</td>
                <td>{g.immutable ? <span className="badge">immutable</span> : <span className="muted">·</span>}</td>
                <td className="wrap small muted">{g.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        Every field has exactly one writer in every phase, and an unclassified field is deny-by-default — nobody may
        write it until someone classifies it.
      </p>

      <h2>Database</h2>
      <div className="panel small">
        <dl className="kv">
          {Object.entries(status.counts).map(([table, n]) => (
            <span key={table} style={{ display: 'contents' }}>
              <dt><code>{table}</code></dt>
              <dd>{n}</dd>
            </span>
          ))}
        </dl>
      </div>
    </>
  );
}
