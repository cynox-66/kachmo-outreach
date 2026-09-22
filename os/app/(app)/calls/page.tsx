import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { requestSnapshot } from '@/server/services/snapshot';
import { getCallQueue } from '@/server/services/operations';
import { writeStatusFor } from '@/server/services/write-status';
import { VERIFICATION, dayLabel, humanizeExclusion, humanizeRefusal } from '@/server/services/operator';
import { CallForm, WritesUnavailable } from '../components/LeadActions';
import { Disclosure, EmptyNote, PageHead } from '../components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Calls' };

/** A briefing claim with its source state, so nobody quotes an unsourced claim on a call. */
function Said({ label, value, sourced }: { label: string; value: string; sourced: boolean }) {
  const v = VERIFICATION[sourced ? 'SOURCED' : 'UNSOURCED'];
  return (
    <div className={`claim ${sourced ? '' : 'unsourced'}`}>
      <span className="label what">{label}</span>
      <p className="value">{value || '—'}</p>
      <span className="verify">
        <span className="mark" aria-hidden="true">
          {v.mark}
        </span>
        {v.label}
        {sourced ? '' : ' — don’t quote it as fact'}
      </span>
    </div>
  );
}

/**
 * CALLS — who to call today, and the briefing for each call. Only numbers they publish or we confirmed appear here.
 * The app never dials: it prepares the call and records what happened.
 */
export default async function CallsPage() {
  const actor = await requirePermission('outreach.call');
  const q = await getCallQueue(actor, await requestSnapshot());
  const writes = await writeStatusFor(actor);

  return (
    <>
      <PageHead
        label={dayLabel(q.today)}
        title="Calls"
        sub={q.cards.length ? `${q.cards.length} ${q.cards.length === 1 ? 'company is' : 'companies are'} ready to call. Only numbers they publish, or that we confirmed, appear here.` : 'Only numbers they publish, or that we confirmed, appear here.'}
      />

      {q.cards.length === 0 ? (
        <EmptyNote title="Nobody is ready to call." action={{ href: '/leads?status=NEEDS_RESEARCH', label: 'See who needs research' }}>
          {q.unsourcedPhones
            ? `${q.unsourcedPhones} compan${q.unsourcedPhones === 1 ? 'y has' : 'ies have'} a phone number on file, but nobody recorded where it came from — so it isn’t used. Find where they publish it and record it.`
            : 'No company has a usable phone number yet.'}
        </EmptyNote>
      ) : (
        q.cards.map(c => (
          <section key={c.targetNumber} id={`call-${c.targetNumber}`} className="plate" style={{ marginBottom: 'var(--s4)', scrollMarginTop: 'var(--s4)' }}>
            <div className="row between">
              <div style={{ minWidth: 0 }}>
                <span className="label">
                  {c.city}
                  {c.timezone ? ` · ${c.timezone}` : ''}
                  {c.previousAttempts ? ` · ${c.previousAttempts} earlier attempt${c.previousAttempts === 1 ? '' : 's'}` : ''}
                </span>
                <h3 style={{ fontSize: 18, margin: 0 }}>
                  <Link href={`/leads/${c.targetNumber}`} style={{ textDecoration: 'none' }}>
                    {c.company}
                  </Link>
                </h3>
                <p className="muted" style={{ margin: '2px 0 0' }}>
                  {c.decisionMaker}
                  {c.title ? `, ${c.title}` : ''}
                </p>
              </div>
              {c.phoneVisible ? (
                <a className="btn btn-act" href={`tel:${c.phone}`}>
                  Call {c.phone}
                </a>
              ) : (
                <span className="chip">Number hidden for your role</span>
              )}
            </div>

            <div style={{ marginTop: 'var(--s4)' }}>
              <Said label="Why them" value={c.whyThem} sourced={c.whyThemSourced} />
              <Said label="Their website problem" value={c.friction} sourced={c.frictionSourced} />
              <div className="claim">
                <span className="label what">What to aim for</span>
                <p className="value">{c.objective}</p>
              </div>
            </div>

            {c.verifyFirst.length ? (
              <div className="consequence" style={{ marginTop: 'var(--s3)' }}>
                <strong>Before you dial</strong>
                <ul style={{ margin: 'var(--s1) 0 0', paddingLeft: 18 }}>
                  {c.verifyFirst.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Disclosure title="Script and answers to objections">
              <pre className="draft">
                {c.opening}
                {'\n\n'}
                {c.bridge}
              </pre>
              {c.questions.length ? (
                <>
                  <span className="label">Questions to ask</span>
                  <ol className="small" style={{ margin: '0 0 var(--s3)', paddingLeft: 18 }}>
                    {c.questions.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ol>
                </>
              ) : null}
              {c.objections.length ? (
                <>
                  <span className="label">If they say…</span>
                  <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {c.objections.map((o, i) => (
                      <li key={i}>
                        <em>{o.objection}</em> → {o.response}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {c.doNotSay.length ? (
                <>
                  <span className="label" style={{ marginTop: 'var(--s3)' }}>
                    Don’t say
                  </span>
                  <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {c.doNotSay.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </Disclosure>

            <div style={{ marginTop: 'var(--s4)' }}>
              <span className="label">After the call</span>
              {q.source !== 'POSTGRES' ? (
                <p className="small muted" style={{ margin: 0 }}>Calls are recorded with the command-line tools until the database is the source of truth.</p>
              ) : writes.canWrite && c.version !== null ? (
                <CallForm target={{ leadId: c.leadId, version: c.version, targetNumber: c.targetNumber }} />
              ) : (
                <WritesUnavailable reason={humanizeRefusal(writes.reason ?? 'this company changed; reload the page.')} />
              )}
            </div>
          </section>
        ))
      )}

      {q.excluded.length ? (
        <>
          <h2>Not ready to call</h2>
          <Disclosure title="Why these companies can’t be called yet" meta={`${q.excluded.length}`}>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Why not</th>
                  </tr>
                </thead>
                <tbody>
                  {q.excluded.map(e => (
                    <tr key={e.targetNumber}>
                      <td>
                        <Link href={`/leads/${e.targetNumber}`}>{e.company}</Link>
                      </td>
                      <td className="wrap small muted">{humanizeExclusion(e.reason)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Disclosure>
        </>
      ) : null}
    </>
  );
}
