import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { listLeads, LEAD_SORTS, type LeadFilters, type LeadSort } from '@/server/services/leads';
import { presentStatus, presentTone } from '@/server/services/presentation';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';

export const dynamic = 'force-dynamic';

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

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div>
          <h1>Leads</h1>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            {result.matched} of {result.total} leads · read from {result.snapshot.source === 'GIT_JSON' ? 'committed JSON' : 'Postgres'}
          </p>
        </div>
      </div>

      {/* ── STREAMLINED OPERATOR FILTER BAR ──────────────────────────────── */}
      <form className="filters" method="get" action="/leads" style={{ marginBottom: 16 }}>
        <label>
          Search
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ''}
            placeholder="Company, city, target..."
            style={{ width: '210px' }}
          />
        </label>

        <label>
          Status
          <select name="state" defaultValue={filters.researchState ?? ''}>
            <option value="">All statuses</option>
            {result.facets.researchStates.map(s => (
              <option key={s.value} value={s.value}>
                {presentStatus(s.value)} ({s.count})
              </option>
            ))}
          </select>
        </label>

        <label>
          Tier
          <select name="priority" defaultValue={filters.priority ?? ''}>
            <option value="">All tiers</option>
            {result.facets.priorities.map(p => (
              <option key={p.value} value={p.value}>
                {p.value} ({p.count})
              </option>
            ))}
          </select>
        </label>

        <label>
          Geography
          <select name="country" defaultValue={filters.country ?? ''}>
            <option value="">All geographies</option>
            {result.facets.countries.map(c => (
              <option key={c.value} value={c.value}>
                {c.value} ({c.count})
              </option>
            ))}
          </select>
        </label>

        <label>
          Contact route
          <select name="contact" defaultValue={filters.contactability ?? ''}>
            <option value="">All routes</option>
            <option value="callable">Callable (verified phone)</option>
            <option value="emailable">Direct email</option>
            <option value="none">No usable route</option>
          </select>
        </label>

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

        <button type="submit">Filter</button>
        <Link href="/leads" className="badge ghost" style={{ padding: '7px 12px', textDecoration: 'none' }}>
          Reset
        </Link>
      </form>

      {/* ── SIMPLIFIED OPERATOR LEAD TABLE ───────────────────────────────── */}
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: '80px' }}>Target</th>
              <th>Company</th>
              <th>Segment</th>
              <th>Status</th>
              <th>Tier</th>
              <th>Contact route</th>
              <th>Next action</th>
              <th style={{ textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map(r => {
              const humanStatus = r.suppressed ? 'Do not contact' : presentStatus(r.researchState);
              const tone = r.suppressed ? 'bad' : presentTone(r.researchState);

              return (
                <tr key={r.leadId}>
                  <td className="small" style={{ fontFamily: 'var(--mono)' }}>
                    <Link href={`/leads/${r.targetNumber}`} style={{ textDecoration: 'none', fontWeight: 600 }}>
                      {r.targetNumber}
                    </Link>
                  </td>

                  <td>
                    <div>
                      <Link href={`/leads/${r.targetNumber}`} style={{ textDecoration: 'none', fontWeight: 550 }}>
                        {r.company}
                      </Link>
                    </div>
                  </td>

                  <td className="small muted">
                    {r.archetype}
                    {r.vertical ? ` · ${r.vertical}` : ''}
                    <div style={{ fontSize: '11px' }}>
                      {r.city ? `${r.city}, ` : ''}{r.country}
                    </div>
                  </td>

                  <td>
                    <StatusBadge label={humanStatus} tone={tone} />
                  </td>

                  <td>
                    <span className="badge">{r.priorityLabel}</span>
                  </td>

                  <td className="small">
                    {r.suppressed ? (
                      <span className="badge bad">Blocked</span>
                    ) : r.contactability.callable || r.contactability.emailable ? (
                      <span className="badge ok">{r.contactability.summary}</span>
                    ) : (
                      <span className="badge warn">Missing route</span>
                    )}
                  </td>

                  <td className="wrap small">
                    <div>{r.nextAction ?? <span className="muted">—</span>}</div>
                    {r.nextActionDate ? (
                      <div className="muted" style={{ fontSize: '11px', marginTop: 2 }}>
                        Due: {r.nextActionDate}
                      </div>
                    ) : null}
                  </td>

                  <td style={{ textAlign: 'right' }}>
                    <Link
                      href={`/leads/${r.targetNumber}`}
                      className="badge ghost"
                      style={{ textDecoration: 'none', padding: '4px 8px' }}
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              );
            })}

            {result.rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 0 }}>
                  <EmptyState
                    title="No leads match your search."
                    description="Try adjusting or resetting your filters to see more results."
                    action={
                      <Link href="/leads" className="badge ghost" style={{ textDecoration: 'none' }}>
                        Reset filters
                      </Link>
                    }
                  />
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* ── PAGINATION ──────────────────────────────────────────────────── */}
      <div className="pager" style={{ marginTop: 16 }}>
        <Link href={href(search, { page: result.page - 1 })} aria-disabled={result.page <= 1}>
          ← Previous
        </Link>
        <span className="muted small">
          Page {result.page} of {result.pages}
        </span>
        <Link href={href(search, { page: result.page + 1 })} aria-disabled={result.page >= result.pages}>
          Next →
        </Link>
      </div>
    </>
  );
}
