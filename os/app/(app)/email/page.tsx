import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { getEmailLedger } from '@/server/services/operations';

export const dynamic = 'force-dynamic';

const BADGE: Record<string, string> = {
  SENT: 'ok', WON: 'ok', CALL_BOOKED: 'ok', REPLIED_WARM: 'ok',
  REPLIED_NO: 'bad', DISQUALIFIED: 'bad',
  FOLLOW_UP_DUE: 'warn', SCHEDULED: 'warn', PENDING: 'warn',
};

/**
 * Read-only visibility into Titan's email ledger.
 *
 * Titan owns email send state in every phase. This page reads OUTREACH_TRACKER.md and scheduled-queue.json and
 * writes nothing. There is no send action here, no mail library in this application, and no SMTP credential.
 */
export default async function EmailPage() {
  const actor = await requirePermission('email.view_ledger');
  const v = await getEmailLedger(actor);

  return (
    <>
      <div className="row between">
        <h1>Email</h1>
        <span className="badge info">read-only · Titan owns email</span>
      </div>
      <p className="lede">
        The production email ledger, as the Titan pipeline records it. This application cannot send email: it imports
        no mail library and holds no SMTP credentials. Sending stays with the Titan scripts and the GitHub Actions cron.
      </p>

      {!v.suppressionFreshness.outreachAllowed ? (
        <div className="notice">
          <p><strong>Outreach is blocked.</strong> {v.suppressionFreshness.reason}</p>
        </div>
      ) : null}

      {v.queueIssues.filter(i => i.blocking).length ? (
        <div className="notice">
          <p><strong>The production queue has blocking issues.</strong></p>
          {v.queueIssues.filter(i => i.blocking).map(i => <p key={i.message} className="small">{i.message}</p>)}
        </div>
      ) : null}

      <dl className="stats">
        {v.byStatus.slice(0, 6).map(s => (
          <div key={s.status}><dt>{s.status.replace(/_/g, ' ').toLowerCase()}</dt><dd>{s.count}</dd></div>
        ))}
      </dl>

      <h2>Queued to send ({v.scheduled.length})</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Target</th><th>Company</th><th>To</th></tr></thead>
          <tbody>
            {v.scheduled.map(s => (
              <tr key={s.targetNumber}>
                <td><Link href={`/leads/${s.targetNumber}`}>{s.targetNumber}</Link></td>
                <td>{s.company}</td>
                <td><code>{s.to}</code>{!s.toVisible ? <span className="badge" style={{ marginLeft: 6 }}>hidden</span> : null}</td>
              </tr>
            ))}
            {v.scheduled.length === 0 ? <tr><td colSpan={3} className="empty">The production queue is empty.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        This is the local copy of <code>scheduled-queue.json</code>. The cron sends from the pushed copy on origin.
      </p>

      <h2>Ledger ({v.rows.length})</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Target</th><th>Company</th><th>Batch</th><th>Status</th><th>To</th><th>Sent</th><th>Follow-up due</th></tr>
          </thead>
          <tbody>
            {v.rows.map(r => (
              <tr key={r.targetNumber}>
                <td><Link href={`/leads/${r.targetNumber}`}>{r.targetNumber}</Link></td>
                <td>{r.company}</td>
                <td className="small muted">{r.batch}</td>
                <td><span className={`badge ${BADGE[r.status] ?? ''}`}>{r.status}</span></td>
                <td><code className="small">{r.email}</code></td>
                <td className="small">{r.sentDate ?? '—'}</td>
                <td className="small">
                  {r.followUpDue ?? '—'}
                  {r.followUpOverdue ? <span className="badge warn" style={{ marginLeft: 6 }}>due</span> : null}
                  {r.alreadyFollowedUp ? <span className="badge" style={{ marginLeft: 6 }}>bumped</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        One bump only. After sending a follow-up by hand, record it with{' '}
        <code>npm run pipeline:log -- --lead=&lt;target&gt; --stage=FOLLOW_UP_SENT</code>.
      </p>
    </>
  );
}
