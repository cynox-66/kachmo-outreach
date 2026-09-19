import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { listReports, listCandidates, listBriefs, listApprovedPendingExport } from '@/server/research/service';
import { listLeads } from '@/server/services/leads';
import { presentStatus } from '@/server/services/presentation';
import { ActionCard } from '../components/ActionCard';
import { EmptyState } from '../components/EmptyState';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, string> = {
  AWAITING_REVIEW: 'info',
  DUPLICATE_SUSPECTED: 'warn',
  FLAGGED_CONTRADICTION: 'bad',
  INCOMPLETE: 'warn',
  SUPPRESSED: 'bad',
  ACCEPTED: 'ok',
  REJECTED: '',
  DEFERRED: '',
};

/**
 * RESEARCH — Action-oriented research workspace.
 *
 * Focuses first on "What research needs to happen?", showing the highest-priority
 * leads with missing intelligence, followed by candidate review and uploaded reports.
 */
export default async function ResearchPage() {
  const actor = await requirePermission('research.create');
  const [reports, candidates, briefs, approved, researchLeadsResult] = await Promise.all([
    listReports(20),
    listCandidates({ limit: 100 }),
    listBriefs(10),
    listApprovedPendingExport(),
    listLeads({ researchState: 'RESEARCH_REQUIRED', sort: 'priority', pageSize: 8 }),
  ]);

  const canApprove = actor.permissions.has('research.approve');
  const openBriefsCount = briefs.filter(b => b.status === 'OPEN').length;

  return (
    <>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div>
          <h1>Research</h1>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            {researchLeadsResult.total} leads currently need more intelligence
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link className="badge ghost" href="/inventory" style={{ textDecoration: 'none' }}>
            Inventory gaps →
          </Link>
          <Link className="badge ghost" href="/research/briefs" style={{ textDecoration: 'none' }}>
            Briefs ({openBriefsCount})
          </Link>
          <Link className="badge" href="/research/upload" style={{ textDecoration: 'none' }}>
            Upload report
          </Link>
        </div>
      </div>

      <p className="lede" style={{ marginBottom: 20 }}>
        External research produces <strong>candidates</strong>. They become canonical leads only when a human approves
        them — suppression is re-checked at approval time, never trusted from extraction.
      </p>

      {/* ── METRICS OVERVIEW ──────────────────────────────────────────────── */}
      <dl className="stats" style={{ marginBottom: 24 }}>
        <div>
          <dt>Leads Needing Research</dt>
          <dd>{researchLeadsResult.total}</dd>
        </div>
        <div>
          <dt>Candidates In Review</dt>
          <dd>{candidates.length}</dd>
        </div>
        <div>
          <dt>Approved (Queued)</dt>
          <dd>{approved.length}</dd>
        </div>
        <div>
          <dt>Reports Ingested</dt>
          <dd>{reports.length}</dd>
        </div>
      </dl>

      {/* ── SECTION 1: LEADS NEEDING RESEARCH ─────────────────────────────── */}
      <div className="row between" style={{ alignItems: 'baseline', marginBottom: 8 }}>
        <h2>What Needs Research Right Now</h2>
        <Link href="/leads?state=RESEARCH_REQUIRED" className="small muted" style={{ textDecoration: 'none' }}>
          View all {researchLeadsResult.total} leads →
        </Link>
      </div>

      {researchLeadsResult.rows.length === 0 ? (
        <EmptyState
          title="No leads currently need research."
          description="Every lead in the system has complete verified information."
          style={{ marginBottom: 24 }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
          {researchLeadsResult.rows.map(r => (
            <ActionCard
              key={r.leadId}
              title={r.company}
              targetNumber={r.targetNumber}
              subtitle={`${r.archetype}${r.vertical ? ` · ${r.vertical}` : ''} · ${r.city ? `${r.city}, ` : ''}${r.country}`}
              what={r.nextAction ?? 'Identify decision-maker and direct contact route'}
              why={r.contactability.callable || r.contactability.emailable ? 'Contact routes exist, but further evidence verification is needed.' : 'Missing verified contact routes and decision-maker provenance.'}
              owner={r.owner}
              due={r.nextActionDate}
              statusBadge={r.priorityLabel}
              actionHref={`/leads/${r.targetNumber}`}
              actionLabel="Research lead →"
              secondaryHref={`/leads/${r.targetNumber}`}
              secondaryLabel="View intelligence"
            />
          ))}
        </div>
      )}

      {/* ── SECTION 2: CANDIDATES AWAITING REVIEW ─────────────────────────── */}
      <h2>Candidates Awaiting Review ({candidates.length})</h2>
      {candidates.length ? (
        <div className="tablewrap" style={{ marginBottom: 28 }}>
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Archetype</th>
                <th>Geography</th>
                <th>Status</th>
                <th>Assessment</th>
                <th>Extracted</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map(c => {
                const a = c.assessment as { reason?: string } | null;
                return (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.companyName ?? <span className="muted">unnamed</span>}</strong>
                    </td>
                    <td className="small muted">{c.archetypeId ?? '—'}</td>
                    <td className="small">{c.locationCountry ?? '—'}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[c.status] ?? ''}`}>
                        {presentStatus(c.status)}
                      </span>
                    </td>
                    <td className="wrap small muted">{a?.reason ?? '—'}</td>
                    <td className="small">{c.createdAt.toISOString().slice(0, 10)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Link className="badge ghost" href={`/research/candidates/${c.id}`} style={{ textDecoration: 'none' }}>
                        {canApprove ? 'Review →' : 'View →'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No candidates waiting in review."
          description="Upload an external research report to extract and assess new candidates."
          style={{ marginBottom: 28 }}
        />
      )}

      {/* ── SECTION 3: APPROVED CANDIDATES QUEUE ──────────────────────────── */}
      {approved.length ? (
        <div style={{ marginBottom: 28 }}>
          <h2>Approved Candidates ({approved.length})</h2>
          <div className="notice" style={{ marginBottom: 12 }}>
            <p className="small">
              These candidates were approved by a human operator and are queued for canonical import.
            </p>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Domain</th>
                  <th>Approved By</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {approved.map(c => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/research/candidates/${c.id}`} style={{ textDecoration: 'none', fontWeight: 550 }}>
                        {c.companyName ?? c.candidateId}
                      </Link>
                    </td>
                    <td className="small muted">{c.websiteDomain ?? '—'}</td>
                    <td className="small">{c.reviewedByLabel ?? '—'}</td>
                    <td className="small">{c.reviewedAt?.toISOString().slice(0, 10) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* ── SECTION 4: INGESTED REPORTS ───────────────────────────────────── */}
      <h2>Ingested Reports ({reports.length})</h2>
      <div className="tablewrap" style={{ marginBottom: 28 }}>
        <table>
          <thead>
            <tr>
              <th>Report</th>
              <th>Provider</th>
              <th>Operator</th>
              <th>File</th>
              <th>Status</th>
              <th>Extraction</th>
              <th className="num">Issues</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {reports.map(r => {
              const errors = (r.problems as Array<{ severity: string }>).filter(p => p.severity === 'ERROR').length;
              return (
                <tr key={r.id}>
                  <td className="small"><code>{r.sourceReportId}</code></td>
                  <td className="small">{r.provider}</td>
                  <td className="small">{r.operatorLabel}</td>
                  <td className="small muted">{r.originalFilename} ({r.format})</td>
                  <td><span className="badge">{r.stage.replace(/_/g, ' ').toLowerCase()}</span></td>
                  <td>
                    <span className={`badge ${r.extractionStatus === 'OK' ? 'ok' : r.extractionStatus === 'FAILED' ? 'bad' : 'warn'}`}>
                      {r.extractionStatus}
                    </span>
                  </td>
                  <td className="num">{errors ? <span className="badge bad">{errors}</span> : (r.problems as unknown[]).length}</td>
                  <td className="small">{r.ingestedAt.toISOString().slice(0, 10)}</td>
                </tr>
              );
            })}
            {reports.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty">No report has been uploaded yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* ── SECTION 5: RESEARCH BRIEFS ────────────────────────────────────── */}
      <h2>Research Briefs ({briefs.length})</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Brief ID</th>
              <th>Archetype</th>
              <th>Geography</th>
              <th className="num">Target Count</th>
              <th>Status</th>
              <th>Created By</th>
              <th style={{ textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {briefs.map(b => (
              <tr key={b.id}>
                <td className="small"><code>{b.promptId}</code></td>
                <td className="small">{b.archetypeId}{b.vertical ? ` · ${b.vertical}` : ''}</td>
                <td className="small">{(b.geographies as string[]).join(', ')}</td>
                <td className="num">{b.targetCount}</td>
                <td><span className="badge">{b.status}</span></td>
                <td className="small">{b.createdByLabel}</td>
                <td style={{ textAlign: 'right' }}>
                  <Link className="badge ghost" href={`/research/briefs?open=${b.id}`} style={{ textDecoration: 'none' }}>
                    Open →
                  </Link>
                </td>
              </tr>
            ))}
            {briefs.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">No research brief active.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
