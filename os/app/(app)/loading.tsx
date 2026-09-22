/** Shown the moment a link is followed, so a slow database never looks like a dead click. */
export default function Loading() {
  return (
    <div className="skeleton" aria-busy="true" aria-live="polite">
      <span className="sr">Loading…</span>
      <span className="title" />
      <span />
      <span className="short" />
      <span />
      <span className="short" />
    </div>
  );
}
