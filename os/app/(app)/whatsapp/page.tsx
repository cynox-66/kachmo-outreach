import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { getWhatsAppQueue } from '@/server/services/operations';
import { writeStatusFor } from '@/server/services/write-status';
import { WhatsAppForm, WritesUnavailable } from '../components/LeadActions';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';

export const dynamic = 'force-dynamic';

/**
 * WHATSAPP — Human message review queue.
 *
 * Draft → human operator review → human manual send.
 * This system includes no automated sending, no WhatsApp API integration, and no bulk dispatch.
 */
export default async function WhatsAppPage() {
  const actor = await requirePermission('outreach.whatsapp');
  const q = await getWhatsAppQueue(actor);
  const writes = await writeStatusFor(actor);

  return (
    <>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div>
          <h1>WhatsApp</h1>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            Human review queue · Manual operator outreach
          </p>
        </div>
        <span className="badge info">
          {q.items.length} draft{q.items.length === 1 ? '' : 's'} to review
        </span>
      </div>

      <p className="lede" style={{ marginBottom: 20 }}>
        Human review and manual send only. <strong>Nothing here is sent automatically by this system</strong>.
        A lead appears here only when the phone number is verified and there is a recorded basis for using WhatsApp.
      </p>

      {/* ── SECTION 1: DRAFTS FOR REVIEW ─────────────────────────────────── */}
      <h2>Drafts for Review ({q.items.length})</h2>

      {q.items.length === 0 ? (
        <EmptyState
          title="No WhatsApp drafts waiting for review."
          description="A lead enters this queue when an operator verifies WhatsApp permission on a call or finds an advertised business WhatsApp route."
          action={
            <Link href="/leads" className="badge ghost" style={{ textDecoration: 'none' }}>
              View all leads →
            </Link>
          }
          style={{ marginBottom: 28 }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
          {q.items.map(i => (
            <div className="panel" key={i.targetNumber} style={{ borderLeft: '3px solid var(--accent)' }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--ink-muted)', marginRight: 8 }}>
                      {i.targetNumber}
                    </span>
                    <Link href={`/leads/${i.targetNumber}`} style={{ textDecoration: 'none', color: 'var(--ink)' }}>
                      {i.company}
                    </Link>
                  </h3>
                  <p className="small muted" style={{ margin: '3px 0 0' }}>
                    {i.decisionMaker} · <code>{i.number}</code> · basis: <span className="badge">{i.basis}</span> · {i.wordCount} words
                  </p>
                </div>

                <div className="row" style={{ gap: 8 }}>
                  <span className="badge">{i.priority}</span>
                  <StatusBadge status={i.status} />
                  <Link href={`/leads/${i.targetNumber}`} className="badge ghost" style={{ textDecoration: 'none' }}>
                    View lead →
                  </Link>
                </div>
              </div>

              <p className="small muted" style={{ margin: '8px 0 4px', fontWeight: 600 }}>
                Prepared Message:
              </p>
              <pre className="draft" style={{ margin: 0 }}>{i.draft}</pre>

              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                {q.source !== 'POSTGRES' ? (
                  <p className="small muted" style={{ margin: 0 }}>Before cutover, reviews are recorded with the CLI: <code>{i.approveCommand}</code></p>
                ) : writes.canWrite && i.version !== null ? (
                  <WhatsAppForm leadId={i.leadId} version={i.version} status={i.status} />
                ) : (
                  <WritesUnavailable reason={writes.reason ?? 'this lead has no stored version; reload the page.'} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── SECTION 2: NOT ELIGIBLE ──────────────────────────────────────── */}
      <h2>Not Eligible ({q.excluded.length})</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th>Company</th>
              <th>Reason Not Eligible</th>
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
