import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { requestSnapshot } from '@/server/services/snapshot';
import { getWhatsAppQueue } from '@/server/services/operations';
import { writeStatusFor } from '@/server/services/write-status';
import { humanizeExclusion, humanizeRefusal } from '@/server/services/operator';
import { WhatsAppForm, WritesUnavailable } from '../components/LeadActions';
import { Chip, Disclosure, EmptyNote, PageHead } from '../components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'WhatsApp' };

const BASIS: Record<string, string> = {
  BUSINESS_LISTED_WHATSAPP: 'They advertise WhatsApp on this number',
  PERMISSION_GIVEN_ON_CALL: 'They agreed to WhatsApp on a call',
};

/**
 * WHATSAPP — drafts to review and approved messages to send. A person reviews every message and sends it from their own
 * phone; this app has no WhatsApp connection and sends nothing. A company appears here only with a confirmed number
 * and a recorded reason WhatsApp is acceptable.
 */
export default async function WhatsAppPage() {
  const actor = await requirePermission('outreach.whatsapp');
  const q = await getWhatsAppQueue(actor, await requestSnapshot());
  const writes = await writeStatusFor(actor);
  const toSend = q.items.filter(i => i.status === 'APPROVED').length;
  const toReview = q.items.length - toSend;

  return (
    <>
      <PageHead
        title="WhatsApp"
        sub={`${toReview} draft${toReview === 1 ? '' : 's'} to review · ${toSend} approved to send. You send every message yourself, from your phone — nothing is sent from here.`}
      />

      {q.items.length === 0 ? (
        <EmptyNote title="No WhatsApp messages to review.">
          A company appears here once its number is confirmed and there is a reason WhatsApp is OK — they advertise it, or they agreed on a call.
        </EmptyNote>
      ) : (
        q.items.map(i => (
          <section key={i.targetNumber} id={`wa-${i.targetNumber}`} className="plate" style={{ marginBottom: 'var(--s4)', scrollMarginTop: 'var(--s4)' }}>
            <div className="row between">
              <div style={{ minWidth: 0 }}>
                <span className="label">{BASIS[i.basis] ?? i.basis}</span>
                <h3 style={{ fontSize: 18, margin: 0 }}>
                  <Link href={`/leads/${i.targetNumber}`} style={{ textDecoration: 'none' }}>
                    {i.company}
                  </Link>
                </h3>
                <p className="muted" style={{ margin: '2px 0 0' }}>
                  {i.decisionMaker} · <code>{i.number}</code>
                </p>
              </div>
              <Chip tone={i.status === 'APPROVED' ? 'act' : 'neutral'}>{i.status === 'APPROVED' ? 'Approved — send it' : 'Draft to review'}</Chip>
            </div>
            <span className="label" style={{ marginTop: 'var(--s4)' }}>
              The message · {i.wordCount} words
            </span>
            <pre className="draft">{i.draft}</pre>
            <div style={{ marginTop: 'var(--s3)' }}>
              {q.source !== 'POSTGRES' ? (
                <p className="small muted" style={{ margin: 0 }}>Reviews are recorded with the command-line tools until the database is the source of truth.</p>
              ) : writes.canWrite && i.version !== null ? (
                <WhatsAppForm target={{ leadId: i.leadId, version: i.version, targetNumber: i.targetNumber }} status={i.status === 'APPROVED' ? 'APPROVED' : null} />
              ) : (
                <WritesUnavailable reason={humanizeRefusal(writes.reason ?? 'this company changed; reload the page.')} />
              )}
            </div>
          </section>
        ))
      )}

      {q.excluded.length ? (
        <>
          <h2>Not on WhatsApp</h2>
          <Disclosure title="Why these companies can’t be messaged" meta={`${q.excluded.length}`}>
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
