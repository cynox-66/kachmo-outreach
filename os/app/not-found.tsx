import Link from 'next/link';

/** Any unknown address. Carries no data and needs no session. */
export default function NotFound() {
  return (
    <main className="login">
      <div className="login-card">
        <p className="wordmark">KACHMO</p>
        <p style={{ margin: 'var(--s4) 0 var(--s2)' }}>
          <strong>That page doesn’t exist.</strong>
        </p>
        <p className="muted">Nothing was changed.</p>
        <div className="form-actions">
          <Link className="btn btn-act" href="/">
            Go to Today
          </Link>
        </div>
      </div>
    </main>
  );
}
