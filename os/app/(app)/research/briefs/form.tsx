'use client';
import { useActionState, startTransition, type FormEvent } from 'react';
import { createBriefAction, type ActionState } from '@/server/research/actions';

const INITIAL: ActionState = { error: null };

/**
 * The brief form. Every field the contract requires is required here too; the server re-validates regardless.
 * Submitted through a transition so a refused brief keeps what was typed.
 */
export function BriefForm({ archetypes, defaults }: { archetypes: Array<{ id: string; name: string }>; defaults: { archetypeId?: string; vertical?: string; country?: string; count?: string } }) {
  const [state, dispatch, pending] = useActionState(createBriefAction, INITIAL);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  };

  return (
    <form onSubmit={onSubmit} className="panel">
      {state.error ? (
        <div className="notice">
          <p><strong>{state.error}</strong></p>
          {state.details?.map(d => <p key={d} className="small">{d}</p>)}
        </div>
      ) : null}

      <div className="grid2">
        <label>
          Type of company
          <select name="archetypeId" defaultValue={defaults.archetypeId ?? ''} required>
            <option value="" disabled>Choose…</option>
            {archetypes.map(a => <option key={a.id} value={a.id}>{a.id} — {a.name}</option>)}
          </select>
        </label>
        <label>
          Vertical <span className="muted">(optional)</span>
          <input name="vertical" defaultValue={defaults.vertical ?? ''} placeholder="e.g. Dental Clinics &amp; Chains" />
        </label>
        <label>
          Countries <span className="muted">(comma separated, e.g. United Kingdom, India)</span>
          <input name="geographies" defaultValue={defaults.country ?? ''} placeholder="United Kingdom, India" required />
        </label>
        <label>
          Decision-maker role
          <input name="decisionMakerRole" placeholder="Founder or Creative Director" required />
        </label>
        <label>
          Must be reachable by
          <select name="requiredContactability" defaultValue="EITHER">
            <option value="EITHER">Either email or phone</option>
            <option value="EMAIL">Email</option>
            <option value="PHONE">Phone</option>
          </select>
        </label>
        <label>
          Research depth
          <select name="depth" defaultValue="STANDARD">
            <option value="SHALLOW">Shallow</option>
            <option value="STANDARD">Standard</option>
            <option value="DEEP">Deep</option>
          </select>
        </label>
        <label>
          How many companies <span className="muted">(max 50 — a large number invites padding)</span>
          <input name="targetCount" type="number" min={1} max={50} defaultValue={defaults.count ?? '10'} required />
        </label>
      </div>

      <label style={{ marginTop: 10 }}>
        Friction to look for <span className="muted">(state it, or the researcher will invent one)</span>
        <input name="knownFriction" placeholder="portfolio sites that break on mobile" required />
      </label>
      <label style={{ marginTop: 10 }}>
        Notes <span className="muted">(optional)</span>
        <input name="notes" placeholder="anything else the researcher should know" />
      </label>

      <div className="row" style={{ marginTop: 14 }}>
        <button type="submit" className="btn-act" disabled={pending}>{pending ? 'Writing…' : 'Write the brief'}</button>
        <span className="small muted">The brief is versioned and pinned, so a returned report can be judged against what was asked.</span>
      </div>
    </form>
  );
}
