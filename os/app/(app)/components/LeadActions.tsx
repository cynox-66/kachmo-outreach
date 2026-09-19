'use client';
import { useActionState } from 'react';
import {
  logCallAction,
  whatsappTransitionAction,
  pipelineTransitionAction,
  recordResearchAction,
  createSuppressionAction,
  type LeadActionState,
} from '@/server/leads/actions';
import { CALL_OUTCOMES, OBJECTION_CATEGORIES, LOST_REASONS } from '@kachmo/core/leads/schema.js';
import { PIPELINE_CHANNELS, PIPELINE_STAGES } from '@kachmo/core/state/pipeline.js';
import { SOURCE_TYPES } from '@kachmo/core/research/evidence.js';

/**
 * Operator forms for recording what a person did (Phase B, CAP-3). Every rule lives on the server: these forms only
 * collect input and show the server's answer. Each carries the lead's version, so a form opened before someone else
 * changed the lead is refused rather than written over their change.
 */

const INITIAL: LeadActionState = { error: null };

// Enumerations come from core, so a form can never offer a value the engine would refuse.
const OBJECTIONS = ['', ...OBJECTION_CATEGORIES];
const WHATSAPP = [
  { value: 'APPROVED', label: 'Approve the draft' },
  { value: 'REJECTED', label: 'Reject the draft' },
  { value: 'SENT', label: 'I sent it (from my phone)' },
  { value: 'REPLIED', label: 'They replied' },
  { value: 'OPT_OUT', label: 'They asked not to be contacted' },
];
// FOLLOW_UP_SENT is an email follow-up: Titan records it, so it is not offered here (ADR-019).
const STAGES = PIPELINE_STAGES.filter(s => s !== 'FOLLOW_UP_SENT');
const CHANNELS = ['', ...PIPELINE_CHANNELS];
const LOST = ['', ...LOST_REASONS];
const RESEARCH_FIELDS = [
  { value: 'decision-maker', label: 'Decision maker (name, title, source)' },
  { value: 'email', label: 'Email and its provenance' },
  { value: 'phone', label: 'Phone and its provenance' },
  { value: 'commercial-source', label: 'Commercial signal + source' },
  { value: 'friction-source', label: 'Digital friction + source' },
  { value: 'trigger', label: 'Buying trigger' },
  { value: 'budget', label: 'Budget probability' },
  { value: 'tech', label: 'Technology / CMS' },
  { value: 'frontend-team', label: 'Frontend team (agencies)' },
  { value: 'whatsapp-basis', label: 'WhatsApp basis' },
  { value: 'timezone', label: 'Timezone' },
  { value: 'fit', label: 'Kachmo fit (approvers only)' },
];

const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

function Result({ state }: { state: LeadActionState }) {
  if (state.error) return <div className="notice"><p><strong>Not recorded:</strong> {state.error}</p></div>;
  if (state.ok) {
    return (
      <div className="notice">
        <p><strong>{state.ok}</strong></p>
        {state.warnings?.length ? <p className="small muted">{state.warnings.join(' · ')}</p> : null}
      </div>
    );
  }
  return null;
}

function Hidden({ leadId, version }: { leadId: string; version: number }) {
  return (
    <>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="expectedVersion" value={version} />
    </>
  );
}

/** Shown instead of a form when this person cannot record changes right now — with the reason, not a dead button. */
export function WritesUnavailable({ reason }: { reason: string }) {
  return <p className="small muted" style={{ margin: 0 }}>Recording is unavailable: {reason}</p>;
}

