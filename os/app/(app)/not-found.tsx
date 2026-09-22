import Link from 'next/link';

/** A company, suggestion or page that does not exist — including a malformed link (audit C6). */
export default function NotFound() {
  return (
    <div className="plate" style={{ maxWidth: 640 }}>
      <span className="label">Not found</span>
      <p style={{ fontSize: 17, margin: 'var(--s2) 0' }}>
        <strong>That isn’t here.</strong>
      </p>
      <p className="muted">The link may be old, or the company or suggestion may have a different number. Nothing was changed.</p>
      <div className="form-actions">
        <Link className="btn-act btn" href="/leads">
          Find a company
        </Link>
        <Link className="btn" href="/">
          Go to Today
        </Link>
      </div>
    </div>
  );
}
