'use client';
import { useActionState, useState, startTransition, type FormEvent } from 'react';
import { reviewCandidateAction, type ActionState } from '@/server/research/actions';

const INITIAL: ActionState = { error: null };

/** Each decision, and what it does — stated before the button (audit C1). There is no default decision. */
const DECISIONS: Array<{ value: string; label: string; consequence: string }> = [
  { value: 'ACCEPT', label: 'Add to the company list', consequence: 'Creates a new company in the list. The do-not-contact list is checked again first. It will still need research before anyone contacts it.' },
  { value: 'MERGE', label: 'It’s a company we already have', consequence: 'Attaches this research to the existing company as sources to check. Nothing on that company changes by itself.' },
  { value: 'REJECT', label: 'Not a fit — don’t add it', consequence: 'Closes the suggestion. The research is kept.' },
  { value: 'SEND_BACK', label: 'Needs more research', consequence: 'Marks it as needing more research before a decision.' },
  { value: 'DEFER', label: 'Decide later', consequence: 'Leaves it waiting; it stays on Today.' },
  { value: 'FLAG_CONTRADICTION', label: 'The sources disagree', consequence: 'Flags it so the contradiction is resolved first.' },
];

export function ReviewForm({ candidateId, company, canApprove, canAdd, duplicates }: { candidateId: string; company: string; canApprove: boolean; canAdd: boolean; duplicates: Array<{ leadId: string; targetNumber: string }> }) {
  const [state, dispatch, pending] = useActionState(reviewCandidateAction, INITIAL);
  const [decision, setDecision] = useState('');

  if (!canApprove) {
    return <div className="plate small muted">Your role can see suggested companies but not decide on them. An owner or admin decides.</div>;
  }
  if (state.ok) {
    return (
      <div className="plate lift" role="status">
        <span className="label">Recorded</span>
        <p style={{ margin: 0 }}>{state.ok}</p>
      </div>
    );
  }

  const options = DECISIONS.filter(d => (d.value !== 'ACCEPT' || canAdd) && (d.value !== 'MERGE' || duplicates.length));
  const choice = DECISIONS.find(d => d.value === decision);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  };

  return (
    <form onSubmit={onSubmit} className="plate">
      <input type="hidden" name="candidateId" value={candidateId} />
      {state.error ? (
        <div className="notice" role="alert">
          <p>
            <strong>Not recorded.</strong> {state.error}
          </p>
        </div>
      ) : null}
      <div className="form-grid">
        <label>
          Your decision
          <select name="decision" required value={decision} onChange={e => setDecision(e.target.value)}>
            <option value="" disabled>
              Choose…
            </option>
            {options.map(d => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        {decision === 'MERGE' ? (
          <label>
            Which company is it?
            <select name="mergeIntoLeadId" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {duplicates.map(d => (
                <option key={d.leadId} value={d.leadId}>
                  Company #{d.targetNumber}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <label style={{ marginTop: 'var(--s3)' }}>
        Note <span className="field-note">(recorded with your name)</span>
        <input name="note" maxLength={2000} placeholder="Why you decided this" />
      </label>
      {choice ? <p className="consequence">{choice.consequence}</p> : null}
      {decision === 'ACCEPT' ? (
        <label className="inline small" style={{ marginTop: 'var(--s3)' }}>
          <input type="checkbox" name="confirm" value="yes" required /> Add {company} to the company list
        </label>
      ) : null}
      <div className="form-actions">
        <button type="submit" className="btn-act" disabled={pending || !decision}>
          {pending ? 'Recording…' : 'Record decision'}
        </button>
        <span className="field-note">Nothing is added without a person deciding.</span>
      </div>
    </form>
  );
}
