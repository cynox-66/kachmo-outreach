'use client';
import { useActionState, useState, startTransition, type FormEvent, type ReactNode } from 'react';
import {
  logCallAction,
  whatsappTransitionAction,
  pipelineTransitionAction,
  recordResearchAction,
  createSuppressionAction,
  type LeadActionState,
} from '@/server/leads/actions';
import { CALL_OUTCOME_CHOICES, STAGE_CHOICES, WHATSAPP_CHOICES, RESEARCH_CHOICES } from '@/lib/choices';
import { OBJECTION_CATEGORIES, LOST_REASONS } from '@kachmo/core/leads/schema.js';
import { SOURCE_TYPES } from '@kachmo/core/research/evidence.js';

/**
 * RECORDING WHAT HAPPENED (Phase B write path; operator redesign, ADR-035).
 *
 * Every rule lives on the server; these forms collect input and show the server's answer. What they add is safety for
 * the person using them (audit C1–C3):
 *
 *   - One form at a time, chosen explicitly.
 *   - No consequential default: every choice starts empty, and the server refuses an empty choice anyway.
 *   - The consequence of a choice is stated before the button.
 *   - Do-not-contact takes an explicit confirmation (the server refuses one without it).
 *   - A refused or failed submit keeps everything typed: the form is submitted through a transition rather than as a
 *     form action, because React resets a form action's fields before it even runs.
 *   - A successful submit is replaced by what was recorded; recording another thing is a deliberate click. (A retry of
 *     the same submit after a network failure carries the old version and is refused by the server — reproduced.)
 *   - Every form carries the version it was rendered from, so a change made meanwhile by someone else is refused.
 */

const INITIAL: LeadActionState = { error: null };
type Action = (prev: LeadActionState, form: FormData) => Promise<LeadActionState>;

function useRecord(action: Action) {
  const [state, dispatch, pending] = useActionState(action, INITIAL);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  };
  return { state, pending, onSubmit };
}

interface Target {
  leadId: string;
  version: number;
  targetNumber: string;
}

function Hidden({ leadId, version, targetNumber }: Target) {
  return (
    <>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="targetNumber" value={targetNumber} />
    </>
  );
}

function Refused({ state }: { state: LeadActionState }) {
  if (!state.error) return null;
  return (
    <div className="notice" role="alert">
      <p>
        <strong>Not recorded.</strong> {state.error}
      </p>
    </div>
  );
}

function Recorded({ state, onAnother, anotherLabel = 'Record something else' }: { state: LeadActionState; onAnother?: () => void; anotherLabel?: string }) {
  return (
    <div className="plate lift recorded" role="status">
      <div>
        <span className="label">Recorded</span>
        <p style={{ margin: 0 }}>{state.ok}</p>
        {state.warnings?.length ? <p className="muted small" style={{ margin: 'var(--s1) 0 0' }}>{state.warnings.join(' ')}</p> : null}
      </div>
      {onAnother ? (
        <button type="button" className="btn-sm" onClick={onAnother}>
          {anotherLabel}
        </button>
      ) : null}
    </div>
  );
}

function Submit({ pending, children, tone = 'act' }: { pending: boolean; children: ReactNode; tone?: 'act' | 'stop' }) {
  return (
    <button type="submit" className={tone === 'stop' ? 'btn-stop' : 'btn-act'} disabled={pending}>
      {pending ? 'Recording…' : children}
    </button>
  );
}

const pretty = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

/** Shown instead of forms when this person cannot record right now — with the reason, not a dead button. */
export function WritesUnavailable({ reason }: { reason: string }) {
  return (
    <p className="muted small" style={{ margin: 0 }}>
      Recording isn’t available: {reason}
    </p>
  );
}

// ── A reply, a meeting, a deal ───────────────────────────────────────────────

