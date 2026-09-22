import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { listReports, listCandidates, listBriefs, listApprovedPendingExport } from '@/server/research/service';
import { getResearchQueue } from '@/server/services/research-queue';
import { requestSnapshot } from '@/server/services/snapshot';
import { dayLabel, researchTaskLabel } from '@/server/services/operator';
import { Chip, Disclosure, EmptyNote, PageHead } from '../components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Research' };

/** Suggested-company statuses in operator words. */
const CANDIDATE_STATUS: Record<string, { label: string; tone: 'act' | 'stop' | 'neutral' }> = {
  AWAITING_REVIEW: { label: 'Ready to review', tone: 'act' },
  DUPLICATE_SUSPECTED: { label: 'May already be in the list', tone: 'neutral' },
  FLAGGED_CONTRADICTION: { label: 'Sources disagree', tone: 'stop' },
  INCOMPLETE: { label: 'Missing facts', tone: 'neutral' },
  SUPPRESSED: { label: 'On the do-not-contact list', tone: 'stop' },
  DEFERRED: { label: 'Deferred', tone: 'neutral' },
};

/**
 * RESEARCH — what to find next, and the companies research suggests. Suggested companies only become companies in the
 * list when a person approves them; the do-not-contact list is re-checked at that moment.
 */
export default async function ResearchPage() {
  const actor = await requirePermission('research.create');
  const snap = await requestSnapshot();
  const [reports, candidates, briefs, approved, queue] = await Promise.all([listReports(20), listCandidates({ limit: 100 }), listBriefs(10), listApprovedPendingExport(), getResearchQueue(actor, { mine: false, snapshot: snap })]);
  const canApprove = actor.permissions.has('research.approve');
  const canRecord = actor.permissions.has('lead.edit') && queue.source === 'POSTGRES';

  return (
    <>
      <PageHead
        title="Research"
        sub="Find the facts the next step needs, and review the new companies research suggests."
        aside={
          actor.permissions.has('research.upload') ? (
            <Link className="btn" href="/research/upload">
              Upload research
            </Link>
          ) : null
        }
      />

      <div className="group-head">
        <h2>Companies that need research</h2>
        <Link className="small" href="/research/queue">
          All {queue.items.length} →
        </Link>
      </div>
      {queue.items.length ? (
        <ul className="rows">
          {queue.items.slice(0, 8).map(i => {
            const t = i.tasks[0];
            return (
              <li key={i.targetNumber} className="work">
                <div style={{ minWidth: 0 }}>
                  <div className="who-line">
                    <Link className="company" href={`/leads/${i.targetNumber}`}>
                      {i.company}
                    </Link>
                    <span className="where mono">{i.priority === 'UNSCORED' ? '' : `Priority ${i.priority}`}</span>
                  </div>
                  <p className="sentence">
                    Find {t ? researchTaskLabel(t.field) : 'the missing facts'}
                    {i.tasks.length > 1 ? <span className="muted"> · {i.tasks.length - 1} more after that</span> : null}
                  </p>
                </div>
                <div className="aside">
                  {canRecord && t?.recordField ? (
                    <Link className="btn btn-sm" href={`/leads/${i.targetNumber}?record=${t.recordField}#record`}>
                      Add research
                    </Link>
                  ) : (
                    <Link className="btn btn-sm" href={`/leads/${i.targetNumber}`}>
                      Open company
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyNote title="No company is waiting for research." />
      )}

      <div className="group-head">
        <h2>Suggested companies to review</h2>
        <span className="label">{candidates.length}</span>
      </div>
      {candidates.length ? (
        <ul className="rows">
          {candidates.map(c => {
            const s = CANDIDATE_STATUS[c.status] ?? { label: c.status.toLowerCase().replace(/_/g, ' '), tone: 'neutral' as const };
            const a = c.assessment as { reason?: string } | null;
            return (
              <li key={c.id} className="work">
                <div style={{ minWidth: 0 }}>
                  <div className="who-line">
                    <Link className="company" href={`/research/candidates/${c.id}`}>
                      {c.companyName ?? 'Unnamed company'}
                    </Link>
                    <span className="where">
                      {c.locationCountry ?? ''} · suggested {dayLabel(c.createdAt.toISOString().slice(0, 10))}
                    </span>
                  </div>
                  {a?.reason ? <p className="sentence muted">{a.reason}</p> : null}
                </div>
                <div className="aside">
                  <Chip tone={s.tone}>{s.label}</Chip>
                  <Link className="btn btn-sm" href={`/research/candidates/${c.id}`}>
                    {canApprove ? 'Review' : 'View'}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyNote title="No suggested companies are waiting." action={actor.permissions.has('research.upload') ? { href: '/research/upload', label: 'Upload research' } : undefined}>
          Upload a research report and the companies it names appear here for review.
        </EmptyNote>
      )}

      {approved.length ? (
        <div className="plate act banner" style={{ marginTop: 'var(--s5)' }}>
          <span className="chip act">Needs an owner</span>
          <div className="body">
            <p>
              <strong>
                {approved.length} approved suggestion{approved.length === 1 ? ' was' : 's were'} never added to the list.
              </strong>{' '}
              They were approved before the database became the source of truth. An owner needs to add or re-review them:{' '}
              {approved.map((c, i) => (
                <span key={c.id}>
                  {i ? ', ' : ''}
                  <Link href={`/research/candidates/${c.id}`}>{c.companyName ?? c.candidateId}</Link>
                </span>
              ))}
              .
            </p>
          </div>
        </div>
      ) : null}

      <h2>Research material</h2>
      <Disclosure title="Uploaded reports" meta={`${reports.length}`}>
        {reports.length ? (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Report</th>
                  <th>From</th>
                  <th>Read</th>
                  <th className="num">Problems</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {reports.map(r => {
                  const errors = (r.problems as Array<{ severity: string }>).filter(p => p.severity === 'ERROR').length;
                  return (
                    <tr key={r.id}>
                      <td className="wrap small">
                        {r.originalFilename}
                        <div className="muted mono">{r.sourceReportId}</div>
                      </td>
                      <td className="small">
                        {r.provider} · {r.operatorLabel}
                      </td>
                      <td className="small">{r.extractionStatus === 'OK' ? 'Fully' : r.extractionStatus === 'FAILED' ? 'Could not be read' : 'Partly'}</td>
                      <td className="num">{errors || (r.problems as unknown[]).length}</td>
                      <td className="small nowrap">{dayLabel(r.ingestedAt.toISOString().slice(0, 10))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">No report has been uploaded yet.</p>
        )}
      </Disclosure>
      <Disclosure title="Research briefs" meta={`${briefs.filter(b => b.status === 'OPEN').length} open`}>
        <p className="small muted" style={{ marginTop: 0 }}>
          A brief tells an outside researcher exactly what to find. <Link href="/research/briefs">Write or open a brief →</Link>
        </p>
        {briefs.length ? (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Brief</th>
                  <th>Where</th>
                  <th className="num">Companies</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {briefs.map(b => (
                  <tr key={b.id}>
                    <td className="small">
                      <Link href={`/research/briefs?open=${b.id}`}>{b.promptId}</Link>
                    </td>
                    <td className="small">{(b.geographies as string[]).join(', ')}</td>
                    <td className="num">{b.targetCount}</td>
                    <td className="small">{b.status.toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Disclosure>
      <p className="small muted" style={{ marginTop: 'var(--s4)' }}>
        <Link href="/inventory">Where are we running low on companies?</Link>
      </p>
    </>
  );
}
