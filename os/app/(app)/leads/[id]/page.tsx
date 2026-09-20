import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/server/auth/current-actor';
import { getLeadDetail } from '@/server/services/leads';
import { presentStatus, presentTone, presentGate, presentField } from '@/server/services/presentation';
import { StatusBadge } from '../../components/StatusBadge';
import { DetailDisclosure } from '../../components/DetailDisclosure';
import { getServer } from '@/server/auth/instance';
import { writeStatusFor } from '@/server/services/write-status';
import { evidenceForLead } from '@/server/evidence/store';
import { coverageForLead } from '@/server/evidence/coverage';
import { getLeadTimeline } from '@/server/services/timeline';
import { recordFieldForTask } from '@/server/services/research-queue';
import { CallLogForm, PipelineForm, ResearchRecordForm, SuppressionForm, WritesUnavailable } from '../../components/LeadActions';
import { EvidenceReviewForm } from '../../components/EvidenceReview';

export const dynamic = 'force-dynamic';

const MARK: Record<string, string> = { PASS: '✓', UNVERIFIED: '~', PENDING: '?', UNKNOWN: '·', FAIL: '✗' };
const BADGE: Record<string, string> = { PASS: 'ok', UNVERIFIED: 'warn', PENDING: 'warn', UNKNOWN: '', FAIL: 'bad' };

/**
 * LEAD DETAIL — Two-level operator presentation:
 * Level 1: Simple Overview (Why them, Opportunity, Next Action, Contact, Outreach)
 * Level 2: Full Intelligence (Gates, Score breakdown, Provenance, Missing intelligence, Titan ledger)
 *
 * All values are computed by core/ from the canonical record.
 */
