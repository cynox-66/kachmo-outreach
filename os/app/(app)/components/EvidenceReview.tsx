'use client';
import { useActionState } from 'react';
import { reviewEvidenceAction, type EvidenceActionState } from '@/server/evidence/actions';

/**
 * A reviewer's judgement on one retrieved source (Phase B, CAP-7). The server checks the quote is verbatim from the
 * stored page; this form only collects it. A review never changes the lead.
 */

const INITIAL: EvidenceActionState = { error: null };

export function EvidenceReviewForm({ evidenceId, leadId }: { evidenceId: string; leadId: string }) {
  const [state, action, pending] = useActionState(reviewEvidenceAction, INITIAL);
  if (state.ok) return <p className="small"><strong>{state.ok}</strong></p>;
  return (
    <form action={action} style={{ marginTop: 6 }}>
      <input type="hidden" name="evidenceId" value={evidenceId} />
      <input type="hidden" name="leadId" value={leadId} />
      {state.error ? <div className="notice"><p><strong>Not recorded:</strong> {state.error}</p></div> : null}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label>
          The page…
          <select name="verdict" defaultValue="SUPPORTS">
            <option value="SUPPORTS">supports the claim</option>
            <option value="NOT_SUPPORTED">does not state it</option>
            <option value="CONTRADICTS">contradicts it</option>
          </select>
        </label>
        <label style={{ flex: 1, minWidth: 240 }}>
          Quote from the page <span className="muted">(copied exactly)</span>
          <input name="excerpt" maxLength={2000} />
        </label>
        <label style={{ minWidth: 180 }}>
          Note
          <input name="note" maxLength={1000} placeholder="required if it does not state it" />
        </label>
        <button type="submit" className="ghost" disabled={pending}>{pending ? 'Recording…' : 'Record review'}</button>
      </div>
    </form>
  );
}