export function CallLogForm({ leadId, version }: { leadId: string; version: number }) {
  const [state, action, pending] = useActionState(logCallAction, INITIAL);
  return (
    <form action={action}>
      <Hidden leadId={leadId} version={version} />
      <Result state={state} />
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label>
          Outcome
          <select name="outcome" defaultValue="NO_ANSWER" required>
            {CALL_OUTCOMES.map(o => <option key={o} value={o}>{label(o)}</option>)}
          </select>
        </label>
        <label>
          Objection
          <select name="objectionCategory" defaultValue="">
            {OBJECTIONS.map(o => <option key={o} value={o}>{o ? label(o) : '—'}</option>)}
          </select>
        </label>
        <label>
          Call back on
          <input type="date" name="callbackDate" />
        </label>
      </div>
      <label style={{ marginTop: 8 }}>
        Notes
        <input name="notes" maxLength={2000} placeholder="what was said" />
      </label>
      <div className="row" style={{ gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
        <label className="small"><input type="checkbox" name="confirmedIdentity" /> I spoke to the named decision maker</label>
        <label className="small"><input type="checkbox" name="whatsappOk" /> They agreed to WhatsApp follow-up</label>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button type="submit" disabled={pending}>{pending ? 'Recording…' : 'Log call'}</button>
        <span className="small muted">&ldquo;Do not contact&rdquo; suppresses this person on every channel.</span>
      </div>
    </form>
  );
}

export function WhatsAppForm({ leadId, version, status }: { leadId: string; version: number; status: string | null }) {
  const [state, action, pending] = useActionState(whatsappTransitionAction, INITIAL);
  const next = status === 'APPROVED' ? 'SENT' : status === 'SENT' ? 'REPLIED' : 'APPROVED';
  return (
    <form action={action}>
      <Hidden leadId={leadId} version={version} />
      <Result state={state} />
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label>
          Record
          <select name="status" defaultValue={next}>
            {WHATSAPP.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
        </label>
        <label style={{ flex: 1, minWidth: 200 }}>
          Notes
          <input name="notes" maxLength={2000} />
        </label>
        <button type="submit" disabled={pending}>{pending ? 'Recording…' : 'Record'}</button>
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>This records what a person did. Nothing is ever sent from here.</p>
    </form>
  );
}

export function PipelineForm({ leadId, version }: { leadId: string; version: number }) {
  const [state, action, pending] = useActionState(pipelineTransitionAction, INITIAL);
  return (
    <form action={action}>
      <Hidden leadId={leadId} version={version} />
      <Result state={state} />
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label>
          Stage
          <select name="stage" defaultValue="REPLIED_POSITIVE">
            {STAGES.map(s => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </label>
        <label>
          Channel
          <select name="channel" defaultValue="">
            {CHANNELS.map(c => <option key={c} value={c}>{c ? label(c) : '—'}</option>)}
          </select>
        </label>
        <label>
          Date
          <input type="date" name="date" />
        </label>
        <label>
          Value
          <input name="value" maxLength={40} placeholder="$6,000" style={{ width: 110 }} />
        </label>
        <label>
          Lost reason
          <select name="reason" defaultValue="">
            {LOST.map(r => <option key={r} value={r}>{r ? label(r) : '—'}</option>)}
          </select>
        </label>
      </div>
      <label style={{ marginTop: 8 }}>
        Notes
        <input name="notes" maxLength={2000} />
      </label>
      <div className="row" style={{ marginTop: 10 }}>
        <button type="submit" disabled={pending}>{pending ? 'Recording…' : 'Record stage'}</button>
        <span className="small muted">Email follow-ups are recorded by Titan, not here.</span>
      </div>
    </form>
  );
}

export function ResearchRecordForm({ leadId, version, canSeeContacts, canApprove }: { leadId: string; version: number; canSeeContacts: boolean; canApprove: boolean }) {
  const [state, action, pending] = useActionState(recordResearchAction, INITIAL);
  const fields = RESEARCH_FIELDS.filter(f => (f.value !== 'email' && f.value !== 'phone') || canSeeContacts).filter(f => f.value !== 'fit' || canApprove);
  return (
    <form action={action}>
      <Hidden leadId={leadId} version={version} />
      <Result state={state} />
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label>
          What you found
          <select name="field" defaultValue="decision-maker">
            {fields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
        <label style={{ flex: 1, minWidth: 220 }}>
          Value
          <input name="value" maxLength={1000} placeholder="the fact itself" />
        </label>
        <label>
          Title
          <input name="title" maxLength={200} placeholder="for a decision maker" style={{ width: 150 }} />
        </label>
      </div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
        <label style={{ flex: 1, minWidth: 260 }}>
          Source URL
          <input name="source" type="url" maxLength={1000} placeholder="https://… the page that shows it" />
        </label>
        <label>
          Source type
          <select name="sourceType" defaultValue="official_website">
            {SOURCE_TYPES.filter(t => t !== 'human_note').map(t => <option key={t} value={t}>{label(t)}</option>)}
          </select>
        </label>
        <label>
          Provenance
          <select name="status" defaultValue="">
            <option value="">—</option>
            {['PUBLICLY_LISTED', 'VERIFIED', 'UNVERIFIED', 'INVALID'].map(s => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </label>
      </div>
      <label style={{ marginTop: 8 }}>
        Basis <span className="muted">(how you verified it, or why — required for VERIFIED, budget and a fit decision)</span>
        <input name="basis" maxLength={1000} />
      </label>
      <div className="row" style={{ marginTop: 10 }}>
        <button type="submit" disabled={pending}>{pending ? 'Recording…' : 'Record research'}</button>
        <span className="small muted">The engine re-qualifies and re-scores the lead as part of the same change. A cited URL becomes evidence to fetch and check.</span>
      </div>
    </form>
  );
}

export function SuppressionForm({ leadId }: { leadId: string | null }) {
  const [state, action, pending] = useActionState(createSuppressionAction, INITIAL);
  return (
    <form action={action}>
      {leadId ? <input type="hidden" name="leadId" value={leadId} /> : null}
      <Result state={state} />
      {!leadId ? (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label>Email <input name="email" type="email" maxLength={254} /></label>
          <label>Phone <input name="phone" maxLength={40} /></label>
          <label>Domain <input name="domain" maxLength={253} placeholder="company.com" /></label>
        </div>
      ) : null}
      <label style={{ marginTop: 8 }}>
        Reason <span className="muted">(required)</span>
        <input name="reason" maxLength={500} required placeholder="e.g. asked on a call not to be contacted again" />
      </label>
      <div className="row" style={{ marginTop: 10 }}>
        <button type="submit" className="danger" disabled={pending}>{pending ? 'Recording…' : leadId ? 'Do not contact this lead' : 'Record suppression'}</button>
        <span className="small muted">Every identifier on the lead is suppressed on every channel. It reaches the email pipeline on the next verified publish; dispatch refuses anything unpublished.</span>
      </div>
    </form>
  );
}
