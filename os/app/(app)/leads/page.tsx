import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { listLeads, LEAD_SORTS, type LeadFilters, type LeadSort } from '@/server/services/leads';

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v) || undefined;

/** Preserves the current filters while changing one of them — so paging never silently drops a filter. */
function href(search: Search, patch: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    const s = one(v);
    if (s) params.set(k, s);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === '') params.delete(k);
    else params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `/leads?${qs}` : '/leads';
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePermission('lead.view');
  const search = await searchParams;

  const filters: LeadFilters = {
    q: one(search.q),
    archetype: one(search.archetype),
    vertical: one(search.vertical),
    country: one(search.country),
    researchState: one(search.state),
    priority: one(search.priority),
    contactability: one(search.contact),
    suppressed: one(search.suppressed) as LeadFilters['suppressed'],
    pipeline: one(search.pipeline),
    sort: (LEAD_SORTS as readonly string[]).includes(one(search.sort) ?? '') ? (one(search.sort) as LeadSort) : 'priority',
    page: Number(one(search.page)) || 1,
  };
  const result = await listLeads(filters);

  const select = (name: string, label: string, options: Array<{ value: string; label?: string; count?: number }>, current?: string) => (
    <label>
      {label}
      <select name={name} defaultValue={current ?? ''}>
        <option value="">All</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label ?? o.value}
            {o.count !== undefined ? ` (${o.count})` : ''}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <div className="row between">
        <h1>Leads</h1>
        <span className="small muted">
          {result.matched} of {result.total} · read from {result.snapshot.source === 'GIT_JSON' ? 'the committed JSON store' : 'Postgres'}
        </span>
      </div>

      <form className="filters" method="get" action="/leads">
        <label>
          Search
          <input type="search" name="q" defaultValue={filters.q ?? ''} placeholder="company, target, city" />
        </label>
        {select('archetype', 'Archetype', result.facets.archetypes.map(a => ({ value: a.value, label: `${a.value} ${a.label}`, count: a.count })), filters.archetype)}
        {select('vertical', 'Vertical', result.facets.verticals, filters.vertical)}
        {select('country', 'Geography', result.facets.countries, filters.country)}
        {select('state', 'Research state', result.facets.researchStates, filters.researchState)}
        {select('priority', 'Tier', result.facets.priorities, filters.priority)}
        {select('pipeline', 'Pipeline', result.facets.pipelineStages, filters.pipeline)}
        {select(
          'contact',
          'Contactability',
          [
            { value: 'callable', label: 'Callable' },
            { value: 'emailable', label: 'Direct email' },
            { value: 'none', label: 'No usable route' },
          ],
          filters.contactability
        )}
        {select('suppressed', 'Suppressed', [{ value: 'yes', label: 'Only suppressed' }, { value: 'no', label: 'Exclude suppressed' }], filters.suppressed)}
        <label>
          Sort
          <select name="sort" defaultValue={filters.sort}>
            <option value="priority">Priority</option>
            <option value="score">Score</option>
            <option value="research">Least researched</option>
            <option value="next_action">Next action due</option>
            <option value="company">Company</option>
            <option value="target">Target number</option>
          </select>
        </label>
        <button type="submit">Apply</button>
        <Link href="/leads" className="badge" style={{ padding: '7px 12px' }}>
          Reset
        </Link>
      </form>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th>Company</th>
              <th>Archetype</th>
              <th>Geography</th>
              <th>State</th>
              <th>Tier</th>
              <th className="num">Score</th>
              <th className="num">Research</th>
              <th>Contactability</th>
              <th>Pipeline</th>
              <th>Next action</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map(r => (
              <tr key={r.leadId}>
                <td>
                  <Link href={`/leads/${r.targetNumber}`}>{r.targetNumber}</Link>
                </td>
                <td>
                  <Link href={`/leads/${r.targetNumber}`}>{r.company}</Link>
                  {r.suppressed ? <span className="badge bad" style={{ marginLeft: 6 }}>suppressed</span> : null}
                </td>
                <td className="small muted">
                  {r.archetype}
                  {r.vertical ? ` · ${r.vertical}` : ''}
                </td>
                <td className="small">{r.country}</td>
                <td>
                  <span className={`badge ${r.researchState === 'OUTREACH_READY' ? 'ok' : r.researchState === 'DISQUALIFIED' ? 'bad' : ''}`}>{r.researchState}</span>
                </td>
                <td>
                  <span className="badge">{r.priorityLabel}</span>
                </td>
                <td className="num">{r.score ?? '—'}</td>
                <td className="num">{r.researchCompleteness}%</td>
                <td className="small">
                  <span className={`badge ${r.contactability.callable || r.contactability.emailable ? 'ok' : 'warn'}`}>{r.contactability.summary}</span>
                </td>
                <td className="small muted">{r.pipelineStage}</td>
                <td className="wrap small">{r.nextAction ?? '—'}</td>
                <td className="small">{r.nextActionDate ?? '—'}</td>
              </tr>
            ))}
            {result.rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="empty">
                  No lead matches these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <Link href={href(search, { page: result.page - 1 })} aria-disabled={result.page <= 1}>
          ← Previous
        </Link>
        <span className="muted">
          Page {result.page} of {result.pages}
        </span>
        <Link href={href(search, { page: result.page + 1 })} aria-disabled={result.page >= result.pages}>
          Next →
        </Link>
      </div>
    </>
  );
}
