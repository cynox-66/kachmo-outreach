'use client';
import { useActionState, useState, startTransition, type FormEvent } from 'react';
import { reviewEvidenceAction, type EvidenceActionState } from '@/server/evidence/actions';

/**
 * A reviewer's judgement on one retrieved source (Phase B, CAP-7). The server checks the quote is verbatim from the
 * stored page; this form only collects it. A review never changes the company. Submitted through a transition so a
 * refusal ("that quote is not on the page") keeps the quote the reviewer typed.
 */

const INITIAL: EvidenceActionState = { error: null };

const VERDICTS: Array<[string, string]> = [
  ['SUPPORTS', 'says it — the claim is right'],
  ['NOT_SUPPORTED', 'doesn’t say it'],
  ['CONTRADICTS', 'says something different — the claim is wrong'],
];

export function EvidenceReviewForm({ evidenceId, targetNumber }: { evidenceId: string; targetNumber: string }) {
  const [state, dispatch, pending] = useActionState(reviewEvidenceAction, INITIAL);
  const [verdict, setVerdict] = useState('');
  if (state.ok) return <p className="small" role="status"><strong>Recorded.</strong> {state.ok}</p>;
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  };
  return (
    <form onSubmit={onSubmit} style={{ marginTop: 'var(--s2)' }}>
      <input type="hidden" name="evidenceId" value={evidenceId} />
      <input type="hidden" name="targetNumber" value={targetNumber} />
      {state.error ? (
        <div className="notice" role="alert">
          <p>
            <strong>Not recorded.</strong> {state.error}
          </p>
        </div>
      ) : null}
      <div className="form-grid">
        <label>
          The page…
          <select name="verdict" required value={verdict} onChange={e => setVerdict(e.target.value)}>
            <option value="" disabled>
              Choose…
            </option>
            {VERDICTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quote from the page <span className="field-note">(copied exactly)</span>
          <input name="excerpt" maxLength={2000} required={verdict !== 'NOT_SUPPORTED'} />
        </label>
        <label>
          Note <span className="field-note">{verdict === 'NOT_SUPPORTED' ? '(required)' : '(optional)'}</span>
          <input name="note" maxLength={1000} required={verdict === 'NOT_SUPPORTED'} />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn-sm" disabled={pending}>
          {pending ? 'Recording…' : 'Record the check'}
        </button>
        <span className="field-note">A check never changes the company’s record.</span>
      </div>
    </form>
  );
}