const STAGES = Object.keys(STAGE_CHOICES);
const CHANNELS: Array<[string, string]> = [
  ['EMAIL', 'Email'],
  ['CALL', 'Phone call'],
  ['WHATSAPP', 'WhatsApp'],
  ['LINKEDIN', 'LinkedIn'],
  ['OTHER', 'Other'],
];

export function PipelineForm({ target, onAnother }: { target: Target; onAnother?: () => void }) {
  const { state, pending, onSubmit } = useRecord(pipelineTransitionAction);
  const [stage, setStage] = useState('');
  if (state.ok) return <Recorded state={state} onAnother={onAnother} />;
  const choice = STAGE_CHOICES[stage];
  return (
    <form onSubmit={onSubmit} className="record-form">
      <Hidden {...target} />
      <Refused state={state} />
      <div className="form-grid">
        <label>
          What happened?
          <select name="stage" required value={stage} onChange={e => setStage(e.target.value)}>
            <option value="" disabled>
              Choose…
            </option>
            {STAGES.map(s => (
              <option key={s} value={s}>
                {STAGE_CHOICES[s].label}
              </option>
            ))}
          </select>
        </label>
        {choice?.needsChannel ? (
          <label>
            How did they get in touch?
            <select name="channel" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {CHANNELS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {stage === 'MEETING_BOOKED' ? (
          <label>
            Meeting date
            <input type="date" name="date" />
          </label>
        ) : null}
        {stage === 'WON' ? (
          <label>
            Deal value
            <input name="value" maxLength={40} placeholder="e.g. $6,000" />
          </label>
        ) : null}
        {stage === 'LOST' ? (
          <label>
            Why was it lost?
            <select name="reason" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {LOST_REASONS.map(r => (
                <option key={r} value={r}>
                  {pretty(r)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <label style={{ marginTop: 'var(--s3)' }}>
        Notes <span className="field-note">(optional)</span>
        <textarea name="notes" maxLength={2000} rows={3} />
      </label>
      {choice ? <p className="consequence">{choice.consequence}</p> : null}
      <div className="form-actions">
        <Submit pending={pending}>Record</Submit>
        <span className="field-note">Email follow-ups are recorded by the email tools, not here.</span>
      </div>
    </form>
  );
}

// ── A call ───────────────────────────────────────────────────────────────────

const CONNECTED = new Set(['GATEKEEPER', 'CALLBACK', 'INTERESTED', 'NOT_NOW', 'NOT_INTERESTED', 'MEETING_BOOKED', 'DO_NOT_CONTACT']);
const WITH_DATE = new Set(['CALLBACK', 'NOT_NOW', 'MEETING_BOOKED']);

export function CallForm({ target, blocked = false, onAnother }: { target: Target; blocked?: boolean; onAnother?: () => void }) {
  const { state, pending, onSubmit } = useRecord(logCallAction);
  const [outcome, setOutcome] = useState('');
  if (state.ok) return <Recorded state={state} onAnother={onAnother} />;
  const choice = CALL_OUTCOME_CHOICES[outcome];
  return (
    <form onSubmit={onSubmit} className="record-form">
      <Hidden {...target} />
      <Refused state={state} />
      {blocked ? (
        <p className="consequence stop" style={{ marginTop: 0, marginBottom: 'var(--s3)' }}>
          This company must not be contacted. Only record a call that has already happened, so it is on the record.
        </p>
      ) : null}
      <div className="form-grid">
        <label>
          How did the call go?
          <select name="outcome" required value={outcome} onChange={e => setOutcome(e.target.value)}>
            <option value="" disabled>
              Choose…
            </option>
            {Object.entries(CALL_OUTCOME_CHOICES).map(([v, c]) => (
              <option key={v} value={v}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {CONNECTED.has(outcome) && outcome !== 'DO_NOT_CONTACT' ? (
          <label>
            Their objection <span className="field-note">(if any)</span>
            <select name="objectionCategory" defaultValue="">
              <option value="">None</option>
              {OBJECTION_CATEGORIES.map(o => (
                <option key={o} value={o}>
                  {pretty(o)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {WITH_DATE.has(outcome) ? (
          <label>
            {outcome === 'MEETING_BOOKED' ? 'Meeting date' : 'Call them back on'}
            <input type="date" name="callbackDate" />
          </label>
        ) : null}
      </div>
      <label style={{ marginTop: 'var(--s3)' }}>
        What was said <span className="field-note">(optional)</span>
        <textarea name="notes" maxLength={2000} rows={3} />
      </label>
      {CONNECTED.has(outcome) && outcome !== 'DO_NOT_CONTACT' && outcome !== 'GATEKEEPER' ? (
        <div className="row" style={{ marginTop: 'var(--s3)', gap: 'var(--s4)' }}>
          <label className="inline small">
            <input type="checkbox" name="confirmedIdentity" /> I spoke to the named decision-maker
          </label>
          {outcome !== 'NOT_INTERESTED' ? (
            <label className="inline small">
              <input type="checkbox" name="whatsappOk" /> They agreed to WhatsApp follow-up
            </label>
          ) : null}
        </div>
      ) : null}
      {choice ? <p className={`consequence${choice.stop ? ' stop' : ''}`}>{choice.consequence}</p> : null}
      {choice?.stop ? (
        <label className="inline small" style={{ marginTop: 'var(--s3)' }}>
          <input type="checkbox" required /> I understand: they will never be contacted again, on any channel.
        </label>
      ) : null}
      <div className="form-actions">
        <Submit pending={pending} tone={choice?.stop ? 'stop' : 'act'}>
          {choice?.stop ? 'Record — never contact them' : 'Record the call'}
        </Submit>
      </div>
    </form>
  );
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────

/** Which WhatsApp steps make sense from the current status; the server enforces the order regardless. */
function whatsappSteps(status: string | null): string[] {
  if (status === 'APPROVED') return ['SENT', 'REJECTED', 'OPT_OUT'];
  if (status === 'SENT') return ['REPLIED', 'OPT_OUT'];
  if (status === 'REPLIED') return ['OPT_OUT'];
  return ['APPROVED', 'REJECTED', 'OPT_OUT'];
}

export function WhatsAppForm({ target, status, onAnother }: { target: Target; status: string | null; onAnother?: () => void }) {
  const { state, pending, onSubmit } = useRecord(whatsappTransitionAction);
  const [step, setStep] = useState('');
  if (state.ok) return <Recorded state={state} onAnother={onAnother} />;
  const choice = WHATSAPP_CHOICES[step];
  return (
    <form onSubmit={onSubmit} className="record-form">
      <Hidden {...target} />
      <Refused state={state} />
      <div className="form-grid">
        <label>
          What happened?
          <select name="status" required value={step} onChange={e => setStep(e.target.value)}>
            <option value="" disabled>
              Choose…
            </option>
            {whatsappSteps(status).map(s => (
              <option key={s} value={s}>
                {WHATSAPP_CHOICES[s].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Notes <span className="field-note">(optional)</span>
          <input name="notes" maxLength={2000} />
        </label>
      </div>
      {choice ? <p className={`consequence${choice.stop ? ' stop' : ''}`}>{choice.consequence}</p> : null}
      {choice?.stop ? (
        <label className="inline small" style={{ marginTop: 'var(--s3)' }}>
          <input type="checkbox" required /> I understand: they will never be contacted again, on any channel.
        </label>
      ) : null}
      <div className="form-actions">
        <Submit pending={pending} tone={choice?.stop ? 'stop' : 'act'}>
          {choice?.stop ? 'Record — never contact them' : 'Record'}
        </Submit>
        <span className="field-note">Nothing is ever sent from here.</span>
      </div>
    </form>
  );
}

// ── Research ─────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  official_website: 'Their website',
  linkedin: 'LinkedIn',
  google_business_profile: 'Google business profile',
  press: 'Press / news',
  directory: 'Directory',
  social: 'Social media',
  job_board: 'Job listing',
  companies_register: 'Companies register',
  other: 'Other',
};
const CONTACT_ORIGINS: Array<[string, string, string]> = [
  ['PUBLICLY_LISTED', 'Published by them', 'needs the link to the page where they publish it'],
  ['VERIFIED', 'Confirmed by us', 'say how you confirmed it'],
  ['UNVERIFIED', 'Source unknown', 'kept, but never used for outreach'],
  ['INVALID', 'Bounced or wrong', 'marks it unusable'],
];
const BUDGETS: Array<[string, string]> = [
  ['VERY_HIGH', 'Very high'],
  ['HIGH', 'High'],
  ['MEDIUM', 'Medium'],
  ['LOW', 'Low'],
  ['UNKNOWN', 'Unknown'],
];
const TEAMS: Array<[string, string]> = [
  ['NO_FRONTEND_TEAM', 'No frontend team'],
  ['SMALL_INTERNAL_TEAM', 'A small internal team'],
  ['LARGE_INTERNAL_TEAM', 'A large internal team'],
  ['UNCLEAR', 'Unclear'],
];

export function ResearchForm({ target, canSeeContacts, canApprove, initialField, onAnother }: { target: Target; canSeeContacts: boolean; canApprove: boolean; initialField?: string | null; onAnother?: () => void }) {
  const { state, pending, onSubmit } = useRecord(recordResearchAction);
  const fields = Object.keys(RESEARCH_CHOICES).filter(f => (f !== 'email' && f !== 'phone') || canSeeContacts).filter(f => f !== 'fit' || canApprove);
  const [field, setField] = useState(initialField && fields.includes(initialField) ? initialField : '');
  const [origin, setOrigin] = useState('');
  const [enumValue, setEnumValue] = useState('');
  const [link, setLink] = useState('');
  if (state.ok) return <Recorded state={state} onAnother={onAnother} anotherLabel="Record more research" />;

  const needsSource = ['decision-maker', 'commercial-source', 'friction-source'].includes(field) || ((field === 'email' || field === 'phone') && origin === 'PUBLICLY_LISTED') || (field === 'whatsapp-basis' && enumValue === 'BUSINESS_LISTED_WHATSAPP');
  const needsBasis = ((field === 'email' || field === 'phone') && origin === 'VERIFIED') || (field === 'budget' && enumValue && enumValue !== 'UNKNOWN') || (field === 'fit' && enumValue === 'REJECTED') || (field === 'whatsapp-basis' && enumValue === 'PERMISSION_GIVEN_ON_CALL');
  const enumChoices: Array<[string, string]> | null =
    field === 'budget'
      ? BUDGETS
      : field === 'frontend-team'
        ? TEAMS
        : field === 'fit'
          ? [
              ['CONFIRMED', 'Confirmed — a good fit'],
              ['REJECTED', 'Rejected — not a fit'],
            ]
          : field === 'whatsapp-basis'
            ? [
                ['BUSINESS_LISTED_WHATSAPP', 'They advertise WhatsApp on this number'],
                ['PERMISSION_GIVEN_ON_CALL', 'They agreed on a call'],
                ['NONE', 'Neither — WhatsApp is not OK'],
              ]
            : null;
  const choice = RESEARCH_CHOICES[field];

  return (
    <form onSubmit={onSubmit} className="record-form">
      <Hidden {...target} />
      <Refused state={state} />
      <div className="form-grid">
        <label>
          What did you find?
          <select
            name="field"
            required
            value={field}
            onChange={e => {
              setField(e.target.value);
              setOrigin('');
              setEnumValue('');
            }}
          >
            <option value="" disabled>
              Choose…
            </option>
            {fields.map(f => (
              <option key={f} value={f}>
                {RESEARCH_CHOICES[f].label}
              </option>
            ))}
          </select>
        </label>
        {field && !enumChoices ? (
          <label>
            {choice?.valueLabel ?? 'Value'}
            <input name="value" maxLength={1000} required={field !== 'email' && field !== 'phone' && field !== 'decision-maker' && field !== 'commercial-source' && field !== 'friction-source'} />
          </label>
        ) : null}
        {enumChoices ? (
          <label>
            {choice?.valueLabel ?? 'Choose'}
            <select name="value" required value={enumValue} onChange={e => setEnumValue(e.target.value)}>
              <option value="" disabled>
                Choose…
              </option>
              {enumChoices.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {field === 'decision-maker' ? (
          <label>
            Their role
            <input name="title" maxLength={200} placeholder="e.g. Founder, Creative Director" />
          </label>
        ) : null}
        {field === 'email' || field === 'phone' ? (
          <label>
            Where did it come from?
            <select name="status" required value={origin} onChange={e => setOrigin(e.target.value)}>
              <option value="" disabled>
                Choose…
              </option>
              {CONTACT_ORIGINS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {field === 'trigger' ? (
          <label>
            When it happened <span className="field-note">(optional)</span>
            <input type="date" name="date" />
          </label>
        ) : null}
      </div>
      {field && field !== 'timezone' ? (
        <div className="form-grid" style={{ marginTop: 'var(--s3)' }}>
          <label>
            Link to the page {needsSource ? '' : <span className="field-note">(optional)</span>}
            <input name="source" type="url" maxLength={1000} required={needsSource} placeholder="https://…" value={link} onChange={e => setLink(e.target.value)} />
          </label>
          <label>
            What kind of page
            {/* Sent only with a link: a source type without a URL would be provenance nobody can check. */}
            <select name={link.trim() ? 'sourceType' : undefined} defaultValue="official_website" disabled={!link.trim()}>
              {SOURCE_TYPES.filter(t => t !== 'human_note').map(t => (
                <option key={t} value={t}>
                  {SOURCE_LABELS[t] ?? pretty(t)}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {needsBasis || field === 'frontend-team' ? (
        <label style={{ marginTop: 'var(--s3)' }}>
          {field === 'budget' ? 'What is the budget signal?' : field === 'fit' ? 'Why is it not a fit?' : field === 'whatsapp-basis' ? 'When and how did they agree?' : field === 'frontend-team' ? 'What shows it (optional)' : 'How did you confirm it?'}
          <input name="basis" maxLength={1000} required={!!needsBasis} />
        </label>
      ) : null}
      {field ? (
        <p className="consequence">
          {choice?.needs ? `Needs ${choice.needs}. ` : ''}The company is re-checked with what you record, in the same step. A link becomes a source someone can
          open and check.
          {(field === 'email' || field === 'phone') && origin === 'UNVERIFIED' ? ' A contact with an unknown source is kept but never used for outreach.' : ''}
        </p>
      ) : null}
      <div className="form-actions">
        <Submit pending={pending}>Record research</Submit>
      </div>
    </form>
  );
}

// ── Do not contact ───────────────────────────────────────────────────────────

export function DoNotContactForm({ target, company, inQueue, onAnother }: { target: Target; company: string; inQueue: boolean; onAnother?: () => void }) {
  const { state, pending, onSubmit } = useRecord(createSuppressionAction);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  if (state.ok) return <Recorded state={state} />;
  return (
    <form onSubmit={onSubmit} className="record-form">
      <input type="hidden" name="leadId" value={target.leadId} />
      <input type="hidden" name="targetNumber" value={target.targetNumber} />
      <Refused state={state} />
      {!confirming ? (
        <>
          <label>
            Why must they not be contacted?
            <textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={500} rows={3} required placeholder="e.g. asked on a call not to be contacted again" />
          </label>
          <div className="form-actions">
            <button type="button" className="btn" disabled={!reason.trim()} onClick={() => setConfirming(true)}>
              Continue
            </button>
            {onAnother ? (
              <button type="button" className="link" onClick={onAnother}>
                Cancel
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <input type="hidden" name="reason" value={reason} />
          <input type="hidden" name="confirm" value="yes" />
          <div className="plate stop banner" style={{ margin: 0 }}>
            <span className="chip stop">Do not contact</span>
            <div className="body">
              <p>
                <strong>{company} will never be contacted again</strong> — no email, no call, no WhatsApp. Every identifier on file (their email, phone and
                website) goes on the do-not-contact list.
              </p>
              {inQueue ? (
                <p>
                  They are in the automatic email queue. Automatic email will hold for <strong>everyone</strong> until Dev removes them from the queue.
                </p>
              ) : null}
              <p className="muted small">Only an owner can undo this. Reason: “{reason.trim()}”</p>
            </div>
          </div>
          <div className="form-actions">
            <Submit pending={pending} tone="stop">
              Yes — never contact {company}
            </Submit>
            <button type="button" className="link" onClick={() => setConfirming(false)} disabled={pending}>
              Go back
            </button>
          </div>
        </>
      )}
    </form>
  );
}

// ── The panel ────────────────────────────────────────────────────────────────

type Kind = 'pipeline' | 'call' | 'research' | 'whatsapp' | 'dnc';

export interface RecordOptions {
  pipeline: boolean;
  call: boolean;
  research: boolean;
  whatsapp: boolean;
  dnc: boolean;
}

const KIND_LABEL: Record<Kind, string> = {
  pipeline: 'A reply, meeting or deal',
  call: 'A call',
  research: 'Research I found',
  whatsapp: 'WhatsApp',
  dnc: 'Do not contact',
};

/**
 * The company page's "Record what happened": a row of explicit choices, one form open at a time. Which choices exist
 * is decided on the server (from the actor's permissions and the company's state) and arrives as `options`.
 */
export function RecordPanel({
  target,
  company,
  options,
  blocked,
  inQueue,
  whatsappStatus,
  canSeeContacts,
  canApprove,
  initialField,
  initialKind,
}: {
  target: Target;
  company: string;
  options: RecordOptions;
  blocked: boolean;
  inQueue: boolean;
  whatsappStatus: string | null;
  canSeeContacts: boolean;
  canApprove: boolean;
  initialField?: string | null;
  /** Opens one form straight away, when the page was reached from a "next step" button. */
  initialKind?: string | null;
}) {
  const opening: Kind | null = initialField && options.research ? 'research' : initialKind && initialKind in KIND_LABEL && initialKind !== 'dnc' && options[initialKind as Kind] ? (initialKind as Kind) : null;
  const [kind, setKind] = useState<Kind | null>(opening);
  const [round, setRound] = useState(0);
  const available = (Object.keys(KIND_LABEL) as Kind[]).filter(k => options[k]);
  const reset = () => {
    setKind(null);
    setRound(r => r + 1);
  };
  if (!available.length) return <p className="muted small">Your role can look at this company but not record changes to it.</p>;
  return (
    <div>
      <div className="choices" role="group" aria-label="What do you want to record?">
        {available.map(k => (
          <button key={k} type="button" className={k === 'dnc' ? 'btn-quiet' : undefined} aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <div key={`${kind}-${round}`}>
        {kind === 'pipeline' ? <PipelineForm target={target} onAnother={reset} /> : null}
        {kind === 'call' ? <CallForm target={target} blocked={blocked} onAnother={reset} /> : null}
        {kind === 'research' ? <ResearchForm target={target} canSeeContacts={canSeeContacts} canApprove={canApprove} initialField={initialField} onAnother={reset} /> : null}
        {kind === 'whatsapp' ? <WhatsAppForm target={target} status={whatsappStatus} onAnother={reset} /> : null}
        {kind === 'dnc' ? <DoNotContactForm target={target} company={company} inQueue={inQueue} onAnother={reset} /> : null}
      </div>
    </div>
  );
}
