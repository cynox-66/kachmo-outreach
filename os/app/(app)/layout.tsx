import Link from 'next/link';
import { requireActor } from '@/server/auth/current-actor';
import { signOutAction } from '@/server/auth/actions';
import { loadCanonical } from '@/server/repo/canonical';
import { phaseBanner } from '@/server/repo/phase';
import type { Permission } from '@/server/authz/permissions';

export const dynamic = 'force-dynamic';

/**
 * Every authenticated page sits under this layout, which resolves the actor server-side. Navigation is filtered by
 * permission for convenience only — each page enforces its own permission again, because hidden links are not security.
 */
const PRIMARY_NAV: Array<{ href: string; label: string; permission: Permission }> = [
  { href: '/', label: 'Today', permission: 'lead.view' },
  { href: '/leads', label: 'Leads', permission: 'lead.view' },
  { href: '/research', label: 'Research', permission: 'research.create' },
  { href: '/research/queue', label: 'Research queue', permission: 'lead.view' },
  { href: '/pipeline', label: 'Pipeline', permission: 'pipeline.update' },
];

const WORKFLOW_NAV: Array<{ href: string; label: string; permission: Permission }> = [
  { href: '/calls', label: 'Calls', permission: 'outreach.call' },
  { href: '/whatsapp', label: 'WhatsApp', permission: 'outreach.whatsapp' },
  { href: '/email', label: 'Email', permission: 'email.view_ledger' },
  { href: '/inventory', label: 'Inventory', permission: 'lead.view' },
];

const ADMIN_NAV: Array<{ href: string; label: string; permission: Permission }> = [
  { href: '/analytics', label: 'Analytics', permission: 'analytics.view' },
  { href: '/audit', label: 'Audit log', permission: 'audit.view' },
  { href: '/users', label: 'Team', permission: 'users.manage' },
  { href: '/settings', label: 'Settings', permission: 'settings.manage' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const visiblePrimary = PRIMARY_NAV.filter(item => actor.permissions.has(item.permission));
  const visibleWorkflow = WORKFLOW_NAV.filter(item => actor.permissions.has(item.permission));
  const visibleAdmin = ADMIN_NAV.filter(item => actor.permissions.has(item.permission));

  // The phase banner is rendered from the declared phase, so the app always states which store it is reading.
  const snapshot = await loadCanonical().catch(() => null);
  const banner = snapshot ? phaseBanner(snapshot.phase) : null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          Kachmo
          <small>Outbound OS</small>
        </div>
        <nav className="nav" aria-label="Sections">
          {visiblePrimary.length ? (
            <div className="nav-section">
              <span className="nav-section-title">Work</span>
              {visiblePrimary.map(item => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
          ) : null}

          {visibleWorkflow.length ? (
            <div className="nav-section">
              <span className="nav-section-title">Channels</span>
              {visibleWorkflow.map(item => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
          ) : null}

          {visibleAdmin.length ? (
            <div className="nav-section">
              <span className="nav-section-title">System</span>
              {visibleAdmin.map(item => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
          ) : null}
        </nav>
        <div className="who">
          {banner ? (
            <span className="small">
              <span className={`badge ${banner.level === 'warn' ? 'warn' : 'info'}`}>{snapshot!.source === 'GIT_JSON' ? 'read-only' : 'postgres'}</span>
              <br />
              {snapshot!.phase.replace('_', ' ').toLowerCase()}
            </span>
          ) : null}
          <span>
            Signed in as <strong>{actor.name}</strong>
            <br />
            {actor.roles.join(', ') || 'no role assigned'}
          </span>
          <form action={signOutAction}>
            <button className="link" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="wide">{children}</main>
    </div>
  );
}
