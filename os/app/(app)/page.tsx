import { requirePermission } from '@/server/auth/current-actor';
import { getOverviewCounts } from '@/server/services/overview';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const actor = await requirePermission('lead.view');
  const counts = await getOverviewCounts();

  return (
    <>
      <h1>Today</h1>
      <p className="lede">
        What needs attention. This page shows only what the hosted database actually holds — no estimates, no
        placeholders dressed up as data.
      </p>

      {!counts.migrated ? (
        <div className="notice">
          <p>
            <strong>The hosted database holds no leads yet.</strong> The canonical lead data still lives in the JSON
            store (<code>database/kachmo_leads.json</code>), which the CLI keeps using. The migration is rehearsed and
            verified but has not been run against a hosted database, because that needs your approval.
          </p>
          <p className="small muted">
            Rehearse it any time with <code>npm run db:rehearse</code> in <code>os/</code>.
          </p>
        </div>
      ) : null}

      <dl className="stats">
        <div>
          <dt>Leads</dt>
          <dd>{counts.leads}</dd>
        </div>
        <div>
          <dt>Suppression entries</dt>
          <dd>{counts.suppressionEntries}</dd>
        </div>
        <div>
          <dt>Audit events</dt>
          <dd>{counts.auditEvents}</dd>
        </div>
      </dl>

      {counts.byResearchState.length ? (
        <>
          <h2>Research state</h2>
          <div className="panel">
            {counts.byResearchState.map(row => (
              <p key={row.state} className="small">
                {row.state}: {row.count}
              </p>
            ))}
          </div>
        </>
      ) : null}

      <h2>Methodology</h2>
      <div className="panel small">
        {counts.methodology ? (
          <p>
            Active: <strong>{counts.methodology.title}</strong>. Every qualification result is attributed to this
            version.
          </p>
        ) : (
          <p className="muted">No methodology version is active in this database yet.</p>
        )}
      </div>

      <h2>Still to come</h2>
      <div className="panel small muted">
        <p>
          Follow-ups due, call and WhatsApp queues, replies and inventory warnings arrive in Phase 1.4+ once the read
          surfaces are built on migrated data. They are deliberately absent rather than faked.
        </p>
        <p>
          Signed in as {actor.name} ({actor.roles.join(', ') || 'no role'}).
        </p>
      </div>
    </>
  );
}