export default async function LeadDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ record?: string }> }) {
  const actor = await requirePermission('lead.view');
  const { id } = await params;
  const { record: recordField } = await searchParams;
  const d = await getLeadDetail(id, actor);
  if (!d) notFound();

  const { lead, row, contacts, scores } = d;
  const writes = await writeStatusFor(actor);
  // Claim-level evidence exists only in Postgres (after cutover); `version` is set exactly then.
  const evidence = d.version !== null ? await evidenceForLead(getServer().db, lead.lead_id) : [];
  const timeline = d.version !== null ? await getLeadTimeline(lead) : [];
  // How far each gate's source has actually been taken (Phase D, ADR-031). Measurement only: the gate outcomes above
  // are Methodology v1.0's, unchanged.
  const cover = d.version !== null ? await coverageForLead(getServer().db, lead, d.qualificationGates) : null;
  const coverageOf = (gate: string) => cover?.coverage.find(c => c.gate === gate) ?? null;
  const LEVEL_TONE: Record<string, string> = { SUPPORTED: 'ok', RETRIEVED: 'warn', CONTRADICTED: 'bad', URL_SHAPED: 'warn', CLAIMED: 'warn', NONE: '' };
  const can = (p: Parameters<typeof actor.permissions.has>[0]) => actor.permissions.has(p);
  const canSeeContacts = can('lead.view_contacts');
  const canReview = can('evidence.review') && canSeeContacts;
  const version = d.version;

  const contactLine = (label: string, c: typeof contacts.email) => {
    if (!c.present) return <span className="muted">none on file</span>;
    return (
      <span>
        <code>{c.visible ? c.value : c.masked}</code>{' '}
        <span className={`badge ${c.usableForOutreach ? 'ok' : 'warn'}`}>{c.status}</span>
        {!c.visible ? <span className="badge" style={{ marginLeft: 6 }}>hidden for your role</span> : null}
      </span>
    );
  };

  const contactRow = (label: string, c: typeof contacts.email) => (
    <>
      <dt>{label}</dt>
      <dd>
        {c.present ? (
          <>
            <code>{c.visible ? c.value : c.masked}</code> <span className={`badge ${c.usableForOutreach ? 'ok' : 'warn'}`}>{c.status}</span>
            {!c.visible ? <span className="badge" style={{ marginLeft: 6 }}>hidden for your role</span> : null}
            <div className="small muted" style={{ marginTop: 2 }}>
              {c.provenanceNote}
              {c.source ? (
                <>
                  {' — '}
                  {/^https?:\/\//.test(c.source) ? (
                    <a href={c.source} rel="noreferrer noopener nofollow" target="_blank">
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

  /* ── LEVEL 1: SIMPLE OVERVIEW ────────────────────────────────────────── */
  const simpleView = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Why We're Looking At Them */}
      <div className="panel">
        <h2 style={{ margin: '0 0 8px', fontSize: '14px' }}>Why We&rsquo;re Looking At Them</h2>
        <p style={{ margin: '0 0 6px' }}>
          <strong>{lead.commercial_validation_signal || 'No commercial signal recorded.'}</strong>
        </p>
        {lead.why_now ? (
          <p className="small muted" style={{ margin: 0 }}>
            Trigger: {lead.why_now}
          </p>
        ) : null}
      </div>

      {/* Opportunity */}
      <div className="panel">
        <h2 style={{ margin: '0 0 8px', fontSize: '14px' }}>Opportunity</h2>
        <dl className="kv">
          <dt>Angle</dt>
          <dd className="wrap"><strong>{lead.kachmo_solution_angle || '—'}</strong></dd>
          <dt>Observable friction</dt>
          <dd className="wrap">{lead.observable_friction || '—'}</dd>
          <dt>Estimated scope</dt>
          <dd>{d.opportunity.scope ?? '—'}</dd>
          <dt>Estimated value</dt>
          <dd>{d.opportunity.value ?? '—'}</dd>
        </dl>
      </div>

      {/* Next Action */}
      <div className="panel">
        <div className="row between" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: '14px' }}>Next Action</h2>
          {lead.next_action_date ? (
            <span className="badge warn">Due: {lead.next_action_date}</span>
          ) : null}
        </div>
        <p style={{ margin: '0 0 8px', fontSize: '15px', fontWeight: 550 }}>
          {row.nextAction ?? 'No next action recorded.'}
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          Owner: <strong>{lead.owner ?? 'unassigned'}</strong> · Channel: <strong>{lead.recommended_channel ?? 'none'}</strong>
          {d.opportunity.reason ? ` — ${d.opportunity.reason}` : ''}
        </p>
      </div>

      {/* Contact Summary */}
      <div className="panel">
        <h2 style={{ margin: '0 0 8px', fontSize: '14px' }}>Decision-maker & Contact</h2>
        <dl className="kv">
          <dt>Decision-maker</dt>
          <dd>
            {lead.decision_maker_name ? (
              <>
                <strong>{lead.decision_maker_name}</strong>
                {lead.decision_maker_title ? ` · ${lead.decision_maker_title}` : ''}{' '}
                <span className="badge">{lead.decision_maker_confidence}</span>
              </>
            ) : (
              <span className="muted">Not verified yet</span>
            )}
          </dd>
          <dt>Email</dt>
          <dd>{contactLine('Email', contacts.email)}</dd>
          <dt>Phone</dt>
          <dd>{contactLine('Phone', contacts.phone)}</dd>
          <dt>Calling readiness</dt>
          <dd>
            <span className={`badge ${d.callEligibility.ok ? 'ok' : 'warn'}`}>
              {d.callEligibility.ok ? 'Callable' : 'Not callable'}
            </span>{' '}
            <span className="small muted">{d.callEligibility.reason}</span>
          </dd>
        </dl>
      </div>

      {/* Outreach State */}
      <div className="panel">
        <h2 style={{ margin: '0 0 8px', fontSize: '14px' }}>Outreach Status</h2>
        <dl className="kv">
          <dt>Email status</dt>
          <dd>{d.emailLedger.status ?? <span className="muted">Not in ledger</span>}</dd>
          {d.emailLedger.sentDate ? (
            <>
              <dt>Sent on</dt>
              <dd>{d.emailLedger.sentDate}</dd>
            </>
          ) : null}
          {d.emailLedger.followUpDue ? (
            <>
              <dt>Follow-up due</dt>
              <dd>{d.emailLedger.followUpDue}</dd>
            </>
          ) : null}
          <dt>Pipeline stage</dt>
          <dd>{row.pipelineStage}</dd>
        </dl>
      </div>

      {/* Record what happened (Phase B) */}
      <div className="panel" id="record">
        <h2 style={{ margin: '0 0 8px', fontSize: '14px' }}>Record What Happened</h2>
        {version === null ? (
          <p className="small muted" style={{ margin: 0 }}>Before cutover, changes to this lead are recorded with the CLI.</p>
        ) : !writes.canWrite ? (
          <WritesUnavailable reason={writes.reason ?? 'unavailable'} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {can('lead.edit') ? (
              <section>
                <p className="small muted" style={{ margin: '0 0 6px', fontWeight: 600 }}>Research you found</p>
                <ResearchRecordForm leadId={lead.lead_id} version={version} canSeeContacts={canSeeContacts} canApprove={can('lead.approve')} initialField={recordField} />
              </section>
            ) : null}
            {can('outreach.call') && lead.decision_maker_phone ? (
              <section>
                <p className="small muted" style={{ margin: '0 0 6px', fontWeight: 600 }}>A call</p>
                <CallLogForm leadId={lead.lead_id} version={version} />
              </section>
            ) : null}
            {can('pipeline.update') ? (
              <section>
                <p className="small muted" style={{ margin: '0 0 6px', fontWeight: 600 }}>A sales stage</p>
                <PipelineForm leadId={lead.lead_id} version={version} />
              </section>
            ) : null}
            {can('suppression.create') && !d.suppression.suppressed && !lead.do_not_contact ? (
              <section>
                <p className="small muted" style={{ margin: '0 0 6px', fontWeight: 600 }}>An opt-out</p>
                <SuppressionForm leadId={lead.lead_id} />
              </section>
            ) : null}
            <p className="small muted" style={{ margin: 0 }}>Recording as {writes.engineActor} · version {version}. Every change is re-evaluated by the engine and audited under your name.</p>
          </div>
        )}
      </div>
    </div>
  );

  /* ── LEVEL 2: FULL INTELLIGENCE ──────────────────────────────────────── */
  const intelligenceView = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Gates */}
      <div>
        <h2>Qualification Gates</h2>
        <div className="panel">
          <div className="gates">
            {d.gates.map(g => (
              <div key={g.gate} className="gate">
                <span className="mark">{MARK[g.outcome] ?? '·'}</span>
                <span>
                  <strong>{presentGate(g.gate)}</strong>
                  {!g.blocking ? <span className="small muted"> (advisory)</span> : null}
                </span>
                <span>
                  <span className={`badge ${BADGE[g.outcome] ?? ''}`}>{g.outcome}</span>{' '}
                  {(() => {
                    const c = coverageOf(g.gate);
                    if (!c || !c.fields.length) return null;
                    return (
                      <span className={`badge ${c.contradicted ? 'bad' : LEVEL_TONE[c.level] ?? ''}`} title={`Evidence recorded for ${c.fields.join(', ')}`}>
                        evidence: {c.contradicted ? 'CONTRADICTED' : c.level}
                      </span>
                    );
                  })()}{' '}
                  <span className="small muted">{g.meaning}</span>
                </span>
              </div>
            ))}
          </div>
          {cover ? (
            <p className="small muted" style={{ marginTop: 10 }}>
              Evidence coverage: {cover.summary.checked} of {cover.summary.measurable} gates rest on a source a person has checked
              {cover.summary.retrieved ? `, ${cover.summary.retrieved} on a page that was fetched but not yet read` : ''}
              {cover.summary.contradicted ? `, ${cover.summary.contradicted} contradicted` : ''}. The gate outcomes themselves are
              Methodology v1.0&rsquo;s and are not affected by this measurement.
            </p>
          ) : null}
          {d.reasons.length ? (
            <>
              <p className="small muted" style={{ margin: '12px 0 4px' }}>
                Recorded evidence reasons:
              </p>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {d.reasons.map(r => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>

      {/* Heuristic Scores */}
      <div>
        <h2>Heuristic Score Breakdown</h2>
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
            <dt>Pain / opportunity</dt>
            <dd>{scores.painScore ?? '—'}</dd>
            <dt>Budget viability</dt>
            <dd>{scores.budgetScore ?? '—'}</dd>
            <dt>Intent trigger</dt>
            <dd>
              {scores.intentTriggerScore ?? '—'}{' '}
              <span className="small muted">(advisory only; not part of Kachmo score)</span>
            </dd>
          </dl>
          {scores.signals?.length ? (
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              Detected signals: {scores.signals.join(' · ')}
            </p>
          ) : null}
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            Heuristic ranking over known dimensions. It is not a conversion probability; none is estimated.
          </p>
        </div>
      </div>

      {/* Contact Provenance */}
      <div>
        <h2>Contact Details & Provenance</h2>
        <div className="panel">
          <dl className="kv">
            {contactRow('Email', contacts.email)}
            {contactRow('Phone', contacts.phone)}
            <dt>WhatsApp basis</dt>
            <dd>
              {lead.whatsapp_basis ? (
                <>
                  {lead.whatsapp_basis}{' '}
                  <span className="small muted">— {lead.whatsapp_basis_source}</span>
                </>
              ) : (
                <span className="muted">None recorded</span>
              )}
            </dd>
            <dt>Call eligibility</dt>
            <dd>
              <span className={`badge ${d.callEligibility.ok ? 'ok' : 'warn'}`}>
                {d.callEligibility.ok ? 'callable' : 'not callable'}
              </span>{' '}
              <span className="small muted">{d.callEligibility.reason}</span>
            </dd>
          </dl>
        </div>
      </div>

      {/* Evidence & Provenance Table */}
      <div>
        <h2>Research Evidence Provenance</h2>
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
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {d.provenance.map((p, i) => (
                    <tr key={`${p.field}-${i}`}>
                      <td>{presentField(p.field)}</td>
                      <td className="wrap small">
                        {p.sourceUrl ? (
                          <a href={p.sourceUrl} rel="noreferrer noopener nofollow" target="_blank">
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
            <p className="empty">No provenance source recorded against this lead.</p>
          )}
        </div>
      </div>

      {/* Claim Evidence (Phase B) */}
      {version !== null ? (
        <div>
          <h2>Claim Evidence ({evidence.length})</h2>
          <div className="panel">
            {evidence.length ? (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Claim</th>
                      <th>Source</th>
                      <th>Level</th>
                      <th>Checked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evidence.map(e => (
                      <tr key={e.id}>
                        <td className="wrap small">
                          <strong>{presentField(e.field)}</strong>
                          {e.claimValue ? <div className="muted">{e.claimValue}</div> : null}
                          <div className="muted">{e.origin.toLowerCase().replace(/_/g, ' ')} · {e.recordedBy ?? '—'}</div>
                        </td>
                        <td className="wrap small">
                          {e.sourceUrl ? (
                            <a href={e.sourceUrl} rel="noreferrer noopener nofollow" target="_blank">{e.sourceDomain ?? e.sourceUrl}</a>
                          ) : (
                            <span className="muted">no URL</span>
                          )}
                          {e.retrieval ? (
                            <div className="muted">
                              fetched {e.retrieval.fetchedAt.slice(0, 10)} · HTTP {e.retrieval.httpStatus ?? '—'}
                              {e.freshness === 'SOURCE_CHANGED' ? <> · <span className="badge bad">source changed since it was checked</span></> : null}
                              {e.freshness === 'STALE' ? <> · <span className="badge warn">stale ({e.ageDays}d)</span></> : null}
                            </div>
                          ) : null}
                          {!e.retrieval && e.failedAttempts ? <div className="muted">{e.failedAttempts} failed fetch attempt(s)</div> : null}
                        </td>
                        <td className="small">
                          <span className={`badge ${e.level === 'SUPPORTED' ? 'ok' : e.level === 'CONTRADICTED' ? 'bad' : 'warn'}`}>{e.level}</span>
                          {e.contradictedBy.length ? <div><span className="badge bad">contradicted</span></div> : null}
                          <div className="muted">{e.levelReason}</div>
                        </td>
                        <td className="wrap small">
                          {e.reviewStatus !== 'UNREVIEWED' ? (
                            <>
                              <div>{e.reviewStatus === 'CHECKED' ? 'checked' : 'not supported'} by {e.reviewedBy ?? '—'}</div>
                              {e.supportingExcerpt && canSeeContacts ? <blockquote className="muted" style={{ margin: '4px 0 0' }}>&ldquo;{e.supportingExcerpt}&rdquo;</blockquote> : null}
                              {e.reviewNote ? <div className="muted">{e.reviewNote}</div> : null}
                            </>
                          ) : e.level === 'RETRIEVED' && canReview && writes.canWrite && !e.contradictsEvidenceId ? (
                            <EvidenceReviewForm evidenceId={e.id} leadId={lead.lead_id} />
                          ) : (
                            <span className="muted">{e.level === 'URL_SHAPED' ? 'not fetched yet (evidence:fetch)' : '—'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">No claim evidence yet. A source URL recorded with research, or arriving with an approved candidate, appears here to be fetched and checked.</p>
            )}
            <p className="small muted" style={{ marginTop: 8 }}>
              Evidence never changes the lead or its gates. A SUPPORTED contact source is adopted onto the lead only by recording it above.
            </p>
          </div>
        </div>
      ) : null}

      {/* Missing Intelligence */}
      {d.missingIntelligence.length ? (
        <div>
          <h2>Missing Intelligence ({d.missingIntelligence.length})</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>What to find</th>
                  <th>Evidence needed</th>
                  <th>Record it</th>
                </tr>
              </thead>
              <tbody>
                {d.researchTasks.map(t => (
                  <tr key={t.field}>
                    <td>{presentField(t.field)}</td>
                    <td className="wrap">{t.task}</td>
                    <td className="wrap small muted">{t.evidenceNeeded}</td>
                    <td className="wrap small">
                      {version !== null && can('lead.edit') && recordFieldForTask(t.field) ? (
                        <Link href={`/leads/${row.targetNumber}?record=${recordFieldForTask(t.field)}#record`}>Record {presentField(t.field)} →</Link>
                      ) : version !== null ? (
                        <span className="muted">record it on this page</span>
                      ) : (
                        <code>{t.recordWith}</code>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Outreach State Machine */}
      <div>
        <h2>Outreach & Sales State</h2>
        <div className="grid2">
          <div className="panel">
            <h3 className="small muted" style={{ margin: '0 0 8px' }}>
              Titan Email Ledger (Read-only)
            </h3>
            <dl className="kv">
              <dt>Status</dt>
              <dd>{d.emailLedger.status ?? <span className="muted">Not in ledger</span>}</dd>
              <dt>Batch</dt>
              <dd>{d.emailLedger.batch ?? '—'}</dd>
              <dt>Sent date</dt>
              <dd>{d.emailLedger.sentDate ?? '—'}</dd>
              <dt>Follow-up due</dt>
              <dd>{d.emailLedger.followUpDue ?? '—'}</dd>
              <dt>Follow-up sent</dt>
              <dd>{lead.email_follow_up_sent_at ?? <span className="muted">Not sent (1 bump only)</span>}</dd>
            </dl>
          </div>
          <div className="panel">
            <h3 className="small muted" style={{ margin: '0 0 8px' }}>
              Call & Pipeline State
            </h3>
            <dl className="kv">
              <dt>Call attempts</dt>
              <dd>{lead.call_attempts?.length ?? 0}{lead.call_status ? ` — last: ${lead.call_status}` : ''}</dd>
              <dt>WhatsApp</dt>
              <dd>{lead.whatsapp_outreach_status ?? <span className="muted">Not started</span>}</dd>
              <dt>Response</dt>
              <dd>{lead.response_status ?? '—'}</dd>
              <dt>Meeting</dt>
              <dd>{lead.meeting_status ?? '—'}</dd>
              <dt>Proposal</dt>
              <dd>{lead.proposal_status ?? '—'}</dd>
              <dt>Deal stage</dt>
              <dd>{lead.deal_stage ?? '—'}{lead.deal_value ? ` (${lead.deal_value})` : ''}</dd>
            </dl>
          </div>
        </div>
      </div>

      {/* Call History */}
      {lead.call_attempts?.length ? (
        <div>
          <h2>Call History</h2>
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
                    <td><span className="badge">{a.outcome}</span></td>
                    <td className="small">{a.objection_category ?? '—'}</td>
                    <td className="wrap small">{a.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* History (Phase C, ADR-029) */}
      {version !== null ? (
        <div>
          <h2>History ({timeline.length})</h2>
          <div className="panel">
            {timeline.length ? (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>What</th>
                      <th>Who</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.map((e, i) => (
                      <tr key={`${e.at}-${e.kind}-${i}`}>
                        <td className="small" style={{ whiteSpace: 'nowrap' }}>{e.at.slice(0, 16).replace('T', ' ')}</td>
                        <td className="small"><span className="badge">{e.kind}</span></td>
                        <td className="small">{e.actor}</td>
                        <td className="wrap small muted">{e.details.join(' · ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">Nothing recorded against this lead yet.</p>
            )}
            <p className="small muted" style={{ marginTop: 8 }}>
              Domain events, audited actions and call attempts, newest first. Contact values are never written to either log.
            </p>
          </div>
        </div>
      ) : null}

      {/* Duplicates */}
      {d.duplicates.length ? (
        <div>
          <h2>Possible Duplicates</h2>
          <div className="panel small">
            {d.duplicates.map((dup, i) => (
              <p key={i} style={{ margin: '0 0 4px' }}>
                <Link href={`/leads/${dup.duplicateOf}`}>{dup.duplicateOf}</Link> — {dup.reason}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {/* Canonical Identity */}
      <div>
        <h2>System Identity</h2>
        <div className="panel small">
          <dl className="kv">
            <dt>Lead ID</dt>
            <dd><code>{lead.lead_id}</code></dd>
            <dt>Website</dt>
            <dd>
              {lead.website_url ? (
                <a href={lead.website_url} rel="noreferrer noopener nofollow" target="_blank">
                  {lead.website_url}
                </a>
              ) : (
                <span className="muted">—</span>
              )}
            </dd>
            <dt>Created</dt>
            <dd>{lead.created_at.slice(0, 10)}</dd>
            <dt>Updated</dt>
            <dd>{lead.updated_at.slice(0, 10)}</dd>
            <dt>Timezone</dt>
            <dd>{lead.timezone ?? <span className="muted">Unresolved</span>}</dd>
          </dl>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <p className="crumb">
        <Link href="/leads">← Leads</Link>
      </p>

      {/* Header */}
      <div className="row between" style={{ marginBottom: 6 }}>
        <div>
          <h1 style={{ margin: 0 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '18px', color: 'var(--ink-muted)', marginRight: 8 }}>
              {row.targetNumber}
            </span>
            {lead.company_name}
          </h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {d.archetypeName} · {lead.location_city ? `${lead.location_city}, ` : ''}{lead.location_country} · research {lead.research_completeness_score}% complete
          </p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="badge">{row.priorityLabel}</span>
          <StatusBadge
            label={row.suppressed ? 'Do not contact' : presentStatus(row.researchState)}
            tone={row.suppressed ? 'bad' : presentTone(row.researchState)}
          />
        </div>
      </div>

      {d.suppression.suppressed ? (
        <div className="notice" style={{ marginTop: 12, marginBottom: 16 }}>
          <p>
            <strong>This company must not be contacted.</strong> {d.suppression.reason}
          </p>
        </div>
      ) : null}

      {d.drift.length ? (
        <div className="notice" style={{ marginTop: 12, marginBottom: 16 }}>
          <p>
            <strong>The stored state of this lead is behind the engine.</strong> Run a re-evaluation
            (<code>npm --prefix os run leads:reevaluate</code>) to bring it up to date: {d.drift.slice(0, 3).join('; ')}
            {d.drift.length > 3 ? ` — and ${d.drift.length - 3} more` : ''}.
          </p>
        </div>
      ) : null}

      {/* Progressive Disclosure Component: Simple Overview vs Full Intelligence */}
      <DetailDisclosure simpleView={simpleView} intelligenceView={intelligenceView} />
    </>
  );
}
