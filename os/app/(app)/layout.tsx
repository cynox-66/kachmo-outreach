import Link from 'next/link';
import { requireActor } from '@/server/auth/current-actor';
import { signOutAction } from '@/server/auth/actions';
import type { Permission } from '@/server/authz/permissions';

export const dynamic = 'force-dynamic';

/**
 * Every authenticated page sits under this layout, which resolves the actor server-side. Navigation is filtered by
 * permission for convenience only — each page enforces its own permission again, because hidden links are not security.
 */
const NAV: Array<{ href: string; label: string; permission: Permission }> = [
  { href: '/', label: 'Today', permission: 'lead.view' },
  { href: '/leads', label: 'Leads', permission: 'lead.view' },
  { href: '/research', label: 'Research', permission: 'research.create' },
  { href: '/calls', label: 'Calls', permission: 'outreach.call' },
  { href: '/whatsapp', label: 'WhatsApp', permission: 'outreach.whatsapp' },
  { href: '/email', label: 'Email ledger', permission: 'email.view_ledger' },
  { href: '/pipeline', label: 'Pipeline', permission: 'pipeline.update' },
  { href: '/analytics', label: 'Analytics', permission: 'analytics.view' },
  { href: '/settings', label: 'Settings', permission: 'settings.manage' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const visible = NAV.filter(item => actor.permissions.has(item.permission));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          Kachmo
          <small>Outbound OS</small>
        </div>
        <nav className="nav" aria-label="Sections">
          {visible.map(item => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="who">
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
      <main>{children}</main>
    </div>
  );
}
