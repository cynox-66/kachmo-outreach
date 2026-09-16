import { requirePermission } from '@/server/auth/current-actor';
import { getOverviewCounts } from '@/server/services/overview';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const actor = await requirePermission('settings.manage');
  const counts = await getOverviewCounts();
  return (
    <>
      <h1>Settings</h1>
      <p className="lede">User management, inventory targets and methodology administration land in later phases.</p>
      <div className="panel small">
        <p>
          Active methodology: <strong>{counts.methodology ? counts.methodology.title : 'none'}</strong>
        </p>
        <p className="muted">
          A methodology version is immutable once active; changing the rules means publishing a new version, so past
          qualifications stay attributable.
        </p>
        <p className="muted">Your roles: {actor.roles.join(', ') || 'none'}.</p>
      </div>
    </>
  );
}
