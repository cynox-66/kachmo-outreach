import { requirePermission } from '@/server/auth/current-actor';
import { getOverviewCounts } from '@/server/services/overview';

export const dynamic = 'force-dynamic';

export default async function LeadsPage() {
  const actor = await requirePermission('lead.view');
  const counts = await getOverviewCounts();
  const canSeeContacts = actor.permissions.has('lead.view_contacts');

  return (
    <>
      <h1>Leads</h1>
      <p className="lede">
        The lead table, detail view and &ldquo;why this lead?&rdquo; explanation are built on the migrated database in
        the next phase. Every value shown there will come from stored engine results, never from logic in the browser.
      </p>
      <div className="panel small">
        <p>Leads in the hosted database: <strong>{counts.leads}</strong>.</p>
        <p className="muted">
          {canSeeContacts
            ? 'Your role may view contact details; provenance is shown beside every phone number and email address.'
            : 'Your role sees leads with contact details masked.'}
        </p>
      </div>
    </>
  );
}
