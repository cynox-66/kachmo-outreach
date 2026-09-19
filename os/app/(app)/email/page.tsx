import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { getEmailLedger } from '@/server/services/operations';
import { presentStatus } from '@/server/services/presentation';

export const dynamic = 'force-dynamic';

const BADGE: Record<string, string> = {
  SENT: 'ok',
  WON: 'ok',
  CALL_BOOKED: 'ok',
  REPLIED_WARM: 'ok',
  REPLIED_NO: 'bad',
  DISQUALIFIED: 'bad',
  FOLLOW_UP_DUE: 'warn',
  SCHEDULED: 'warn',
  PENDING: 'warn',
};

/**
 * Read-only visibility into Titan's email ledger.
 *
 * Titan owns email send state in every phase. This page reads OUTREACH_TRACKER.md
 * and scheduled-queue.json and writes nothing. There is no send action here,
 * no mail library in this application, and no SMTP credential.
 */
export default async function EmailPage() {
  const actor = await requirePermission('email.view_ledger');
  const v = await getEmailLedger(actor);

  return (
    <>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div>
          <h1>Email</h1>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            Production email ledger · Monitored by GitHub Actions cron
          </p>
        </div>
        <span className="badge info">Read-only · Titan owns email</span>
      </div>

      <p className="lede" style={{ marginBottom: 20 }}>
        The production email ledger as recorded by Titan. This application cannot send email: it imports
        no mail library and holds no SMTP credentials. Dispatch remains exclusively with Titan scripts and GitHub Actions.
      </p>

      {!v.suppressionFreshness.outreachAllowed ? (
        <div className="notice" style={{ marginBottom: 16 }}>
          <p>
            <strong>Outreach is blocked.</strong> {v.suppressionFreshness.reason}
          </p>
        </div>
      ) : null}

      {v.queueIssues.filter(i => i.blocking).length ? (
        <div className="notice" style={{ marginBottom: 16 }}>
          <p>
            <strong>The production queue has blocking issues:</strong>
          </p>
          {v.queueIssues
            .filter(i => i.blocking)
            .map(i => (
              <p key={i.message} className="small">
                {i.message}
              </p>
            ))}
        </div>
      ) : null}

      {/* ── METRICS BY STATUS ────────────────────────────────────────────── */}
      <dl className="stats" style={{ marginBottom: 24 }}>
        {v.byStatus.slice(0, 6).map(s => (
          <div key={s.status}>
            <dt>{presentStatus(s.status)}</dt>
            <dd>{s.count}</dd>
          </div>
        ))}
      </dl>

      {/* ── QUEUED TO SEND ───────────────────────────────────────────────── */}
      <h2>Queued to Send ({v.scheduled.length})</h2>
      <div className="tablewrap" style={{ marginBottom: 28 }}>
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th>Company</th>
              <th>Recipient</th>
              <th style={{ textAlign: 'right' }}>Lead</th>
            </tr>
          </thead>
          <tbody>
            {v.scheduled.map(s => (
              <tr key={s.targetNumber}>
                <td className="small" style={{ fontFamily: 'var(--mono)' }}>
                  <Link href={`/leads/${s.targetNumber}`} style={{ textDecoration: 'none' }}>
                    {s.targetNumber}
                  </Link>
                </td>
                <td>
                  <strong>{s.company}</strong>
                </td>
                <td>
                  <code>{s.to}</code>
                  {!s.toVisible ? <span className="badge warn" style={{ marginLeft: 6 }}>hidden for role</span> : null}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <Link href={`/leads/${s.targetNumber}`} className="badge ghost" style={{ textDecoration: 'none' }}>
                    View →
                  </Link>
                </td>
              </tr>
            ))}
            {v.scheduled.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty">
                  The production email queue is currently empty.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* ── PRODUCTION LEDGER ────────────────────────────────────────────── */}
      <h2>Titan Ledger ({v.rows.length})</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th>Company</th>
              <th>Batch</th>
              <th>Status</th>
              <th>Recipient</th>
              <th>Sent Date</th>
              <th>Follow-up Due</th>
              <th style={{ textAlign: 'right' }}>Lead</th>
            </tr>
          </thead>
          <tbody>
            {v.rows.map(r => (
              <tr key={r.targetNumber}>
                <td className="small" style={{ fontFamily: 'var(--mono)' }}>
                  <Link href={`/leads/${r.targetNumber}`} style={{ textDecoration: 'none' }}>
                    {r.targetNumber}
                  </Link>
                </td>
                <td>
                  <strong>{r.company}</strong>
                </td>
                <td className="small muted">{r.batch}</td>
                <td>
                  <span className={`badge ${BADGE[r.status] ?? ''}`}>{presentStatus(r.status)}</span>
                </td>
                <td>
                  <code className="small">{r.email}</code>
                </td>
                <td className="small">{r.sentDate ?? '—'}</td>
                <td className="small">
                  {r.followUpDue ?? '—'}
                  {r.followUpOverdue ? (
                    <span className="badge warn" style={{ marginLeft: 6 }}>
                      due
                    </span>
                  ) : null}
                  {r.alreadyFollowedUp ? (
                    <span className="badge" style={{ marginLeft: 6 }}>
                      bumped
                    </span>
                  ) : null}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <Link href={`/leads/${r.targetNumber}`} className="badge ghost" style={{ textDecoration: 'none' }}>
                    View →
                  </Link>
                </td>
              </tr>
            ))}
            {v.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty">
                  No outreach records in the ledger yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
