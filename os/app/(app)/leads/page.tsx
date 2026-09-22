import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { listLeads, LEAD_SORTS, type LeadFilters, type LeadSort } from '@/server/services/leads';
import { requestSnapshot } from '@/server/services/snapshot';
import { STATUS_FILTERS, dayLabel } from '@/server/services/operator';
import { archetypeById } from '@kachmo/core/config/taxonomy.js';
import { EmptyNote, PageHead, StatusChip } from '../components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Companies' };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v) || undefined;

/** Preserves current query parameters when navigating or paging. */
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

const SORT_LABELS: Record<LeadSort, string> = {
  attention: 'Needs you first',
  priority: 'Priority',
  score: 'Score',
  research: 'Least researched',
  next_action: 'Next step due',
  company: 'Name',
  target: 'Number',
};

/**
 * COMPANIES — every company, where it stands, and what is next (docs/OPERATOR_EXPERIENCE.md §4.2). The status is the
 * operator label derived on the server; filtering, sorting and paging all happen on the server too.
 */
export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePermission('lead.view');
  const search = await searchParams;
  const sort = (LEAD_SORTS as readonly string[]).includes(one(search.sort) ?? '') ? (one(search.sort) as LeadSort) : 'attention';
  const filters: LeadFilters = {
    q: one(search.q),
    archetype: one(search.archetype),
    vertical: one(search.vertical),
    country: one(search.country),
    researchState: one(search.state),
    priority: one(search.priority),
    contactability: one(search.contact),
    status: one(search.status),
    sort,
    page: Number(one(search.page)) || 1,
  };
  const result = await listLeads(filters, await requestSnapshot());
  const filtered = !!(filters.q || filters.country || filters.priority || filters.status || filters.researchState || filters.contactability || filters.archetype);

  return (
    <>
      <PageHead label={filtered ? `${result.matched} of ${result.total}` : `${result.total} companies`} title="Companies" />

      <form className="filters" method="get" action="/leads" role="search">
        <label className="grow">
          Search
          <input type="search" name="q" defaultValue={filters.q ?? ''} placeholder="Name, city, country or number" />
        </label>
        <label>
          Status
          <select name="status" defaultValue={filters.status ?? ''}>
            <option value="">Any status</option>
            {STATUS_FILTERS.map(s => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select name="priority" defaultValue={filters.priority ?? ''}>
            <option value="">Any priority</option>
            {result.facets.priorities.map(p => (
              <option key={p.value} value={p.value}>
                {p.value === 'UNSCORED' ? 'Not scored' : p.value} ({p.count})
              </option>
            ))}
          </select>
        </label>
        <label>
          Country
          <select name="country" defaultValue={filters.country ?? ''}>
            <option value="">Anywhere</option>
            {result.facets.countries.map(c => (
              <option key={c.value} value={c.value}>
                {c.value} ({c.count})
              </option>
            ))}
          </select>
        </label>
        <label>
          Order
          <select name="sort" defaultValue={sort}>
            {LEAD_SORTS.map(s => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Show</button>
        {filtered ? (
          <Link className="small" href="/leads">
            Clear
          </Link>
        ) : null}
      </form>

      {result.rows.length === 0 ? (
        <EmptyNote title="No companies match these filters." action={{ href: '/leads', label: 'Clear filters' }} />
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Where it stands</th>
                <th>Priority</th>
                <th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map(r => (
                <tr key={r.leadId}>
                  <td className="wrap" style={{ minWidth: 220 }}>
                    <Link href={`/leads/${r.targetNumber}`} style={{ fontWeight: 600, textDecoration: 'none' }}>
                      {r.company}
                    </Link>
                    <div className="small muted">
                      {[r.city, r.country].filter(Boolean).join(', ')} · {archetypeById(r.archetype)?.name ?? r.archetype}
                      <span className="mono"> · #{r.targetNumber}</span>
                    </div>
                  </td>
                  <td className="wrap" style={{ minWidth: 240 }}>
                    <StatusChip status={r.status} />
                    <div className="small muted" style={{ marginTop: 4 }}>
                      {r.status.sentence}
                    </div>
                  </td>
                  <td className="nowrap">
                    <span className="mono small">{r.priority === 'UNSCORED' ? '—' : r.priority}</span>
                    {r.priorityConfidence === 'PROVISIONAL' ? (
                      <div className="small muted" title="The ranking can change once research is complete.">
                        provisional
                      </div>
                    ) : null}
                  </td>
                  <td className="wrap small">
                    {r.nextAction ?? <span className="muted">—</span>}
                    {r.nextActionDate ? <div className="muted">Due {dayLabel(r.nextActionDate)}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.pages > 1 ? (
        <nav className="pager" aria-label="Pages">
          <Link href={href(search, { page: result.page - 1 })} aria-disabled={result.page <= 1}>
            ← Previous
          </Link>
          <span className="muted small">
            Page {result.page} of {result.pages}
          </span>
          <Link href={href(search, { page: result.page + 1 })} aria-disabled={result.page >= result.pages}>
            Next →
          </Link>
        </nav>
      ) : null}
    </>
  );
}
