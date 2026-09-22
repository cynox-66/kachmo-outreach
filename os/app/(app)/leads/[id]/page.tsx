import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/server/auth/current-actor';
import { requestSnapshot } from '@/server/services/snapshot';
import { getCompany } from '@/server/services/company';
import { writeStatusFor } from '@/server/services/write-status';
import {
  EVIDENCE_LEVEL_LABELS,
  GATE_OUTCOME_LABELS,
  actorName,
  dayLabel,
  emailDates,
  fieldNoun,
  humanizeRefusal,
  ledgerStatusLabel,
  momentLabel,
  researchTaskLabel,
} from '@/server/services/operator';
import { recordFieldForTask } from '@/server/services/research-queue';
import type { TimelineEntry } from '@/server/services/timeline';
import { RecordPanel, WritesUnavailable } from '../../components/LeadActions';
import { EvidenceReviewForm } from '../../components/EvidenceReview';
import { AsOf, Banner, Chip, Claim, Disclosure, EmailPreview, PageHead, StatusChip } from '../../components/ui';

export const dynamic = 'force-dynamic';

/** A link only for http(s): a research source is untrusted text and must never become a javascript: link. */
const SafeLink = ({ url, children }: { url: string | null; children?: React.ReactNode }) =>
  url && /^https?:\/\//i.test(url) ? (
    <a href={url} rel="noreferrer noopener nofollow" target="_blank">
      {children ?? url}
    </a>
  ) : (
    <span>{children ?? url}</span>
  );

