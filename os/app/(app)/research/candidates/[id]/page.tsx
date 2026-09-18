import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/server/auth/current-actor';
import { getCandidateDetail } from '@/server/research/service';
import { contactsFor } from '@/server/services/contacts';
import { approvalRefusal, evidenceLevelFor } from '@kachmo/core/research/candidate.js';
import type { KachmoLead } from '@kachmo/core/leads/schema.js';
import { ReviewForm } from './review-form';

export const dynamic = 'force-dynamic';

const LEVEL_BADGE: Record<string, string> = { SUPPORTED: 'ok', RETRIEVED: 'info', URL_SHAPED: 'warn', CLAIMED: 'warn', NONE: '', CONTRADICTED: 'bad' };
const CONTACT_FIELDS = new Set(['decision_maker_email', 'decision_maker_phone']);

/**
 * The human review surface. Everything a reviewer needs to answer "should this become a lead?" —
 * the claims, the evidence behind each one, what the engine thinks, and what is wrong with it.
 */
export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('research.create');
  const { id } = await params;
  const detail = await getCandidateDetail(id);
  if (!detail) notFound();

  const { row, candidate, assessment, report } = detail;
  const canApprove = actor.permissions.has('research.approve');
  const canSeeContacts = actor.permissions.has('lead.view_contacts');
  const refusal = approvalRefusal(candidate, assessment, canApprove ? actor.name : 'VIEWER');

  // Contact claims are masked with the same rule the lead pages use.
  const maskClaim = (field: string, value: string | null): string => {
    if (!value || !CONTACT_FIELDS.has(field)) return value ?? '—';
    if (canSeeContacts) return value;
    const fake = { decision_maker_email: field === 'decision_maker_email' ? value : null, decision_maker_phone: field === 'decision_maker_phone' ? value : null, email_status: 'UNVERIFIED', phone_status: 'UNVERIFIED' } as unknown as KachmoLead;
    const c = contactsFor(fake, actor);
    return field === 'decision_maker_email' ? c.email.masked : c.phone.masked;
  };

  return (
    <>
      <p className="crumb"><Link href="/research">← Research</Link></p>
      <div className="row between">
        <h1>{row.companyName ?? row.candidateId}</h1>
        <span className={`badge ${assessment.status === 'AWAITING_REVIEW' ? 'info' : assessment.status === 'SUPPRESSED' || assessment.status === 'FLAGGED_CONTRADICTION' ? 'bad' : 'warn'}`}>
          {assessment.status.replace(/_/g, ' ').toLowerCase()}
        </span>
      </div>
      <p className="lede">{assessment.reason}</p>

      {refusal ? (
        <div className="notice">
          <p><strong>This cannot be approved.</strong> {refusal.message}</p>
        </div>
      ) : null}

      <h2>Why it was extracted</h2>
      <div className="panel small">
        <dl className="kv">
          <dt>From report</dt>
          <dd>{report ? <code>{report.sourceReportId}</code> : '—'}{report ? ` · ${report.provider} · uploaded by ${report.operatorLabel}` : ''}</dd>
          <dt>Original file</dt>
          <dd className="muted">{report ? `${report.originalFilename} (${report.format}, ${report.byteSize} bytes)` : '—'}</dd>
          <dt>Content hash</dt>
          <dd><code className="small">{report?.contentSha256.slice(0, 32) ?? '—'}…</code></dd>
        </dl>
      </div>

      <h2>Claims and evidence</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Field</th><th>Claimed value</th><th>Evidence</th><th>Level</th><th>Source</th></tr>
          </thead>
          <tbody>
            {candidate.claims.map(c => {
              const level = evidenceLevelFor(candidate, c.field);
              return (
                <tr key={c.field}>
                  <td>{c.field}</td>
                  <td className="wrap">{maskClaim(c.field, c.value)}</td>
                  <td className="small muted">{c.evidence.length ? `${c.evidence.length} record(s)` : 'none offered'}</td>
                  <td><span className={`badge ${LEVEL_BADGE[level] ?? ''}`}>{level}</span></td>
                  <td className="wrap small">
                    {c.evidence.map((e, i) =>
                      e.sourceUrl ? (
                        <div key={i}>
                          <a href={/^https?:\/\//i.test(e.sourceUrl ?? '') ? e.sourceUrl : undefined} rel="noreferrer noopener nofollow" target="_blank">{e.sourceUrl}</a>
                        </div>
                      ) : (
                        <div key={i} className="muted">{e.notes ?? 'described, not linked'}</div>
                      )
                    )}
                    {c.evidence.length === 0 ? <span className="muted">—</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        <strong>URL_SHAPED</strong> means the URL is well-formed and nobody has fetched it. Open it yourself before
        relying on it — that is exactly what this level is telling you.
      </p>

      {assessment.missingFields.length ? (
        <>
          <h2>Missing</h2>
          <div className="panel small">
            <p style={{ margin: 0 }}>The report did not supply: <strong>{assessment.missingFields.join(', ')}</strong>.</p>
          </div>
        </>
      ) : null}

      {assessment.contradictedFields.length ? (
        <>
          <h2>Contradictions</h2>
          <div className="notice">
            <p>The source contradicts the report&rsquo;s own claim about <strong>{assessment.contradictedFields.join(', ')}</strong>.</p>
          </div>
        </>
      ) : null}

      {assessment.duplicateMatches.length ? (
        <>
          <h2>Possible duplicates ({assessment.duplicateMatches.length})</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Existing lead</th><th>Matched on</th><th>Confidence</th></tr></thead>
              <tbody>
                {assessment.duplicateMatches.map(d => (
                  <tr key={d.leadId}>
                    <td><Link href={`/leads/${d.targetNumber}`}>{d.targetNumber}</Link></td>
                    <td className="small">{d.matchedOn}</td>
                    <td><span className={`badge ${d.confidence === 'HIGH' ? 'bad' : 'warn'}`}>{d.confidence}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>
            Duplicates are surfaced, never resolved automatically — research is too expensive to delete silently.
          </p>
        </>
      ) : null}

      {assessment.suppressionMatches.length ? (
        <>
          <h2>Suppression</h2>
          <div className="notice">
            <p>
              <strong>This company or person has already asked not to be contacted</strong> ({assessment.suppressionMatches.length} matching
              entr{assessment.suppressionMatches.length === 1 ? 'y' : 'ies'}). It can never be approved, by anyone.
            </p>
          </div>
        </>
      ) : null}

      <h2>Decision</h2>
      {row.reviewedByLabel ? (
        <div className="panel small">
          <p style={{ margin: 0 }}>
            Reviewed by <strong>{row.reviewedByLabel}</strong> on {row.reviewedAt?.toISOString().slice(0, 10)} — <span className="badge">{row.status}</span>
          </p>
          {row.reviewNote ? <p className="muted" style={{ margin: '4px 0 0' }}>{row.reviewNote}</p> : null}
          {row.resolvedLeadId ? <p style={{ margin: '4px 0 0' }}>Became lead <code>{row.resolvedLeadId}</code>.</p> : null}
        </div>
      ) : (
        <ReviewForm
          candidateId={row.id}
          canApprove={canApprove}
          duplicates={assessment.duplicateMatches.map(d => ({ leadId: d.leadId, targetNumber: d.targetNumber }))}
        />
      )}
    </>
  );
}
