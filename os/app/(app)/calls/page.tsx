import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { getCallQueue } from '@/server/services/operations';
import { writeStatusFor } from '@/server/services/write-status';
import { EmptyState } from '../components/EmptyState';
import { CallLogForm, WritesUnavailable } from '../components/LeadActions';

export const dynamic = 'force-dynamic';

/**
 * CALLS — Human calling briefing workspace.
 *
 * The system prepares the card and battlecard for human calls.
 * It never dials or places calls automatically.
 */
export default async function CallsPage() {
  const actor = await requirePermission('outreach.call');
  const q = await getCallQueue(actor);
  const writes = await writeStatusFor(actor);

  return (
    <>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div>
          <h1>Calls</h1>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            {q.today} (IST) · Human operator outreach
          </p>
        </div>
        <span className={`badge ${q.cards.length > 0 ? 'ok' : 'info'}`}>
          {q.cards.length} ready to call
        </span>
      </div>

      <p className="lede" style={{ marginBottom: 20 }}>
        Only phone numbers with a recorded public source or verified basis appear in the call queue.
        This system places no automated calls: it prepares the briefing card and records what a human operator did.
      </p>

      {/* ── SECTION 1: CALL READY ────────────────────────────────────────── */}
      <h2>Call Ready ({q.cards.length})</h2>

      {q.cards.length === 0 ? (
        <EmptyState
          title="Nothing is callable today."
          description={`${q.unsourcedPhones} lead(s) have a phone number on file, but source provenance has not been verified yet, so calling is withheld.`}
          action={
            <Link href="/leads?contact=callable" className="badge ghost" style={{ textDecoration: 'none' }}>
              View callable leads →
            </Link>
          }
          style={{ marginBottom: 28 }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
          {q.cards.map(c => (
            <div className="panel" key={c.targetNumber} style={{ borderLeft: '3px solid var(--accent)' }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--ink-muted)', marginRight: 8 }}>
                      {c.targetNumber}
                    </span>
                    <Link href={`/leads/${c.targetNumber}`} style={{ textDecoration: 'none', color: 'var(--ink)' }}>
                      {c.company}
                    </Link>
                  </h3>
                  <p className="small muted" style={{ margin: '3px 0 0' }}>
                    {c.decisionMaker} ({c.title}) · {c.city} {c.timezone ? `(${c.timezone})` : ''}
                    {c.previousAttempts ? ` · ${c.previousAttempts} previous attempt(s)` : ''}
                  </p>
                </div>

                <div className="row" style={{ gap: 8 }}>
                  <span className="badge">{c.priority}</span>
                  <Link href={`/leads/${c.targetNumber}`} className="badge ghost" style={{ textDecoration: 'none' }}>
                    View lead
                  </Link>
                  {c.phoneVisible ? (
                    <a href={`tel:${c.phone}`} className="action-card-btn" style={{ textDecoration: 'none' }}>
                      Call {c.phone}
                    </a>
                  ) : (
                    <span className="badge warn">Phone masked for role</span>
                  )}
                </div>
              </div>

              <dl className="kv" style={{ marginTop: 10 }}>
                <dt>Why them</dt>
                <dd className="wrap">{c.whyThem}</dd>
                <dt>Angle</dt>
                <dd className="wrap"><strong>{c.angle}</strong></dd>
                <dt>Observable friction</dt>
                <dd className="wrap">{c.friction}</dd>
                <dt>Call objective</dt>
                <dd className="wrap">{c.objective}</dd>
              </dl>

              {c.verifyFirst.length ? (
                <div style={{ marginTop: 12 }}>
                  <p className="small muted" style={{ margin: '0 0 4px', fontWeight: 600 }}>
                    Verify before dialing:
                  </p>
                  <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {c.verifyFirst.map((v, i) => (
                      <li key={i}>{v}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Recommended Opening & Bridge */}
              <div style={{ marginTop: 12 }}>
                <p className="small muted" style={{ margin: '0 0 4px', fontWeight: 600 }}>
                  Recommended Opening & Bridge:
                </p>
                <pre className="draft" style={{ margin: 0 }}>
                  {c.opening}{'\n\n'}{c.bridge}
                </pre>
              </div>

              {/* Discovery Questions */}
              {c.questions.length ? (
                <div style={{ marginTop: 12 }}>
                  <p className="small muted" style={{ margin: '0 0 4px', fontWeight: 600 }}>
                    Discovery Questions:
                  </p>
                  <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {c.questions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ol>
                </div>
              ) : null}

              {/* Objections Handling */}
              {c.objections.length ? (
                <div style={{ marginTop: 12 }}>
                  <p className="small muted" style={{ margin: '0 0 4px', fontWeight: 600 }}>
                    If they say…
                  </p>
                  <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {c.objections.map((o, i) => (
                      <li key={i}>
                        <em>{o.objection}</em> → {o.response}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                <p className="small muted" style={{ margin: '0 0 6px', fontWeight: 600 }}>Log what happened on this call</p>
                {q.source !== 'POSTGRES' ? (
                  <p className="small muted" style={{ margin: 0 }}>Before cutover, calls are logged with the CLI: <code>{c.logCommand}</code></p>
                ) : writes.canWrite && c.version !== null ? (
                  <CallLogForm leadId={c.leadId} version={c.version} />
                ) : (
                  <WritesUnavailable reason={writes.reason ?? 'this lead has no stored version; reload the page.'} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── SECTION 2: NOT CALLABLE ──────────────────────────────────────── */}
      <h2>Not Ready to Call ({q.excluded.length})</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th>Company</th>
              <th>Why Not Callable</th>
              <th style={{ textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {q.excluded.map(e => (
              <tr key={e.targetNumber}>
                <td className="small" style={{ fontFamily: 'var(--mono)' }}>
                  <Link href={`/leads/${e.targetNumber}`} style={{ textDecoration: 'none' }}>
                    {e.targetNumber}
                  </Link>
                </td>
                <td>
                  <strong>{e.company}</strong>
                </td>
                <td className="wrap small muted">{e.reason}</td>
                <td style={{ textAlign: 'right' }}>
                  <Link href={`/leads/${e.targetNumber}`} className="badge ghost" style={{ textDecoration: 'none' }}>
                    View lead →
                  </Link>
                </td>
              </tr>
            ))}
            {q.excluded.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty">No leads currently excluded.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
