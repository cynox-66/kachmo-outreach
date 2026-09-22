import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { getResearchQueue } from '@/server/services/research-queue';
import { requestSnapshot } from '@/server/services/snapshot';
import { researchTaskLabel } from '@/server/services/operator';
import { EmptyNote, PageHead } from '../../components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Research queue' };

/**
 * RESEARCH QUEUE — every company with something to find, in the engine's order (priority, then how much is missing).
 * The order and what counts as evidence are core's; this page says where to record each finding. Nothing here
 * changes a company.
 */
export default async function ResearchQueuePage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const actor = await requirePermission('lead.view');
  const { who } = await searchParams;
  const mine = who !== 'all';
  const q = await getResearchQueue(actor, { mine, snapshot: await requestSnapshot() });
  const canRecord = actor.permissions.has('lead.edit') && q.source === 'POSTGRES';

  return (
    <>
      <Link className="crumb" href="/research">
        ← Research
      </Link>
      <PageHead
        label={`${q.items.length} compan${q.items.length === 1 ? 'y' : 'ies'}`}
        title="What to find"
        sub="A person finds each fact and records it with its source; the company is re-checked in the same step. Nothing is researched automatically."
        aside={
          q.me ? (
            <span className="small muted">
              {mine ? (
                <>
                  Yours · <Link href="/research/queue?who=all">everyone’s</Link>
                </>
              ) : (
                <>
                  Everyone’s · <Link href="/research/queue">only yours</Link>
                </>
              )}
            </span>
          ) : null
        }
      />

      {q.topFields.length ? (
        <p className="small muted">
          Most often missing: {q.topFields.slice(0, 4).map((f, i) => `${i ? ', ' : ''}${researchTaskLabel(f.field)} (${f.leads})`)}
        </p>
      ) : null}

      {q.items.length === 0 ? (
        <EmptyNote title="Nothing to find." >Every company has what the next step needs.</EmptyNote>
      ) : (
        <ul className="rows">
          {q.items.map(i => (
            <li key={i.targetNumber} className="work">
              <div style={{ minWidth: 0 }}>
                <div className="who-line">
                  <Link className="company" href={`/leads/${i.targetNumber}`}>
                    {i.company}
                  </Link>
                  <span className="where mono">
                    {i.priority === 'UNSCORED' ? '' : `Priority ${i.priority}${i.confidence === 'PROVISIONAL' ? ' · provisional' : ''} · `}
                    {i.completeness}% researched
                  </span>
                </div>
                <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {i.tasks.slice(0, 3).map(t => (
                    <li key={t.field}>
                      {canRecord && t.recordField ? <Link href={`/leads/${i.targetNumber}?record=${t.recordField}#record`}>Find {researchTaskLabel(t.field)}</Link> : <>Find {researchTaskLabel(t.field)}</>}
                    </li>
                  ))}
                  {i.tasks.length > 3 ? <li className="muted">and {i.tasks.length - 3} more on the company page</li> : null}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
