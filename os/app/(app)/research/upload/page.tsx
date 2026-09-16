import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { listBriefs } from '@/server/research/service';
import { MAX_REPORT_BYTES } from '@kachmo/core/research/report.js';
import { UploadForm } from './form';

export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  await requirePermission('research.upload');
  const briefs = await listBriefs(25);

  return (
    <>
      <p className="crumb"><Link href="/research">← Research</Link></p>
      <h1>Upload a research report</h1>
      <p className="lede">
        The report is treated as hostile input from the first byte: the filename is never used as a path, the size is
        capped at {Math.round(MAX_REPORT_BYTES / 1024 / 1024)}MB, only four formats are ever parsed, and nothing is
        executed. Parsed output goes through exactly the same validator model output would.
      </p>

      <UploadForm briefs={briefs.map(b => ({ id: b.id, promptId: b.promptId }))} />

      <h2>What the parser expects</h2>
      <div className="panel small">
        <p style={{ marginTop: 0 }}><strong>Markdown / text</strong> — one company per <code>##</code> heading, then <code>Field: value</code> lines. A URL after the value, an inline <code>(source: …)</code>, or a following <code>Source: …</code> line attaches as that field&rsquo;s evidence.</p>
        <p><strong>CSV</strong> — a header row of field names. A column named <code>&lt;field&gt;_source</code> attaches as that field&rsquo;s evidence.</p>
        <p><strong>JSON</strong> — an array of objects, or <code>{'{ "candidates": [...] }'}</code>. A <code>&lt;field&gt;_source</code> key attaches as evidence.</p>
        <p style={{ marginBottom: 0 }} className="muted">
          Unrecognised fields are dropped with a warning rather than guessed at. A candidate with any error is
          discarded whole — half a candidate is worse than none.
        </p>
      </div>

      <h2>What happens to a source URL</h2>
      <div className="panel small">
        <p style={{ marginTop: 0 }}>
          A URL in a report is recorded at <strong>URL_SHAPED</strong>: it is well-formed and <em>nobody has fetched
          it</em>. It has not been shown to exist, nor to support the claim.
        </p>
        <p style={{ marginBottom: 0 }} className="muted">
          Reaching RETRIEVED needs a fetcher; reaching SUPPORTED needs a human to confirm the page states the claim.
          An extractor can never reach SUPPORTED on its own.
        </p>
      </div>
    </>
  );
}
