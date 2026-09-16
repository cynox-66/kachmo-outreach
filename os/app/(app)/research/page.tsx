import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { listReports, listCandidates, listBriefs, listApprovedPendingExport } from '@/server/research/service';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, string> = {
  AWAITING_REVIEW: 'info', DUPLICATE_SUSPECTED: 'warn', FLAGGED_CONTRADICTION: 'bad',
  INCOMPLETE: 'warn', SUPPRESSED: 'bad', ACCEPTED: 'ok', REJECTED: '', DEFERRED: '',
};

/** The research pipeline: inventory → brief → external research → upload → review → canonical lead. */
export default async function ResearchPage() {
  const actor = await requirePermission('research.create');
  const [reports, candidates, briefs, approved] = await Promise.all([
    listReports(20),
    listCandidates({ limit: 100 }),
    listBriefs(10),
    listApprovedPendingExport(),
  ]);
  const canApprove = actor.permissions.has('research.approve');

  return (
    <>
      <div className="row between">
        <h1>Research</h1>
        <span className="row">
          <Link className="badge" href="/inventory">Find a gap →</Link>
          <Link className="badge" href="/research/briefs">New brief</Link>
          <Link className="badge" href="/research/upload">Upload a report</Link>
        </span>
      </div>
      <p className="lede">
        A research report never changes a lead. It produces <strong>candidates</strong>, which become canonical leads
        only when a named human approves them — and suppression is re-checked at that moment, not just at extraction.
      </p>

      <dl className="stats">
        <div><dt>Open briefs</dt><dd>{briefs.filter(b => b.status === 'OPEN').length}</dd></div>
        <div><dt>Reports</dt><dd>{reports.length}</dd></div>
        <div><dt>Awaiting review</dt><dd>{candidates.length}</dd></div>
        <div><dt>Approved, pending export</dt><dd>{approved.length}</dd></div>
      </dl>

      <h2>Candidates to review ({candidates.length})</h2>
      {candidates.length ? (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Company</th><th>Archetype</th><th>Geography</th><th>Status</th><th>Why</th><th>Extracted</th><th></th></tr>
            </thead>
            <tbody>
              {candidates.map(c => {
                const a = c.assessment as { reason?: string } | null;
                return (
                  <tr key={c.id}>
                    <td>{c.companyName ?? <span className="muted">unnamed</span>}</td>
                    <td className="small">{c.archetypeId ?? '—'}</td>
                    <td className="small">{c.locationCountry ?? '—'}</td>
                    <td><span className={`badge ${STATUS_BADGE[c.status] ?? ''}`}>{c.status.replace(/_/g, ' ').toLowerCase()}</span></td>
                    <td className="wrap small muted">{a?.reason ?? '—'}</td>
                    <td className="small">{c.createdAt.toISOString().slice(0, 10)}</td>
                    <td><Link className="badge" href={`/research/candidates/${c.id}`}>{canApprove ? 'Review →' : 'View →'}</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel empty">No candidate is waiting. Upload a research report to add some.</div>
      )}

      {approved.length ? (
        <>
          <h2>Approved, pending export ({approved.length})</h2>
          <div className="notice">
            <p>
              These were approved by a human. The canonical lead store is still the committed JSON file, which only
              the CLI writes, so they are queued rather than inserted — writing them here would create a second writer.
            </p>
          </div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Company</th><th>Domain</th><th>Approved by</th><th>When</th></tr></thead>
              <tbody>
                {approved.map(c => (
                  <tr key={c.id}>
                    <td><Link href={`/research/candidates/${c.id}`}>{c.companyName ?? c.candidateId}</Link></td>
                    <td className="small muted">{c.websiteDomain ?? '—'}</td>
                    <td className="small">{c.reviewedByLabel ?? '—'}</td>
                    <td className="small">{c.reviewedAt?.toISOString().slice(0, 10) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <h2>Reports ({reports.length})</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Report</th><th>Provider</th><th>Operator</th><th>File</th><th>Stage</th><th>Extraction</th><th className="num">Problems</th><th>When</th></tr>
          </thead>
          <tbody>
            {reports.map(r => {
              const errors = (r.problems as Array<{ severity: string }>).filter(p => p.severity === 'ERROR').length;
              return (
                <tr key={r.id}>
                  <td className="small"><code>{r.sourceReportId}</code></td>
                  <td className="small">{r.provider}</td>
                  <td className="small">{r.operatorLabel}</td>
                  <td className="small muted">{r.originalFilename} ({r.format}, {r.byteSize}B)</td>
                  <td><span className="badge">{r.stage.replace(/_/g, ' ').toLowerCase()}</span></td>
                  <td><span className={`badge ${r.extractionStatus === 'OK' ? 'ok' : r.extractionStatus === 'FAILED' ? 'bad' : 'warn'}`}>{r.extractionStatus}</span></td>
                  <td className="num">{errors ? <span className="badge bad">{errors}</span> : (r.problems as unknown[]).length}</td>
                  <td className="small">{r.ingestedAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
                </tr>
              );
            })}
            {reports.length === 0 ? <tr><td colSpan={8} className="empty">No report has been uploaded yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <h2>Briefs ({briefs.length})</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Brief</th><th>Archetype</th><th>Geography</th><th className="num">Wanted</th><th>Status</th><th>By</th><th></th></tr></thead>
          <tbody>
            {briefs.map(b => (
              <tr key={b.id}>
                <td className="small"><code>{b.promptId}</code></td>
                <td className="small">{b.archetypeId}{b.vertical ? ` · ${b.vertical}` : ''}</td>
                <td className="small">{(b.geographies as string[]).join(', ')}</td>
                <td className="num">{b.targetCount}</td>
                <td><span className="badge">{b.status}</span></td>
                <td className="small">{b.createdByLabel}</td>
                <td><Link className="badge" href={`/research/briefs?open=${b.id}`}>Open →</Link></td>
              </tr>
            ))}
            {briefs.length === 0 ? <tr><td colSpan={7} className="empty">No brief yet. Start from a real gap on the Inventory page.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
