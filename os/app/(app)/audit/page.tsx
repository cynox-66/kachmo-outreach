import { requirePermission } from '@/server/auth/current-actor';
import { listAudit, auditActions } from '@/server/services/admin';

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/** The append-only audit log. Contact values and secrets are redacted before they are ever written. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePermission('audit.view');
  const search = await searchParams;
  const action = one(search.action);
  const [rows, actions] = await Promise.all([listAudit({ action, limit: 200 }), auditActions()]);

  return (
    <>
      <h1>Audit log</h1>
      <p className="lede">
        Append-only at the database level: a trigger rejects UPDATE and DELETE, so no application bug and no ad-hoc
        query through the app&rsquo;s connection can rewrite history. Contact values and secrets are redacted before
        writing, so this log never becomes a back door to the data it protects.
      </p>

      <form className="filters" method="get" action="/audit">
        <label>
          Action
          <select name="action" defaultValue={action ?? ''}>
            <option value="">All ({rows.length} shown)</option>
            {actions.map(a => <option key={a.action} value={a.action}>{a.action} ({a.count})</option>)}
          </select>
        </label>
        <button type="submit">Filter</button>
      </form>

      <div className="tablewrap">
        <table>
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="small">{r.occurredAt.toISOString().slice(0, 19).replace('T', ' ')}</td>
                <td className="small">{r.actorLabel}</td>
                <td><span className={`badge ${r.action.startsWith('authz.denied') ? 'bad' : ''}`}>{r.action}</span></td>
                <td className="small muted">{r.targetType}{r.targetId ? ` · ${r.targetId.slice(0, 18)}` : ''}</td>
                <td className="wrap small muted">{JSON.stringify(r.metadata).slice(0, 220)}</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={5} className="empty">No audit event recorded yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
