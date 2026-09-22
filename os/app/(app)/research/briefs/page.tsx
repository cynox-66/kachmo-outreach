import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { isUuid } from '@/server/auth/action-guard';
import { getBrief, listBriefs } from '@/server/research/service';
import { ARCHETYPES_V1 } from '@kachmo/core/config/taxonomy.js';
import { BriefForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Research brief' };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function BriefsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePermission('research.create');
  const search = await searchParams;
  const openId = one(search.open) ?? one(search.created);
  // An id that is not a UUID is simply not a brief — it never reaches the database as a query error (audit C6).
  const opened = openId && isUuid(openId) ? await getBrief(openId) : null;
  const briefs = await listBriefs(25);

  return (
    <>
      <Link className="crumb" href="/research">← Research</Link>
      <h1>Research brief</h1>
      <p className="lede">
        A brief tells an external researcher <strong>exactly what evidence is required</strong>, not merely what kind
        of company is wanted. It forbids unopened URLs and guessed email patterns, and it requires absence to be
        reported as absence.
      </p>

      {opened ? (
        <>
          <div className="row between">
            <h2 style={{ margin: 0 }}>{opened.promptId}</h2>
            <span className="small muted">contract {opened.contractVersion} · taxonomy {opened.taxonomyVersion}</span>
          </div>
          <p className="small muted">
            Copy this into Gemini Deep Research, Claude Code, or whichever approved tool you are using. Then drop the
            result into <Link href="/research/upload">Upload a report</Link>.
          </p>
          <pre className="draft" style={{ maxHeight: 620 }}>{opened.renderedBrief}</pre>
        </>
      ) : (
        <BriefForm
          archetypes={ARCHETYPES_V1.map(a => ({ id: a.id, name: a.name }))}
          defaults={{ archetypeId: one(search.archetype), vertical: one(search.vertical), country: one(search.country), count: one(search.count) }}
        />
      )}

      <h2>Previous briefs</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Brief</th><th>Archetype</th><th>Geography</th><th className="num">Wanted</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {briefs.map(b => (
              <tr key={b.id}>
                <td className="small"><code>{b.promptId}</code></td>
                <td className="small">{b.archetypeId}{b.vertical ? ` · ${b.vertical}` : ''}</td>
                <td className="small">{(b.geographies as string[]).join(', ')}</td>
                <td className="num">{b.targetCount}</td>
                <td className="small">{b.createdAt.toISOString().slice(0, 10)} · {b.createdByLabel}</td>
                <td><Link className="btn btn-sm" href={`/research/briefs?open=${b.id}`}>Open</Link></td>
              </tr>
            ))}
            {briefs.length === 0 ? <tr><td colSpan={6} className="empty">No brief yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
