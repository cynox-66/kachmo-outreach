import { requirePermission } from '@/server/auth/current-actor';

export const dynamic = 'force-dynamic';

export default async function EmailLedgerPage() {
  await requirePermission('email.view_ledger');
  return (
    <>
      <h1>Email ledger</h1>
      <p className="lede">
        Read-only. Email is sent by the Titan subsystem (GitHub Actions cron), and <code>OUTREACH_TRACKER.md</code> in
        the repository remains its ledger. This page will show that state, with the commit it came from and how old it
        is.
      </p>
      <div className="panel small muted">
        <p>
          There are no send, schedule or queue-edit controls here, and no equivalent of a force flag. Suppression can
          never be bypassed from this application.
        </p>
      </div>
    </>
  );
}
