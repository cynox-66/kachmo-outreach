import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { requestSnapshot } from '@/server/services/snapshot';
import { getEmailLedger } from '@/server/services/operations';
import { senderStatus } from '@/server/services/sender';
import { dayLabel, emailDates, ledgerStatusLabel, relativeDays } from '@/server/services/operator';
import { AsOf, Banner, Chip, Disclosure, EmailPreview, EmptyNote, PageHead } from '../components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Emails' };

const REPLIED = new Set(['REPLIED_WARM', 'REPLIED_NOT_NOW', 'REPLIED_NO', 'CALL_BOOKED', 'PROPOSAL_SENT', 'WON']);
const SENT = new Set(['SENT', 'FOLLOW_UP_DUE', 'FOLLOWED_UP']);

/**
 * EMAILS — Read-only (docs/OPERATOR_EXPERIENCE.md §4.4).
 *
 * Titan owns email in every phase. The automatic sender (GitHub Actions) and the studio inbox send; this page shows
 * what is scheduled — including exactly what it says — whether the sender is actually getting it out, what is due and
 * what has been sent. There is no form, no send control, no mail library and no SMTP credential anywhere in this app.
 */
export default async function EmailsPage() {
  const actor = await requirePermission('email.view_ledger');
  const snap = await requestSnapshot();
  const v = await getEmailLedger(actor, snap);
  const sender = senderStatus(snap, actor, v.today);

  const due = v.rows.filter(r => r.followUpOverdue && !r.alreadyFollowedUp);
  const replied = v.rows.filter(r => REPLIED.has(r.status));
  const sent = v.rows.filter(r => SENT.has(r.status) || r.status === 'FOLLOWED_UP');
  const other = v.rows.filter(r => !REPLIED.has(r.status) && !SENT.has(r.status) && !snap.scheduled.some(s => s.targetNumber === r.targetNumber));

  return (
    <>
      <PageHead
        label="Read-only · sent from the studio inbox"
        title="Emails"
        sub="What’s scheduled, what went out, and what’s due. The automatic sender and the studio inbox (Titan) send email; this page can’t send, change or cancel anything."
        aside={<AsOf iso={sender.asOf} />}
      />

      {sender.state === 'ON_HOLD' || sender.state === 'STUCK' ? (
        <Banner tone={sender.state === 'ON_HOLD' ? 'stop' : 'act'} chip={sender.state === 'ON_HOLD' ? 'On hold' : 'Stuck'}>
          <p>
            <strong>{sender.headline}</strong>
          </p>
          {sender.explanation.map(e => (
            <p key={e} className="small">
              {e}
            </p>
          ))}
        </Banner>
      ) : (
        <div className="plate">
          <span className="label">Automatic sender</span>
          <p style={{ margin: 0 }}>{sender.headline}</p>
        </div>
      )}

      <div className="group-head">
        <h2>Scheduled</h2>
        <span className="label">{sender.queued.length}</span>
      </div>
      {sender.queued.length ? (
        <ul className="rows">
          {sender.queued.map(q => (
            <li key={q.targetNumber} style={{ padding: 'var(--s3) var(--s4)' }}>
              <div className="row between">
                <div style={{ minWidth: 0 }}>
                  <Link href={`/leads/${q.targetNumber}`} style={{ fontWeight: 600, textDecoration: 'none' }}>
                    {q.company}
                  </Link>
                  <span className="small muted"> · {[q.city, q.country].filter(Boolean).join(', ')}</span>
                  <div className="small">{q.subject ? <>“{q.subject}”</> : <span className="muted">no subject</span>}</div>
                </div>
                <div className="row">
                  {q.holdReason ? <Chip tone="stop">Blocks the queue</Chip> : null}
                  {q.late ? (
                    <Chip tone="act">
                      Planned {dayLabel(q.planned)} · {q.lateDays} day{q.lateDays === 1 ? '' : 's'} late
                    </Chip>
                  ) : q.planned ? (
                    <Chip>Planned {dayLabel(q.planned)}</Chip>
                  ) : null}
                </div>
              </div>
              {q.holdReason ? <p className="small" style={{ margin: 'var(--s2) 0 0' }}>{q.holdReason}</p> : null}
              <details className="disclose" style={{ marginTop: 'var(--s2)' }}>
                <summary>
                  <span className="title">Read the email</span>
                </summary>
                <div className="inner">
                  <EmailPreview email={q} open />
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyNote title="Nothing is scheduled.">New emails are drafted and scheduled from the studio’s email tools, then appear here.</EmptyNote>
      )}

      <div className="group-head">
        <h2>Follow-ups due</h2>
        <span className="label">{due.length}</span>
      </div>
      {due.length ? (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            One follow-up each, sent from the studio inbox. Once sent, it shows here after the email records next update.
          </p>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Emailed</th>
                  <th>Follow-up was due</th>
                </tr>
              </thead>
              <tbody>
                {due.map(r => (
                  <tr key={r.targetNumber}>
                    <td className="wrap">
                      <Link href={`/leads/${r.targetNumber}`} style={{ fontWeight: 600, textDecoration: 'none' }}>
                        {r.company}
                      </Link>
                      <div className="small muted">
                        <code>{r.email}</code>
                      </div>
                    </td>
                    <td className="nowrap">{r.sentDate ? dayLabel(r.sentDate) : '—'}</td>
                    <td className="nowrap">
                      {r.followUpDue ? `${dayLabel(r.followUpDue)} · ${relativeDays(r.followUpDue, v.today)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="muted">No follow-up is due.</p>
      )}

      <div className="group-head">
        <h2>Replies</h2>
        <span className="label">{replied.length}</span>
      </div>
      {replied.length ? (
        <ul className="rows">
          {replied.map(r => (
            <li key={r.targetNumber} className="work">
              <div>
                <Link className="company" href={`/leads/${r.targetNumber}`}>
                  {r.company}
                </Link>
                <p className="sentence">{ledgerStatusLabel(r.status)}</p>
              </div>
              <div className="aside">
                <Link className="btn btn-sm" href={`/leads/${r.targetNumber}`}>
                  Open company
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No replies are recorded in the email records.</p>
      )}

      <h2>History</h2>
      <Disclosure title="Sent" meta={`${sent.length}`}>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {sent.map(r => (
                <tr key={r.targetNumber}>
                  <td className="wrap">
                    <Link href={`/leads/${r.targetNumber}`} style={{ textDecoration: 'none' }}>
                      {r.company}
                    </Link>
                    <div className="small muted">
                      <code>{r.email}</code> · {r.batch}
                    </div>
                  </td>
                  <td className="small">{ledgerStatusLabel(r.status)}</td>
                  <td className="nowrap small">{r.sentDate ? dayLabel(r.sentDate) : '—'}</td>
                  <td className="nowrap small">{r.alreadyFollowedUp ? 'Sent' : r.followUpDue ? `Due ${dayLabel(r.followUpDue)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Disclosure>
      <Disclosure title="Not sent" meta={`${other.length} drafted, pending or disqualified`}>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {other.map(r => {
                const d = emailDates({ status: r.status, sent_date: r.sentDate, follow_up_due: r.followUpDue }, v.today);
                return (
                  <tr key={r.targetNumber}>
                    <td className="wrap">
                      <Link href={`/leads/${r.targetNumber}`} style={{ textDecoration: 'none' }}>
                        {r.company}
                      </Link>
                    </td>
                    <td className="small">{ledgerStatusLabel(r.status)}</td>
                    <td className="nowrap small">{d.date ? `${d.kind === 'PLANNED' ? 'Planned' : 'Sent'} ${dayLabel(d.date)}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Disclosure>
    </>
  );
}
