import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/server/auth/current-actor';
import { getLeadDetail } from '@/server/services/leads';

export const dynamic = 'force-dynamic';

const MARK: Record<string, string> = { PASS: '✓', UNVERIFIED: '~', PENDING: '?', UNKNOWN: '·', FAIL: '✗' };
const BADGE: Record<string, string> = { PASS: 'ok', UNVERIFIED: 'warn', PENDING: 'warn', UNKNOWN: '', FAIL: 'bad' };

/**
 * "Why is this lead here, and what should I do next?"
 *
 * Every gate, score and reason on this page is recomputed by core/ from the stored record at render time. Nothing
 * is narrated: there is no model reasoning here, only stored facts and deterministic rule outcomes.
 */
export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('lead.view');
  const { id } = await params;
  const d = await getLeadDetail(id, actor);
  if (!d) notFound();

  const { lead, row, contacts, scores } = d;
  const contactRow = (label: string, c: typeof contacts.email) => (
    <>
      <dt>{label}</dt>
      <dd>
        {c.present ? (
          <>
            <code>{c.visible ? c.value : c.masked}</code> <span className={`badge ${c.usableForOutreach ? 'ok' : 'warn'}`}>{c.status}</span>
            {!c.visible ? <span className="badge" style={{ marginLeft: 6 }}>hidden for your role</span> : null}
            <div className="small muted">
              {c.provenanceNote}
              {c.source ? (
                <>
                  {' — '}
                  {/^https?:\/\//.test(c.source) ? (
                    <a href={/^https?:\/\//i.test(c.source ?? '') ? c.source : undefined} rel="noreferrer noopener nofollow" target="_blank">
                      {c.source}
                    </a>
                  ) : (
                    c.source
                  )}
                </>
              ) : null}
            </div>
          </>
        ) : (
          <span className="muted">none on file</span>
        )}
      </dd>
    </>
  );

  return (
    <>
      <p className="crumb">
        <Link href="/leads">← Leads</Link>
      </p>
      <div className="row between">
        <h1>
          {row.targetNumber} · {lead.company_name}
        </h1>
        <span>
          <span className="badge">{row.priorityLabel}</span>{' '}
          <span className={`badge ${row.researchState === 'OUTREACH_READY' ? 'ok' : ''}`}>{row.researchState}</span>
          {row.suppressed ? <span className="badge bad"> suppressed</span> : null}
        </span>
      </div>
      <p className="lede">
        {d.archetypeName} · {lead.location_city}, {lead.location_country} · research {lead.research_completeness_score}% complete
      </p>

      {d.suppression.suppressed ? (
        <div className="notice">
          <p>
            <strong>This company must not be contacted.</strong> {d.suppression.reason}
          </p>
        </div>
      ) : null}

      <h2>Next best action</h2>
      <div className="panel">
        <p style={{ margin: 0 }}>
          <strong>{lead.next_action ?? 'None recorded.'}</strong>
          {lead.next_action_date ? <span className="muted"> — due {lead.next_action_date}</span> : null}
        </p>
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          Owner: {lead.owner ?? 'unassigned'} · recommended channel: {lead.recommended_channel ?? 'none'}
          {d.opportunity.reason ? ` — ${d.opportunity.reason}` : ''}
        </p>
      </div>

      <h2>Why this lead?</h2>
      <div className="panel">
        <div className="gates">
          {d.gates.map(g => (
            <div key={g.gate} className="gate">
              <span className="mark">{MARK[g.outcome] ?? '·'}</span>
              <span>
                {g.label}
                {!g.blocking ? <span className="small muted"> (never blocks)</span> : null}
              </span>
              <span>
                <span className={`badge ${BADGE[g.outcome] ?? ''}`}>{g.outcome}</span> <span className="small muted">{g.meaning}</span>
              </span>
            </div>
          ))}
        </div>
        {d.reasons.length ? (
          <>
            <p className="small muted" style={{ margin: '12px 0 4px' }}>
              Recorded reasons:
            </p>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {d.reasons.map(r => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <h2>Score</h2>
      <div className="panel">
        <dl className="kv">
          <dt>Kachmo score</dt>
          <dd>
            <strong>{scores.kachmoScore ?? '—'}</strong> / 100 — {row.priorityLabel}
          </dd>
          <dt>Commercial fit</dt>
          <dd>{scores.commercialFitScore ?? '—'}</dd>
          <dt>Decision-maker quality</dt>
          <dd>{scores.dmQualityScore ?? '—'}</dd>
          <dt>Pain</dt>
          <dd>{scores.painScore ?? '—'}</dd>
          <dt>Budget</dt>
          <dd>{scores.budgetScore ?? '—'}</dd>
          <dt>Intent / urgency</dt>
          <dd>{scores.intentTriggerScore ?? '—'} <span className="small muted">(never part of the Kachmo score)</span></dd>
        </dl>
        {scores.signals?.length ? (
          <p className="small muted" style={{ margin: '10px 0 0' }}>
            Signals: {scores.signals.join(' · ')}
          </p>
        ) : null}
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          A heuristic ranking over known dimensions. It is not a conversion probability, and none is estimated.
        </p>
      </div>

      <h2>Contactability</h2>
      <div className="panel">
        <dl className="kv">
          {contactRow('Email', contacts.email)}
          {contactRow('Phone', contacts.phone)}
          <dt>WhatsApp basis</dt>
          <dd>{lead.whatsapp_basis ? <>{lead.whatsapp_basis} <span className="small muted">— {lead.whatsapp_basis_source}</span></> : <span className="muted">none — not eligible</span>}</dd>
          <dt>Call eligibility</dt>
          <dd>
            <span className={`badge ${d.callEligibility.ok ? 'ok' : 'warn'}`}>{d.callEligibility.ok ? 'callable' : 'not callable'}</span>{' '}
            <span className="small muted">{d.callEligibility.reason}</span>
          </dd>
        </dl>
      </div>

      <h2>People</h2>
      <div className="panel">
        <dl className="kv">
          <dt>Decision maker</dt>
          <dd>
            {lead.decision_maker_name} — {lead.decision_maker_title}{' '}
            <span className="badge">{lead.decision_maker_confidence}</span>
          </dd>
          <dt>Source</dt>
          <dd className="small muted">{lead.decision_maker_source}</dd>
        </dl>
      </div>

      <h2>Research and evidence</h2>
      <div className="panel">
        {d.provenance.length ? (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Source</th>
                  <th>Evidence level</th>
                  <th>Recorded by</th>
                  <th>On</th>
                </tr>
              </thead>
              <tbody>
                {d.provenance.map((p, i) => (
                  <tr key={`${p.field}-${i}`}>
                    <td>{p.field}</td>
                    <td className="wrap small">
                      {p.sourceUrl ? (
                        <a href={/^https?:\/\//i.test(p.sourceUrl ?? '') ? p.sourceUrl : undefined} rel="noreferrer noopener nofollow" target="_blank">
                          {p.sourceUrl}
                        </a>
                      ) : (
                        <span className="muted">{p.sourceType}</span>
                      )}
                    </td>
                    <td>
                      <span className="badge warn">{p.evidenceLevel}</span>
                    </td>
                    <td>{p.recordedBy ?? '—'}</td>
                    <td>{p.recordedOn ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">No research has been recorded against this lead with a source.</p>
        )}
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          <strong>URL_SHAPED</strong> means a valid URL is on file and nobody has fetched it. It has not been shown to
          exist, nor to support the claim.
        </p>
      </div>

      {d.missingIntelligence.length ? (
        <>
          <h2>Missing intelligence ({d.missingIntelligence.length})</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>What to find</th>
                  <th>Evidence needed</th>
                  <th>Record with</th>
                </tr>
              </thead>
              <tbody>
                {d.researchTasks.map(t => (
                  <tr key={t.field}>
                    <td>{t.field}</td>
                    <td className="wrap">{t.task}</td>
                    <td className="wrap small muted">{t.evidenceNeeded}</td>
                    <td className="wrap small">
                      <code>{t.recordWith}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <h2>Outreach state</h2>
      <div className="grid2">
        <div className="panel">
          <h3 className="small muted" style={{ margin: '0 0 8px' }}>
            Email (Titan ledger — read only)
          </h3>
          <dl className="kv">
            <dt>Status</dt>
            <dd>{d.emailLedger.status ?? <span className="muted">not in the ledger</span>}</dd>
            <dt>Batch</dt>
            <dd>{d.emailLedger.batch ?? '—'}</dd>
            <dt>Sent</dt>
            <dd>{d.emailLedger.sentDate ?? '—'}</dd>
            <dt>Follow-up due</dt>
            <dd>{d.emailLedger.followUpDue ?? '—'}</dd>
            <dt>Follow-up sent</dt>
            <dd>{lead.email_follow_up_sent_at ?? <span className="muted">not yet (one bump only)</span>}</dd>
          </dl>
        </div>
        <div className="panel">
          <h3 className="small muted" style={{ margin: '0 0 8px' }}>
            Calls, WhatsApp and pipeline
          </h3>
          <dl className="kv">
            <dt>Call attempts</dt>
            <dd>{lead.call_attempts?.length ?? 0}{lead.call_status ? ` — last: ${lead.call_status}` : ''}</dd>
            <dt>WhatsApp</dt>
            <dd>{lead.whatsapp_outreach_status ?? <span className="muted">not started</span>}</dd>
            <dt>Response</dt>
            <dd>{lead.response_status ?? '—'}</dd>
            <dt>Meeting</dt>
            <dd>{lead.meeting_status ?? '—'}</dd>
            <dt>Proposal</dt>
            <dd>{lead.proposal_status ?? '—'}</dd>
            <dt>Deal</dt>
            <dd>{lead.deal_stage ?? '—'}{lead.deal_value ? ` (${lead.deal_value})` : ''}</dd>
          </dl>
        </div>
      </div>

      {lead.call_attempts?.length ? (
        <>
          <h2>Call history</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>By</th>
                  <th>Outcome</th>
                  <th>Objection</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {lead.call_attempts.map((a, i) => (
                  <tr key={`${a.at}-${i}`}>
                    <td>{a.at.slice(0, 16).replace('T', ' ')}</td>
                    <td>{a.by}</td>
                    <td>
                      <span className="badge">{a.outcome}</span>
                    </td>
                    <td className="small">{a.objection_category ?? '—'}</td>
                    <td className="wrap small">{a.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {d.duplicates.length ? (
        <>
          <h2>Possible duplicates</h2>
          <div className="panel small">
            {d.duplicates.map((dup, i) => (
              <p key={i} style={{ margin: '0 0 4px' }}>
                <Link href={`/leads/${dup.duplicateOf}`}>{dup.duplicateOf}</Link> — {dup.reason}
              </p>
            ))}
          </div>
        </>
      ) : null}

      <h2>Opportunity</h2>
      <div className="panel">
        <dl className="kv">
          <dt>Scope</dt>
          <dd>{d.opportunity.scope ?? '—'}</dd>
          <dt>Estimated value</dt>
          <dd>{d.opportunity.value ?? '—'}</dd>
          <dt>Angle</dt>
          <dd className="wrap">{lead.kachmo_solution_angle}</dd>
          <dt>Observable friction</dt>
          <dd className="wrap">{lead.observable_friction}</dd>
          <dt>Commercial signal</dt>
          <dd className="wrap">{lead.commercial_validation_signal}</dd>
        </dl>
      </div>

      <h2>Identity</h2>
      <div className="panel small">
        <dl className="kv">
          <dt>Lead ID</dt>
          <dd>
            <code>{lead.lead_id}</code>
          </dd>
          <dt>Website</dt>
          <dd>
            <a href={/^https?:\/\//i.test(lead.website_url ?? '') ? lead.website_url : undefined} rel="noreferrer noopener nofollow" target="_blank">
              {lead.website_url}
            </a>
          </dd>
          <dt>Created</dt>
          <dd>{lead.created_at.slice(0, 10)}</dd>
          <dt>Updated</dt>
          <dd>{lead.updated_at.slice(0, 10)}</dd>
          <dt>Timezone</dt>
          <dd>{lead.timezone ?? <span className="muted">unresolved — not guessed</span>}</dd>
        </dl>
      </div>
    </>
  );
}