function HistoryList({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="rows" style={{ listStyle: 'none' }}>
      {entries.map((e, i) => (
        <li key={`${e.at}-${e.kind}-${i}`} className="work" style={{ gridTemplateColumns: 'minmax(96px, 130px) minmax(0, 1fr)' }}>
          <span className="small muted mono">{/^\d{4}-\d{2}-\d{2}$/.test(e.at) ? dayLabel(e.at) : momentLabel(e.at)}</span>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontWeight: 600 }}>{e.title}</strong>
            {e.summary ? <span className="muted"> — {e.summary}</span> : null}
            <div className="small muted">{e.source === 'EVENT' || e.source === 'CALL' ? actorName(e.actor) : e.actor}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * THE COMPANY PAGE (docs/OPERATOR_EXPERIENCE.md §4.3) — in the order an operator reasons: who is this and where do we
 * stand, what do I do next, why them, who do we contact, what will we send, what happened, record something. The
 * engineering detail is all still here, under "Details". Every value comes from `getCompany`; nothing is computed here.
 */
export default async function CompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ record?: string; do?: string }> }) {
  const actor = await requirePermission('lead.view');
  const { id } = await params;
  const { record: recordField, do: doKind } = await searchParams;
  const snap = await requestSnapshot();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const c = await getCompany(id, actor, snap, today);
  if (!c) notFound();

  const { detail, status } = c;
  const { lead, row } = detail;
  const can = (p: Parameters<typeof actor.permissions.has>[0]) => actor.permissions.has(p);
  const canSeeContacts = can('lead.view_contacts');
  const writes = await writeStatusFor(actor);
  const version = detail.version;
  const target = version !== null ? { leadId: lead.lead_id, version, targetNumber: lead.target_number } : null;
  const recordable = !!target && writes.canWrite;
  const options = {
    pipeline: can('pipeline.update'),
    call: can('outreach.call') && !!lead.decision_maker_phone,
    research: can('lead.edit'),
    whatsapp: can('outreach.whatsapp') && (!!lead.whatsapp_outreach_status || row.contactability.whatsapp),
    dnc: can('suppression.create') && !c.block.blocked,
  };
  const nextHref = c.next.record === 'research' && c.next.field ? `?record=${c.next.field}#record` : c.next.record ? `?do=${c.next.record}#record` : null;
  const where = [lead.location_city, lead.location_country].filter(Boolean).join(', ');
  const systemEntries = c.timeline.filter(e => e.system);
  const history = c.timeline.filter(e => !e.system);
  const cover = c.coverage;
  const coverageOf = (gate: string) => cover?.coverage.find(x => x.gate === gate) ?? null;
  const dates = emailDates(snap.tracker.get(lead.target_number) ?? null, today);

  return (
    <>
      <Link className="crumb" href="/leads">
        ← Companies
      </Link>

      <PageHead
        label={`${where} · ${detail.archetypeName} · #${lead.target_number}`}
        title={lead.company_name}
        sub={
          <>
            <SafeLink url={lead.website_url}>{lead.website_url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')}</SafeLink>
            {' · '}
            {status.sentence}
          </>
        }
        aside={
          <>
            <StatusChip status={status} />
            {row.priority !== 'UNSCORED' ? (
              <Chip title={row.priorityConfidence === 'PROVISIONAL' ? 'Provisional: the ranking can change once research is complete.' : undefined}>
                Priority {row.priority}
                {row.priorityConfidence === 'PROVISIONAL' ? ' · provisional' : ''}
              </Chip>
            ) : null}
          </>
        }
      />

      {c.block.blocked ? (
        <Banner tone="stop" chip="Do not contact">
          <p>
            <strong>Nobody may contact {lead.company_name} — no email, no call, no WhatsApp.</strong>
          </p>
          <p className="small">{c.block.sentence}</p>
        </Banner>
      ) : null}

      {/* ── Next step ─────────────────────────────────────────────────── */}
      <section id="next" className="plate lift" style={{ marginTop: 'var(--s4)' }} aria-labelledby="next-h">
        <span className="label" id="next-h">
          Next step
        </span>
        <p style={{ fontSize: 17, margin: 'var(--s1) 0 0' }}>
          <strong>{c.next.text}</strong>
        </p>
        {c.next.detail ? <p className="muted" style={{ margin: 'var(--s1) 0 0' }}>{c.next.detail}</p> : null}
        {nextHref && recordable ? (
          <div className="form-actions" style={{ marginTop: 'var(--s3)' }}>
            <Link className="btn btn-act" href={nextHref}>
              {c.next.record === 'research' ? 'Record what you find' : 'Record it'}
            </Link>
          </div>
        ) : null}
      </section>

      {/* ── Why them ──────────────────────────────────────────────────── */}
      <h2>Why them</h2>
      <div className="plate">
        {c.claims.length ? c.claims.map(cl => <Claim key={cl.key} claim={cl} />) : <p className="muted" style={{ margin: 0 }}>Nothing on file yet — this needs research.</p>}
        {lead.kachmo_solution_angle ? (
          <div className="claim">
            <span className="label what">How Kachmo would help</span>
            <p className="value">{lead.kachmo_solution_angle}</p>
            {detail.opportunity.scope || detail.opportunity.value ? (
              <span className="verify">
                {[detail.opportunity.scope, detail.opportunity.value ? `about ${detail.opportunity.value}` : null].filter(Boolean).join(' · ')} — our estimate
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── Who ───────────────────────────────────────────────────────── */}
      <h2>Who we’d contact</h2>
      <div className="plate">
        <dl className="facts">
          <dt>Decision-maker</dt>
          <dd>
            {c.decisionMaker ? (
              <>
                <strong>{c.decisionMaker.name}</strong>
                {c.decisionMaker.title ? `, ${c.decisionMaker.title}` : ''}
                <span className="small muted">
                  {' '}
                  · {c.decisionMaker.verification === 'UNSOURCED' ? 'no source — confirm who they are before relying on it' : c.decisionMaker.verification === 'CHECKED' ? 'checked' : 'source recorded, not checked'}
                </span>
              </>
            ) : (
              <span className="muted">Not known yet</span>
            )}
          </dd>
          {c.routes.map(r => (
            <div key={r.channel} style={{ display: 'contents' }}>
              <dt>{r.channel}</dt>
              <dd>
                {r.value ? <code>{r.value}</code> : null}
                {r.value ? ' ' : null}
                <span className={r.usable ? '' : 'muted'}>
                  {r.usable ? '✓ ' : ''}
                  {r.says}
                </span>
                {r.source ? (
                  <div className="small muted">
                    Source: <SafeLink url={r.source} />
                  </div>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
        {!canSeeContacts ? <p className="small muted" style={{ margin: 'var(--s3) 0 0' }}>Contact details are hidden for your role.</p> : null}
      </div>

      {/* ── What we'll send ───────────────────────────────────────────── */}
      {c.email.seesEmail && (c.email.queued || c.email.statusLabel) ? (
        <>
          <h2>{c.email.queued ? 'What we’ll send' : 'Email'}</h2>
          <div className="plate">
            {c.email.queued ? (
              <>
                <p style={{ marginTop: 0 }}>
                  {c.email.queued.late ? (
                    <>
                      <Chip tone="act">Late</Chip> Planned for <strong>{dayLabel(c.email.queued.planned)}</strong> — it has not gone out ({c.email.queued.lateDays} day{c.email.queued.lateDays === 1 ? '' : 's'} late).
                    </>
                  ) : c.email.queued.planned ? (
                    <>
                      Sends automatically on <strong>{dayLabel(c.email.queued.planned)}</strong>, on a weekday morning in {c.email.queued.city ?? 'their city'}.
                    </>
                  ) : (
                    'In the automatic email queue.'
                  )}
                </p>
                <EmailPreview email={c.email.queued} open />
                <p className="small muted" style={{ margin: 'var(--s3) 0 0' }}>
                  Sent from the studio inbox by the automatic sender — this app cannot send, edit or cancel it. To stop it, mark the company “Do not contact”; that holds all
                  automatic email until Dev removes it from the queue.
                </p>
              </>
            ) : (
              <dl className="facts">
                <dt>Status</dt>
                <dd>{ledgerStatusLabel(c.email.statusLabel)}</dd>
                {dates.date ? (
                  <>
                    <dt>{dates.kind === 'PLANNED' ? 'Planned for' : 'Sent'}</dt>
                    <dd>
                      {dayLabel(dates.date)}
                      {dates.late ? ` — not sent yet (${dates.lateDays} days late)` : ''}
                    </dd>
                  </>
                ) : null}
                {dates.followUpDue ? (
                  <>
                    <dt>Follow-up</dt>
                    <dd>{lead.email_follow_up_sent_at ? `Sent ${dayLabel(lead.email_follow_up_sent_at.slice(0, 10))}` : `Due ${dayLabel(dates.followUpDue)} — one only`}</dd>
                  </>
                ) : null}
              </dl>
            )}
            <p style={{ margin: 'var(--s3) 0 0' }}>
              <AsOf iso={c.email.asOf} />
            </p>
          </div>
        </>
      ) : null}

      {/* ── History ───────────────────────────────────────────────────── */}
      {version !== null ? (
        <>
          <h2>What happened</h2>
          {history.length ? <HistoryList entries={history} /> : <p className="muted">Nothing has happened with this company yet.</p>}
          {systemEntries.length ? (
            <Disclosure title="Show system changes" meta={`${systemEntries.length} re-checks and audit records`}>
              <HistoryList entries={systemEntries} />
            </Disclosure>
          ) : null}
        </>
      ) : null}

      {/* ── Record ────────────────────────────────────────────────────── */}
      <h2 id="record">Record what happened</h2>
      <div className="plate">
        {version === null ? (
          <p className="muted small" style={{ margin: 0 }}>Changes to this company are recorded with the command-line tools until the database is the source of truth.</p>
        ) : !writes.canWrite ? (
          <WritesUnavailable reason={humanizeRefusal(writes.reason)} />
        ) : (
          <RecordPanel
            target={target!}
            company={lead.company_name}
            options={options}
            blocked={c.block.blocked}
            inQueue={row.queued}
            whatsappStatus={lead.whatsapp_outreach_status}
            canSeeContacts={canSeeContacts}
            canApprove={can('lead.approve')}
            initialField={recordField ?? null}
            initialKind={doKind ?? null}
          />
        )}
      </div>

      {/* ── Details: everything technical, one deliberate click away ─────── */}
      <h2>Details</h2>
      <Disclosure title="Qualification checks" meta={`${detail.gates.filter(g => g.outcome === 'PASS').length} of ${detail.gates.length} met`}>
        <div className="gates">
          {detail.gates.map(g => {
            const cov = coverageOf(g.gate);
            return (
              <div key={g.gate} className="gate">
                <span>
                  <strong style={{ fontWeight: 600 }}>{g.label}</strong>
                  {!g.blocking ? <span className="small muted"> (optional)</span> : null}
                </span>
                <span>
                  <Chip tone={g.outcome === 'FAIL' ? 'stop' : g.outcome === 'PASS' ? 'done' : 'neutral'}>{GATE_OUTCOME_LABELS[g.outcome as keyof typeof GATE_OUTCOME_LABELS]?.label ?? g.outcome}</Chip>
                  {/* Only say something about the source when there is one; "no source" is already the outcome's own meaning. */}
                  {cov && (cov.contradicted || (cov.level !== 'NONE' && cov.level !== 'CLAIMED')) ? (
                    <span className="small muted"> · source: {cov.contradicted ? 'a source disagrees' : EVIDENCE_LEVEL_LABELS[cov.level].toLowerCase()}</span>
                  ) : null}
                  <div className="small muted">{GATE_OUTCOME_LABELS[g.outcome as keyof typeof GATE_OUTCOME_LABELS]?.meaning ?? g.meaning}</div>
                </span>
              </div>
            );
          })}
        </div>
        {cover ? (
          <p className="small muted" style={{ marginTop: 'var(--s3)' }}>
            {cover.summary.checked} of {cover.summary.measurable} checks rest on a source a person has checked. The checks themselves are Methodology v1.0’s; evidence does not change them.
          </p>
        ) : null}
        {detail.reasons.length ? (
          <ul className="small" style={{ margin: 'var(--s3) 0 0', paddingLeft: 18 }}>
            {detail.reasons.map(r => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : null}
      </Disclosure>

      <Disclosure title="Scores" meta={detail.scores.kachmoScore !== null ? `${detail.scores.kachmoScore} / 100` : 'not scored'}>
        <dl className="facts">
          <dt>Kachmo score</dt>
          <dd>
            {detail.scores.kachmoScore ?? '—'} / 100 · {row.priorityLabel}
          </dd>
          <dt>Commercial fit</dt>
          <dd>{detail.scores.commercialFitScore ?? '—'}</dd>
          <dt>Decision-maker</dt>
          <dd>{detail.scores.dmQualityScore ?? '—'}</dd>
          <dt>Website problem</dt>
          <dd>{detail.scores.painScore ?? '—'}</dd>
          <dt>Budget</dt>
          <dd>{detail.scores.budgetScore ?? '—'}</dd>
          <dt>Reason to act now</dt>
          <dd>{detail.scores.intentTriggerScore ?? '—'} <span className="small muted">(urgency only — not part of the score)</span></dd>
        </dl>
        {detail.scores.signals?.length ? <p className="small muted" style={{ marginTop: 'var(--s3)' }}>Signals: {detail.scores.signals.join(' · ')}</p> : null}
        <p className="small muted" style={{ margin: 'var(--s2) 0 0' }}>A ranking over what is known, not a probability of winning — none is estimated.</p>
      </Disclosure>

      <Disclosure id="sources" title="Sources and evidence" meta={`${detail.provenance.length} recorded · ${c.evidence.length} to check`} open={c.evidence.some(e => e.level === 'RETRIEVED' || e.contradictedBy.length > 0)}>
        {detail.provenance.length ? (
          <div className="tablewrap" style={{ marginBottom: 'var(--s4)' }}>
            <table>
              <thead>
                <tr>
                  <th>About</th>
                  <th>Source</th>
                  <th>How far it has been checked</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {detail.provenance.map((p, i) => (
                  <tr key={`${p.field}-${i}`}>
                    <td className="wrap">{researchTaskLabel(p.field)}</td>
                    <td className="wrap small">{p.sourceUrl ? <SafeLink url={p.sourceUrl} /> : <span className="muted">{p.sourceType}</span>}</td>
                    <td className="small">{p.evidenceLevel === 'URL_SHAPED' ? 'Link recorded, not opened' : 'No link'}</td>
                    <td className="small">
                      {actorName(p.recordedBy)}
                      {p.recordedOn ? ` · ${dayLabel(p.recordedOn)}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">No source is recorded for this company’s research.</p>
        )}
        {version !== null ? (
          c.evidence.length ? (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Claim</th>
                    <th>Source</th>
                    <th>Checked?</th>
                  </tr>
                </thead>
                <tbody>
                  {c.evidence.map(e => (
                    <tr key={e.id}>
                      <td className="wrap small">
                        <strong>{fieldNoun(e.field)}</strong>
                        {e.claimValue ? <div className="muted">{e.claimValue}</div> : null}
                        <div className="muted">recorded by {e.recordedBy ?? '—'}</div>
                      </td>
                      <td className="wrap small">
                        {e.sourceUrl ? <SafeLink url={e.sourceUrl}>{e.sourceDomain ?? e.sourceUrl}</SafeLink> : <span className="muted">no link</span>}
                        {e.retrieval ? (
                          <div className="muted">
                            page fetched {dayLabel(e.retrieval.fetchedAt.slice(0, 10))}
                            {e.freshness === 'SOURCE_CHANGED' ? ' · the page changed after it was checked' : ''}
                            {e.freshness === 'STALE' ? ` · ${e.ageDays} days old` : ''}
                          </div>
                        ) : e.failedAttempts ? (
                          <div className="muted">{e.failedAttempts} failed attempt(s) to fetch it</div>
                        ) : null}
                      </td>
                      <td className="wrap small">
                        <Chip tone={e.level === 'SUPPORTED' ? 'done' : e.level === 'CONTRADICTED' || e.contradictedBy.length ? 'stop' : 'neutral'}>
                          {e.contradictedBy.length ? 'A source disagrees' : EVIDENCE_LEVEL_LABELS[e.level]}
                        </Chip>
                        {e.reviewStatus !== 'UNREVIEWED' ? (
                          <div className="muted" style={{ marginTop: 4 }}>
                            {e.reviewStatus === 'CHECKED' ? 'Checked' : 'Not supported'} by {e.reviewedBy ?? '—'}
                            {e.supportingExcerpt && canSeeContacts ? <blockquote style={{ margin: '4px 0 0' }}>“{e.supportingExcerpt}”</blockquote> : null}
                            {e.reviewNote ? <div>{e.reviewNote}</div> : null}
                          </div>
                        ) : e.level === 'RETRIEVED' && can('evidence.review') && canSeeContacts && writes.canWrite && !e.contradictsEvidenceId ? (
                          <EvidenceReviewForm evidenceId={e.id} targetNumber={lead.target_number} />
                        ) : e.level === 'URL_SHAPED' ? (
                          <div className="muted" style={{ marginTop: 4 }}>
                            The page hasn’t been fetched yet.
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>No claim is waiting to be checked. A link recorded with research appears here to be fetched and checked.</p>
          )
        ) : null}
      </Disclosure>

      {detail.researchTasks.length ? (
        <Disclosure title="Missing information" meta={`${detail.researchTasks.length} to find`}>
          <ul className="rows">
            {detail.researchTasks.map(t => {
              const field = recordFieldForTask(t.field);
              return (
                <li key={t.field} className="work">
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontWeight: 600 }}>Find {researchTaskLabel(t.field)}</strong>
                    <p className="sentence muted">{t.evidenceNeeded}</p>
                  </div>
                  <div className="aside">
                    {recordable && field && can('lead.edit') ? (
                      <Link className="btn btn-sm" href={`?record=${field}#record`}>
                        Record it
                      </Link>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Disclosure>
      ) : null}

      {detail.duplicates.length ? (
        <Disclosure title="Possible duplicates" meta={`${detail.duplicates.length}`} open>
          {detail.duplicates.map((d, i) => (
            <p key={i} className="small" style={{ margin: '0 0 var(--s1)' }}>
              <Link href={`/leads/${d.targetNumber === lead.target_number ? d.duplicateOf : d.targetNumber}`}>#{d.targetNumber === lead.target_number ? d.duplicateOf : d.targetNumber}</Link> — {d.reason}
            </p>
          ))}
        </Disclosure>
      ) : null}

      <Disclosure title="System record" meta={detail.drift.length ? 'stored checks are out of date' : `version ${version ?? '—'}`}>
        <dl className="facts">
          <dt>Lead id</dt>
          <dd>
            <code>{lead.lead_id}</code>
          </dd>
          <dt>Number</dt>
          <dd className="mono">{lead.target_number}</dd>
          <dt>Version</dt>
          <dd>{version ?? '—'}</dd>
          <dt>Research state</dt>
          <dd className="mono small">{lead.research_state}</dd>
          <dt>Email records</dt>
          <dd className="mono small">{detail.emailLedger.status ?? '—'}{detail.emailLedger.batch ? ` · ${detail.emailLedger.batch}` : ''}</dd>
          <dt>Timezone</dt>
          <dd>{lead.timezone ?? <span className="muted">not resolved</span>}</dd>
          <dt>Created · updated</dt>
          <dd>
            {lead.created_at.slice(0, 10)} · {lead.updated_at.slice(0, 10)}
          </dd>
          <dt>Owner</dt>
          <dd>{actorName(lead.owner)}</dd>
        </dl>
        {detail.drift.length ? (
          <p className="small" style={{ marginTop: 'var(--s3)' }}>
            The stored checks differ from what the engine computes now: {detail.drift.slice(0, 3).join('; ')}
            {detail.drift.length > 3 ? ` — and ${detail.drift.length - 3} more` : ''}. An owner can refresh them — see <Link href="/settings">Settings</Link>.
          </p>
        ) : null}
      </Disclosure>
    </>
  );
}
