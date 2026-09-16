import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { getCallQueue } from '@/server/services/operations';

export const dynamic = 'force-dynamic';

/** Today's call cards. The system records human calls; it never places one. */
export default async function CallsPage() {
  const actor = await requirePermission('outreach.call');
  const q = await getCallQueue(actor);

  return (
    <>
      <div className="row between">
        <h1>Calls</h1>
        <span className="small muted">{q.today} (IST)</span>
      </div>
      <p className="lede">
        Only phones with a recorded public source or a verified basis appear here. This system places no calls and
        dials nothing — it prepares the card and records what a human did afterwards.
      </p>

      {q.cards.length === 0 ? (
        <div className="notice">
          <p>
            <strong>Nothing is callable today.</strong> {q.unsourcedPhones} lead(s) have a phone number on file, but none
            has a recorded source, so none may be called.
          </p>
          <p className="small">
            Record a source first: <code>npm run leads:record -- --lead=&lt;target&gt; --field=phone --status=PUBLICLY_LISTED --source=&lt;url&gt;</code>
          </p>
        </div>
      ) : null}

      {q.cards.map(c => (
        <div className="panel" key={c.targetNumber} style={{ marginBottom: 12 }}>
          <div className="row between">
            <h2 style={{ margin: 0 }}>
              <Link href={`/leads/${c.targetNumber}`}>
                {c.targetNumber} · {c.company}
              </Link>
            </h2>
            <span>
              <span className="badge">{c.priority}</span> <span className="badge">research {c.researchCompleteness}%</span>
            </span>
          </div>
          <p className="small muted" style={{ margin: '4px 0 10px' }}>
            {c.decisionMaker} ({c.title}) · <code>{c.phone}</code>{' '}
            <span className="badge ok">{c.phoneStatus}</span>
            {c.phoneSource ? <span className="small"> — {c.phoneSource}</span> : null}
            {' · '}
            {c.city} {c.timezone ? `(${c.timezone})` : ''}
            {c.previousAttempts ? ` · ${c.previousAttempts} previous attempt(s)` : ''}
          </p>

          <dl className="kv">
            <dt>Why them</dt>
            <dd className="wrap">{c.whyThem}</dd>
            <dt>Friction</dt>
            <dd className="wrap">{c.friction}</dd>
            <dt>Angle</dt>
            <dd className="wrap">{c.angle}</dd>
            <dt>Why now</dt>
            <dd className="wrap">{c.whyNow ?? <span className="muted">none known — do not invent one</span>}</dd>
            <dt>Objective</dt>
            <dd className="wrap">{c.objective}</dd>
          </dl>

          <p className="small muted" style={{ margin: '12px 0 4px' }}>Before dialling</p>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {c.verifyFirst.map(v => <li key={v}>{v}</li>)}
          </ul>

          <p className="small muted" style={{ margin: '12px 0 4px' }}>Open</p>
          <pre className="draft">{c.opening}{'\n\n'}{c.bridge}</pre>

          <p className="small muted" style={{ margin: '8px 0 4px' }}>Ask</p>
          <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {c.questions.map(x => <li key={x}>{x}</li>)}
          </ol>

          <p className="small muted" style={{ margin: '12px 0 4px' }}>If they say…</p>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {c.objections.map(o => (
              <li key={o.objection}>
                <em>{o.objection}</em> → {o.response}
              </li>
            ))}
          </ul>

          <p className="small" style={{ margin: '12px 0 4px' }}>
            <strong>Don&rsquo;t:</strong> <span className="muted">{c.doNotSay.join(' · ')}</span>
          </p>
          <p className="small" style={{ margin: 0 }}>
            Log it: <code>{c.logCommand}</code>
          </p>
        </div>
      ))}

      <h2>Not callable ({q.excluded.length})</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Target</th><th>Company</th><th>Why not</th></tr>
          </thead>
          <tbody>
            {q.excluded.map(e => (
              <tr key={e.targetNumber}>
                <td><Link href={`/leads/${e.targetNumber}`}>{e.targetNumber}</Link></td>
                <td>{e.company}</td>
                <td className="wrap small muted">{e.reason}</td>
              </tr>
            ))}
            {q.excluded.length === 0 ? <tr><td colSpan={3} className="empty">Nothing excluded.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
