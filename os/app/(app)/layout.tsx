import Link from 'next/link';
import { requireActor } from '@/server/auth/current-actor';
import { signOutAction } from '@/server/auth/actions';
import { phaseBanner, resolveCutoverPhase, writeRefusal } from '@/server/repo/phase';
import type { Permission } from '@/server/authz/permissions';
import { NavLink } from './components/NavLink';
import { Banner } from './components/ui';

export const dynamic = 'force-dynamic';

/**
 * Every authenticated page sits under this layout, which resolves the actor server-side. Navigation is filtered by
 * permission for convenience only — each page enforces its own permission again, because hidden links are not security.
 *
 * It reads NO database: the cutover phase and the write switch are configuration. (It used to load every lead,
 * suppression entry and event just to print the phase — audit E1.) The phase is stated whenever it is not the normal
 * production state, which is the only time "which store is canonical" changes what an operator may do.
 */
const WORK_NAV: Array<{ href: string; label: string; permission: Permission }> = [
  { href: '/', label: 'Today', permission: 'lead.view' },
  { href: '/leads', label: 'Companies', permission: 'lead.view' },
  { href: '/email', label: 'Emails', permission: 'email.view_ledger' },
  { href: '/calls', label: 'Calls', permission: 'outreach.call' },
  { href: '/whatsapp', label: 'WhatsApp', permission: 'outreach.whatsapp' },
  { href: '/research', label: 'Research', permission: 'research.create' },
  { href: '/pipeline', label: 'Pipeline', permission: 'pipeline.update' },
];

const SYSTEM_NAV: Array<{ href: string; label: string; permission: Permission }> = [
  { href: '/inventory', label: 'Inventory', permission: 'settings.manage' },
  { href: '/analytics', label: 'Analytics', permission: 'analytics.view' },
  { href: '/audit', label: 'Audit log', permission: 'audit.view' },
  { href: '/users', label: 'Team', permission: 'users.manage' },
  { href: '/settings', label: 'Settings', permission: 'settings.manage' },
];

const ROLE_NAMES: Record<string, string> = { OWNER: 'Owner', ADMIN: 'Admin', RESEARCHER: 'Researcher', OUTREACH: 'Outreach', INTERN: 'Intern', VIEWER: 'Viewer' };
const WRITE_PERMISSIONS: Permission[] = ['lead.edit', 'outreach.call', 'outreach.whatsapp', 'pipeline.update', 'suppression.create', 'research.approve', 'evidence.review'];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const work = WORK_NAV.filter(item => actor.permissions.has(item.permission));
  const system = SYSTEM_NAV.filter(item => actor.permissions.has(item.permission));

  const phase = resolveCutoverPhase();
  const banner = phase === 'POST_CUTOVER' ? null : phaseBanner(phase);
  const recordsAnything = WRITE_PERMISSIONS.some(p => actor.permissions.has(p));
  const recordingOff = phase === 'POST_CUTOVER' && recordsAnything && writeRefusal() !== null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <Link href="/" className="brand" aria-label="Kachmo Outbound — Today">
            <span className="wordmark">KACHMO</span>
            <span className="sub">Outbound</span>
          </Link>
        </div>
        <nav className="nav" aria-label="Sections">
          <div className="nav-section">
            <span className="nav-section-title">Work</span>
            {work.map(item => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </div>
          {system.length ? (
            <div className="nav-section">
              <span className="nav-section-title">System</span>
              {system.map(item => (
                <NavLink key={item.href} href={item.href}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ) : null}
        </nav>
        <div className="who">
          <span>
            <strong>{actor.name}</strong>
            <br />
            {actor.roles.map(r => ROLE_NAMES[r] ?? r).join(', ') || 'No role yet — ask an owner'}
          </span>
          <form action={signOutAction}>
            <button className="link" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="wide">
        {banner ? (
          <div style={{ marginBottom: 'var(--s4)' }}>
            <Banner tone="act" chip="Read-only">
              <p>
                <strong>{banner.title}.</strong> You can look at everything; changes are recorded elsewhere for now.
              </p>
            </Banner>
          </div>
        ) : null}
        {recordingOff ? (
          <div style={{ marginBottom: 'var(--s4)' }}>
            <Banner tone="act" chip="View only">
              <p>
                <strong>Recording is switched off.</strong> You can look at everything, but changes can’t be saved yet.
                {actor.permissions.has('settings.manage') ? (
                  <>
                    {' '}
                    <Link href="/settings">Why?</Link>
                  </>
                ) : null}
              </p>
            </Banner>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
