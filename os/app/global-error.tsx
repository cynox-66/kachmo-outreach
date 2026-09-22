'use client';

/**
 * The last line of defence: an error in the root layout itself. It must render its own <html>, and it cannot rely on
 * the stylesheet having loaded, so it carries the minimum inline.
 *
 * The retry reloads the document rather than calling `reset()`. What failed here is the layout — including the session
 * lookup — so there is no healthy tree left to re-render into, and `reset()` would only replay the cached failure
 * (verified in the browser: with the database restored, `reset()` left this screen up). A reload re-runs everything.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0B0A09', color: '#EDE9E0', font: '15px/1.55 system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 20 }}>
        <div style={{ maxWidth: 520 }}>
          <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.7 }}>Kachmo Outbound</p>
          <p>
            <strong>The app couldn’t load. Nothing was changed.</strong>
          </p>
          <p style={{ opacity: 0.8 }}>Try again in a moment. If it keeps happening, tell Dev{error.digest ? ` (reference ${error.digest})` : ''}.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ font: '600 12px ui-monospace, monospace', letterSpacing: '0.09em', textTransform: 'uppercase', background: '#E3F32B', color: '#0B0A09', border: 0, borderRadius: 3, padding: '10px 18px', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
