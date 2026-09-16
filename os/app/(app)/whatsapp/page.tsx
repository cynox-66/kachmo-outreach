import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { getWhatsAppQueue } from '@/server/services/operations';

export const dynamic = 'force-dynamic';

/**
 * The WhatsApp review queue. Draft → human review → human send.
 * There is no send button and no bulk action anywhere in this system.
 */
export default async function WhatsAppPage() {
  const actor = await requirePermission('outreach.whatsapp');
  const q = await getWhatsAppQueue(actor);

  return (
    <>
      <h1>WhatsApp</h1>
      <p className="lede">
        Human review and human send only. <strong>Nothing here is sent by this system</strong>, and there is no bulk
        send. A lead appears only when the phone is sourced or verified <em>and</em> there is a recorded basis for
        using WhatsApp at all — the business advertises it, or permission was given on a call.
      </p>

      {q.items.length === 0 ? (
        <div className="notice">
          <p>
            <strong>Nothing to review.</strong> The normal path is: Aadi calls, asks &ldquo;can I WhatsApp you the
            idea?&rdquo;, and logs <code>--whatsapp-ok</code>.
          </p>
        </div>
      ) : null}

      {q.items.map(i => (
        <div className="panel" key={i.targetNumber} style={{ marginBottom: 12 }}>
          <div className="row between">
            <h2 style={{ margin: 0 }}>
              <Link href={`/leads/${i.targetNumber}`}>{i.targetNumber} · {i.company}</Link>
            </h2>
            <span className={`badge ${i.status === 'APPROVED' ? 'ok' : 'warn'}`}>{i.status.replace(/_/g, ' ').toLowerCase()}</span>
          </div>
          <p className="small muted" style={{ margin: '4px 0 8px' }}>
            {i.decisionMaker} · <code>{i.number}</code> · basis: <span className="badge">{i.basis}</span> · {i.wordCount} words ·{' '}
            <span className="badge">{i.priority}</span>
          </p>
          <pre className="draft">{i.draft}</pre>
          <p className="small muted" style={{ margin: '4px 0' }}>
            Edit the wording freely before sending. Record what happened with the CLI:
          </p>
          <p className="small" style={{ margin: 0 }}>
            Approve: <code>{i.approveCommand}</code>
            <br />
            After sending by hand: <code>{i.sentCommand}</code>
          </p>
        </div>
      ))}

      <h2>Not eligible ({q.excluded.length})</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Target</th><th>Company</th><th>Why not</th></tr></thead>
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
