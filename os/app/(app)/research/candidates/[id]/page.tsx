import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/server/auth/current-actor';
import { isUuid } from '@/server/auth/action-guard';
import { getCandidateDetail } from '@/server/research/service';
import { requestSnapshot } from '@/server/services/snapshot';
import { maskContact } from '@/server/services/contacts';
import { EVIDENCE_LEVEL_LABELS, dayLabel, fieldNoun } from '@/server/services/operator';
import { approvalRefusal, evidenceLevelFor } from '@kachmo/core/research/candidate.js';
import { ReviewForm } from './review-form';
import { Banner, Chip, Disclosure, PageHead } from '../../../components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Suggested company' };

const CONTACT_FIELDS = new Set(['decision_maker_email', 'decision_maker_phone']);

/**
 * A SUGGESTED COMPANY — everything a reviewer needs to answer "should this become a company in our list?": what the
 * research claims, how far each claim is backed, what is missing, what it may duplicate, and whether it is on the
 * do-not-contact list. Approving it is a separate, confirmed act.
 */
export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('research.create');
  const { id } = await params;
  // A malformed id is simply not found — it never reaches the database as a query error (audit C6).
  if (!isUuid(id)) notFound();
  const detail = await getCandidateDetail(id, await requestSnapshot());
  if (!detail) notFound();

  const { row, candidate, assessment, report } = detail;
  const canApprove = actor.permissions.has('research.approve');
  const canSeeContacts = actor.permissions.has('lead.view_contacts');
  const refusal = approvalRefusal(candidate, assessment, canApprove ? actor.name : 'VIEWER');
  const show = (field: string, value: string | null): string => {
    if (!value) return '—';
    if (!CONTACT_FIELDS.has(field) || canSeeContacts) return value;
    return maskContact(value, field === 'decision_maker_email' ? 'email' : 'phone');
  };
  const name = row.companyName ?? 'Unnamed company';

  return (
    <>
      <Link className="crumb" href="/research">
        ← Research
      </Link>
      <PageHead
        label={`Suggested ${dayLabel(row.createdAt.toISOString().slice(0, 10))}${report ? ` · from ${report.provider}, uploaded by ${report.operatorLabel}` : ''}`}
        title={name}
        sub={assessment.reason}
      />

      {assessment.suppressionMatches.length ? (
        <Banner tone="stop" chip="Do not contact">
          <p>
            <strong>This company or person is on the do-not-contact list.</strong> It can never be added, by anyone.
          </p>
        </Banner>
      ) : refusal ? (
        <Banner tone="act" chip="Can’t add yet">
          <p>{refusal.message.charAt(0).toUpperCase() + refusal.message.slice(1)}.</p>
        </Banner>
      ) : null}

      <h2>What the research says</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>About</th>
              <th>Claim</th>
              <th>Backed by</th>
            </tr>
          </thead>
          <tbody>
            {candidate.claims.map(c => {
              const level = evidenceLevelFor(candidate, c.field);
              return (
                <tr key={c.field}>
                  <td className="small">{fieldNoun(c.field).replace(/^the /, '')}</td>
                  <td className="wrap">{show(c.field, c.value)}</td>
                  <td className="wrap small">
                    <Chip tone={level === 'CONTRADICTED' ? 'stop' : level === 'SUPPORTED' ? 'done' : 'neutral'}>{EVIDENCE_LEVEL_LABELS[level]}</Chip>
                    {c.evidence.map((e, i) =>
                      e.sourceUrl && /^https?:\/\//i.test(e.sourceUrl) ? (
                        <div key={i}>
                          <a href={e.sourceUrl} rel="noreferrer noopener nofollow" target="_blank">
                            {e.sourceUrl}
                          </a>
                        </div>
                      ) : (
                        <div key={i} className="muted">
                          {e.notes ?? 'described, not linked'}
                        </div>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">“Source recorded, not checked” means a link exists that nobody here has opened. Open it before relying on the claim.</p>

      {assessment.missingFields.length ? (
        <>
          <h2>Missing</h2>
          <p>The research did not supply: {assessment.missingFields.map(f => fieldNoun(f).replace(/^the /, '')).join(', ')}.</p>
        </>
      ) : null}

      {assessment.contradictedFields.length ? (
        <Banner tone="stop" chip="Sources disagree">
          <p>A source contradicts what the research says about {assessment.contradictedFields.map(f => fieldNoun(f)).join(', ')}.</p>
        </Banner>
      ) : null}

      {assessment.duplicateMatches.length ? (
        <>
          <h2>May already be in the list</h2>
          <ul className="rows">
            {assessment.duplicateMatches.map(d => (
              <li key={d.leadId} className="work">
                <div>
                  <Link className="company" href={`/leads/${d.targetNumber}`}>
                    Company #{d.targetNumber}
                  </Link>
                  <p className="sentence muted">Matched on {d.matchedOn}</p>
                </div>
                <div className="aside">
                  <Chip tone={d.confidence === 'HIGH' ? 'stop' : 'neutral'}>{d.confidence === 'HIGH' ? 'Very likely the same' : 'Possibly the same'}</Chip>
                </div>
              </li>
            ))}
          </ul>
          <p className="small muted">Possible duplicates are never merged automatically.</p>
        </>
      ) : null}

      <h2>Decision</h2>
      {row.reviewedByLabel ? (
        <div className="plate">
          <p style={{ margin: 0 }}>
            Decided by <strong>{row.reviewedByLabel}</strong> on {row.reviewedAt ? dayLabel(row.reviewedAt.toISOString().slice(0, 10)) : '—'}: {row.status.toLowerCase().replace(/_/g, ' ')}.
          </p>
          {row.reviewNote ? <p className="muted" style={{ margin: 'var(--s1) 0 0' }}>{row.reviewNote}</p> : null}
          {row.resolvedLeadId ? <p style={{ margin: 'var(--s1) 0 0' }}>It is now in the company list.</p> : null}
        </div>
      ) : (
        <ReviewForm candidateId={row.id} company={name} canApprove={canApprove} canAdd={!refusal} duplicates={assessment.duplicateMatches.map(d => ({ leadId: d.leadId, targetNumber: d.targetNumber }))} />
      )}

      <Disclosure title="Where this came from">
        <dl className="facts">
          <dt>Report</dt>
          <dd>{report ? <code>{report.sourceReportId}</code> : '—'}</dd>
          <dt>File</dt>
          <dd>{report ? `${report.originalFilename} (${report.format}, ${report.byteSize} bytes)` : '—'}</dd>
          <dt>Content hash</dt>
          <dd>
            <code className="small">{report?.contentSha256.slice(0, 32) ?? '—'}…</code>
          </dd>
          <dt>Suggestion id</dt>
          <dd>
            <code className="small">{row.candidateId}</code>
          </dd>
        </dl>
      </Disclosure>
    </>
  );
}
