'use client';
import { useActionState } from 'react';
import { reviewCandidateAction, type ActionState } from '@/server/research/actions';

const INITIAL: ActionState = { error: null };

const DECISIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'ACCEPT', label: 'Approve', hint: 'Becomes a canonical lead. Suppression is re-checked first.' },
  { value: 'REJECT', label: 'Reject', hint: 'Not a fit. The report is kept as evidence.' },
  { value: 'MERGE', label: 'Merge', hint: 'Same company as an existing lead.' },
  { value: 'SEND_BACK', label: 'Request more research', hint: 'Something required is missing.' },
  { value: 'DEFER', label: 'Defer', hint: 'Decide later.' },
  { value: 'FLAG_CONTRADICTION', label: 'Flag contradiction', hint: 'The source disagrees with the claim.' },
];

export function ReviewForm({ candidateId, canApprove, duplicates }: { candidateId: string; canApprove: boolean; duplicates: Array<{ leadId: string; targetNumber: string }> }) {
  const [state, action, pending] = useActionState(reviewCandidateAction, INITIAL);

  if (!canApprove) {
    return (
      <div className="panel small muted">
        Your role can view candidates but not approve them. Approval needs <code>research.approve</code>.
      </div>
    );
  }

  return (
    <form action={action} className="panel">
      <input type="hidden" name="candidateId" value={candidateId} />
      {state.error ? <div className="notice"><p><strong>{state.error}</strong></p></div> : null}
      {state.ok ? <div className="notice"><p><strong>{state.ok}</strong></p></div> : null}

      <label>
        Decision
        <select name="decision" defaultValue="ACCEPT">
          {DECISIONS.map(d => <option key={d.value} value={d.value}>{d.label} — {d.hint}</option>)}
        </select>
      </label>

      {duplicates.length ? (
        <label style={{ marginTop: 10 }}>
          If merging, into which lead?
          <select name="mergeIntoLeadId" defaultValue="">
            <option value="">—</option>
            {duplicates.map(d => <option key={d.leadId} value={d.leadId}>{d.targetNumber}</option>)}
          </select>
        </label>
      ) : null}

      <label style={{ marginTop: 10 }}>
        Note <span className="muted">(recorded with your name in the audit log)</span>
        <input name="note" placeholder="why you decided this" />
      </label>

      <div className="row" style={{ marginTop: 14 }}>
        <button type="submit" disabled={pending}>{pending ? 'Recording…' : 'Record decision'}</button>
        <span className="small muted">Approval is an explicit human act. Nothing imports automatically.</span>
      </div>
    </form>
  );
}
