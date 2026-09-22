'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';

/**
 * What an operator sees when a page cannot load (audit C5): a database that did not answer, a page their role cannot
 * open, or a bug. It says what matters — nothing was changed — and offers the two useful next steps. The reference
 * code lets the owner find the full error in the server logs; nothing else about the failure is shown.
 *
 * `reset()` on its own is not a retry: it re-renders this boundary against the *cached* failed server payload. Verified
 * in the browser — with the database stopped, restarted and healthy again, a plain `reset()` left the error on screen.
 * The server render has to be refetched first, so the retry is `router.refresh()` and `reset()` in one transition.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  useEffect(() => {
    console.error('[kachmo] page error', error.digest ?? '');
  }, [error]);

  return (
    <div className="plate banner stop" role="alert" style={{ maxWidth: 640 }}>
      <span className="chip stop">Couldn’t load</span>
      <div className="body">
        <p>
          <strong>This page couldn’t load. Nothing was changed.</strong>
        </p>
        <p className="muted small">
          It may be a page your role can’t open, or the database didn’t answer in time. Try again in a moment; if it keeps
          happening, tell Dev{error.digest ? ` and quote reference ${error.digest}` : ''}.
        </p>
        <div className="form-actions">
          <button
            type="button"
            className="btn-act"
            disabled={retrying}
            onClick={() =>
              startRetry(() => {
                router.refresh();
                reset();
              })
            }
          >
            {retrying ? 'Trying…' : 'Try again'}
          </button>
          <Link className="btn" href="/">
            Go to Today
          </Link>
        </div>
      </div>
    </div>
  );
}
