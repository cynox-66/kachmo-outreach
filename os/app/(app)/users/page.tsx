import { requirePermission } from '@/server/auth/current-actor';
import { listUsers, roleMatrix, assignableRoles } from '@/server/services/admin';

export const dynamic = 'force-dynamic';

/**
 * User and role management. Deny-by-default: a user with no role has no permissions at all, and only an OWNER may
 * grant OWNER. Nobody can grant themselves something they do not already hold.
 */
export default async function UsersPage() {
  const actor = await requirePermission('users.manage');
  const [users, matrix] = await Promise.all([listUsers(), Promise.resolve(roleMatrix())]);
  const canAssign = assignableRoles(actor);

  return (
    <>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div>
          <h1>Team & Access</h1>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            Invite-only team workspace · Database-enforced server-side RBAC
          </p>
        </div>
        <span className="badge info">{users.length} members</span>
      </div>
      <p className="lede" style={{ marginBottom: 20 }}>
        Roles come from the database on every request, never from client input. A user with no role has no permissions.
      </p>

      <h2>People ({users.length})</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th className="num">Permissions</th><th>Status</th><th>Added</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td className="small"><code>{u.email}</code></td>
                <td>{u.roles.length ? u.roles.map(r => <span key={r} className="badge" style={{ marginRight: 4 }}>{r}</span>) : <span className="badge warn">no role</span>}</td>
                <td className="num">{u.permissionCount}</td>
                <td>{u.deactivatedAt ? <span className="badge bad">deactivated</span> : <span className="badge ok">active</span>}</td>
                <td className="small">{u.createdAt.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
            {users.length === 0 ? <tr><td colSpan={6} className="empty">No user yet. Bootstrap the first owner with <code>npm run owner:bootstrap</code>.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <div className="notice">
        <p>
          <strong>Inviting and role changes are CLI-only for now.</strong> Adding a mutation here before the audit and
          rate-limiting paths are wired through it would be the wrong order — it is the one surface where a bug hands
          someone else&rsquo;s permissions out.
        </p>
        <p className="small">
          You may assign: {canAssign.join(', ')}. {actor.roles.includes('OWNER') ? '' : 'Only an OWNER may grant OWNER.'}
        </p>
      </div>

      <h2>What each role can do</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Permission</th>
              {matrix.roles.map(r => <th key={r.role} className="num">{r.role}</th>)}
            </tr>
          </thead>
          <tbody>
            {matrix.permissions.map(p => (
              <tr key={p}>
                <td className="small"><code>{p}</code></td>
                {matrix.roles.map(r => (
                  <td key={r.role} className="num">
                    {(r.permissions as readonly string[]).includes(p) ? <span className="badge ok">✓</span> : <span className="muted">·</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        Interns never see contact details, never approve, never export, never suppress and never contact anyone. No
        role has a permission that bypasses send safety.
      </p>
    </>
  );
}
