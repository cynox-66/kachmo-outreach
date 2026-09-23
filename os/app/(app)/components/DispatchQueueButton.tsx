'use client';

import { useState, useActionState, startTransition, type FormEvent } from 'react';
import { dispatchQueueAction, type DispatchActionState } from '@/server/services/dispatch-action';

interface TargetPreview {
  targetNumber: string;
  company: string;
  city: string | null;
  country: string | null;
}

interface DispatchQueueButtonProps {
  queuedCount: number;
  targets: TargetPreview[];
  configured: boolean;
  repo: string;
  workflow: string;
  canDispatch: boolean;
}

const INITIAL_STATE: DispatchActionState = { error: null };

export function DispatchQueueButton({
  queuedCount,
  targets,
  configured,
  repo,
  workflow,
  canDispatch,
}: DispatchQueueButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [force, setForce] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [state, dispatch, pending] = useActionState(dispatchQueueAction, INITIAL_STATE);

  if (!canDispatch) return null;

  const githubWorkflowUrl = `https://github.com/${repo}/actions/workflows/${workflow}`;

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || !confirmed) return;
    const data = new FormData();
    data.set('force', force ? 'true' : 'false');
    startTransition(() => dispatch(data));
  };

  const handleClose = () => {
    if (pending) return;
    setIsOpen(false);
    setConfirmed(false);
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-act"
        onClick={() => setIsOpen(true)}
        disabled={queuedCount === 0}
        title={queuedCount === 0 ? 'Queue is empty' : 'Trigger autonomous cloud dispatch via GitHub Actions'}
      >
        <span>⚡ Trigger Dispatch ({queuedCount})</span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dispatch-dialog-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(11, 10, 9, 0.78)',
            backdropFilter: 'blur(4px)',
            display: 'grid',
            placeItems: 'center',
            padding: 'var(--s4)',
            zIndex: 1000,
          }}
          onClick={e => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <div
            className="plate"
            style={{
              maxWidth: '560px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              borderRadius: 'var(--r)',
              border: '1px solid var(--hair-strong)',
              boxShadow: '0 20px 45px rgba(0,0,0,0.6)',
              padding: 'var(--s5)',
            }}
          >
            <div className="row between" style={{ marginBottom: 'var(--s3)' }}>
              <div>
                <span className="label">Cloud Dispatch &middot; Titan SMTP</span>
                <h3 id="dispatch-dialog-title" style={{ margin: 0, fontSize: '18px' }}>
                  Trigger Outreach Dispatch
                </h3>
              </div>
              <button
                type="button"
                className="link"
                onClick={handleClose}
                disabled={pending}
                style={{ fontSize: '20px', lineHeight: 1, padding: '4px 8px' }}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            {/* Prominent Safety Warning / Disclaimer */}
            <div
              className="plate"
              style={{
                borderLeft: '4px solid var(--type)',
                backgroundColor: 'var(--plate-lift)',
                padding: 'var(--s3) var(--s4)',
                marginBottom: 'var(--s4)',
              }}
            >
              <div className="row" style={{ gap: 'var(--s2)', marginBottom: 'var(--s1)' }}>
                <span className="chip act" style={{ fontSize: '10px' }}>
                  AUTOMATIC BY DEFAULT
                </span>
                <strong style={{ fontSize: '13px' }}>Emails are already scheduled.</strong>
              </div>
              <p className="small" style={{ margin: 0, color: 'var(--type)' }}>
                Even without clicking this button, queued emails will be dispatched automatically by the scheduled
                cloud runner once each recipient’s local business morning window (07:30&ndash;11:30 AM local time)
                opens.
              </p>
              <p className="small muted" style={{ margin: 'var(--s2) 0 0' }}>
                Use this manual trigger only if you want to run the cloud dispatch runner immediately right now (e.g. to
                resolve a held queue or force a batch).
              </p>
            </div>

            {/* Queue Target Breakdown */}
            <div style={{ marginBottom: 'var(--s4)' }}>
              <span className="label">Recipients in Queue ({targets.length})</span>
              <ul
                className="rows"
                style={{
                  maxHeight: '140px',
                  overflowY: 'auto',
                  border: '1px solid var(--hair)',
                  borderRadius: 'var(--r)',
                  listStyle: 'none',
                  padding: 0,
                  margin: 'var(--s1) 0 0',
                }}
              >
                {targets.map(t => (
                  <li key={t.targetNumber} style={{ padding: 'var(--s2) var(--s3)', fontSize: '13px' }}>
                    <span className="mono bold">#{t.targetNumber}</span> {t.company}{' '}
                    <span className="muted">&middot; {[t.city, t.country].filter(Boolean).join(', ')}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Token Configuration Warning if missing */}
            {!configured && (
              <div
                className="plate"
                style={{
                  borderLeft: '4px solid var(--stop)',
                  padding: 'var(--s3) var(--s4)',
                  marginBottom: 'var(--s4)',
                }}
              >
                <div className="row" style={{ gap: 'var(--s2)', marginBottom: 'var(--s1)' }}>
                  <span className="chip stop" style={{ fontSize: '10px' }}>
                    SETUP REQUIRED
                  </span>
                  <strong style={{ fontSize: '13px' }}>GitHub Token Not Configured</strong>
                </div>
                <p className="small" style={{ margin: 0 }}>
                  <code>GITHUB_DISPATCH_TOKEN</code> is not set in Vercel. To trigger dispatch directly from this UI, add
                  a GitHub Personal Access Token (with Actions write scope) in Vercel settings.
                </p>
                <p className="small" style={{ margin: 'var(--s2) 0 0' }}>
                  In the meantime, you can trigger this dispatch directly in GitHub Actions with 1 click:
                  <br />
                  <a href={githubWorkflowUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
                    Open GitHub Actions &rarr; Run workflow
                  </a>
                </p>
              </div>
            )}

            {/* Server feedback */}
            {state.ok && (
              <div
                className="plate"
                style={{
                  borderLeft: '4px solid var(--act)',
                  padding: 'var(--s3) var(--s4)',
                  marginBottom: 'var(--s4)',
                }}
              >
                <p style={{ margin: 0, fontWeight: 600 }}>✓ {state.ok}</p>
                {state.runUrl && (
                  <p className="small" style={{ margin: 'var(--s1) 0 0' }}>
                    <a href={state.runUrl} target="_blank" rel="noreferrer">
                      View running workflow in GitHub Actions &rarr;
                    </a>
                  </p>
                )}
              </div>
            )}

            {state.error && (
              <div
                className="plate"
                style={{
                  borderLeft: '4px solid var(--stop)',
                  padding: 'var(--s3) var(--s4)',
                  marginBottom: 'var(--s4)',
                }}
              >
                <p style={{ margin: 0, color: 'var(--stop)', fontWeight: 600 }}>Error: {state.error}</p>
                {state.runUrl && (
                  <p className="small" style={{ margin: 'var(--s1) 0 0' }}>
                    <a href={state.runUrl} target="_blank" rel="noreferrer">
                      Run workflow manually on GitHub &rarr;
                    </a>
                  </p>
                )}
              </div>
            )}

            {/* Dispatch Mode Form */}
            {configured && !state.ok && (
              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 'var(--s4)' }}>
                  <span className="label">Dispatch Mode</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)', marginTop: 'var(--s1)' }}>
                    <label style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-start', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="mode"
                        checked={!force}
                        onChange={() => setForce(false)}
                        disabled={pending}
                      />
                      <div className="small">
                        <strong>Standard Morning Window (Recommended)</strong>
                        <div className="muted">
                          Only sends to recipients currently inside 07:30&ndash;11:30 AM local time.
                        </div>
                      </div>
                    </label>

                    <label style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-start', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="mode"
                        checked={force}
                        onChange={() => setForce(true)}
                        disabled={pending}
                      />
                      <div className="small">
                        <strong>Force Send Override</strong>
                        <div className="muted">
                          Bypasses the local morning window and dispatches all unsuppressed queued emails immediately.
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                <div
                  style={{
                    marginBottom: 'var(--s4)',
                    padding: 'var(--s2) var(--s3)',
                    background: 'var(--plate-lift)',
                    borderRadius: 'var(--r)',
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      gap: 'var(--s2)',
                      alignItems: 'center',
                      cursor: 'pointer',
                      fontSize: '13px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={e => setConfirmed(e.target.checked)}
                      disabled={pending}
                    />
                    <span>
                      I authorize triggering the cloud runner to dispatch outreach to these {targets.length} companies.
                    </span>
                  </label>
                </div>

                <div className="row end" style={{ gap: 'var(--s2)' }}>
                  <button type="button" className="btn ghost" onClick={handleClose} disabled={pending}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-act" disabled={!confirmed || pending}>
                    {pending ? 'Triggering...' : force ? 'Force Dispatch Now' : 'Run Cloud Dispatch'}
                  </button>
                </div>
              </form>
            )}

            {/* If already triggered or not configured */}
            {(!configured || state.ok) && (
              <div className="row end" style={{ marginTop: 'var(--s4)' }}>
                <button type="button" className="btn" onClick={handleClose}>
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
