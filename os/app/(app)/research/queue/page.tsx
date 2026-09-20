import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { getResearchQueue } from '@/server/services/research-queue';
import { presentField } from '@/server/services/presentation';
import { EmptyState } from '../../components/EmptyState';

export const dynamic = 'force-dynamic';

/**
 * RESEARCH QUEUE — every lead with open research, in core's order.
 *
 * The order, the tasks and what counts as evidence are core's (`buildResearchQueue`). This page only says where to
 * record each finding: the link opens the lead's research form on the right field. Nothing here changes a lead.
 */
export default async function ResearchQueuePage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const actor = await requirePermission('lead.view');
  const { who } = await searchParams;
  const mine = who !== 'all';
  const q = await getResearchQueue(actor, { mine });
  const canRecord = actor.permissions.has('lead.edit') && q.source === 'POSTGRES';

  return (
    <>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div>
          <h1>Research Queue</h1>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            {q.items.length} lead{q.items.length === 1 ? '' : 's'} with open research · ordered by priority, then by how much is missing
          </p>
        </div>
        <span className="small muted">
          {q.me ? (
            mine ? (
              <>Owned by {q.me} · <Link href="/research/queue?who=all">show everyone&rsquo;s</Link></>
            ) : (
              <>Everyone&rsquo;s · <Link href="/research/queue">show only {q.me}&rsquo;s</Link></>
            )
          ) : (
            'Everyone’s'
          )}
        </span>
      </div>

      <p className="lede" style={{ marginBottom: 16 }}>
        The engine lists what each lead is missing and what would count as evidence. Nothing is researched automatically:
        a person finds the fact, records it with its source, and the engine re-qualifies the lead in the same write.
      </p>

      {q.topFields.length ? (
        <div className="panel small" style={{ marginBottom: 16 }}>
          <strong>Blocking the most leads:</strong>{' '}
          {q.topFields.map((f, i) => (
            <span key={f.field}>
              {i ? ' · ' : ''}
              {presentField(f.field)} ({f.leads})
            </span>
          ))}
        </div>
      ) : null}

      {q.items.length === 0 ? (
        <EmptyState title="No open research." description="Every lead has the intelligence the methodology requires." />
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Target</th>
                <th>Company</th>
                <th>Priority</th>
                <th style={{ textAlign: 'right' }}>Research</th>
                <th>Owner</th>
                <th>Open tasks</th>
              </tr>
            </thead>
            <tbody>
              {q.items.map(i => (
                <tr key={i.targetNumber}>
                  <td className="small" style={{ fontFamily: 'var(--mono)' }}>
                    <Link href={`/leads/${i.targetNumber}`}>{i.targetNumber}</Link>
                  </td>
                  <td>
                    <strong>{i.company}</strong>
                  </td>
                  <td className="small">
                    <span className="badge">{i.priority}</span>
                    {i.confidence === 'PROVISIONAL' ? <span className="badge warn" style={{ marginLeft: 4 }}>provisional</span> : null}
                  </td>
                  <td className="small" style={{ textAlign: 'right' }}>{i.completeness}%</td>
                  <td className="small">{i.owner}</td>
                  <td className="wrap small">
                    {i.tasks.slice(0, 3).map(t => (
                      <div key={t.field}>
                        {canRecord && t.recordField ? (
                          <Link href={`/leads/${i.targetNumber}?record=${t.recordField}#record`}>{presentField(t.field)}</Link>
                        ) : (
                          <span>{presentField(t.field)}</span>
                        )}
                        <span className="muted"> — {t.task}</span>
                      </div>
                    ))}
                    {i.tasks.length > 3 ? <div className="muted">…{i.tasks.length - 3} more on the lead page</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
