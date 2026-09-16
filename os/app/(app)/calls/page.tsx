import { requirePermission } from '@/server/auth/current-actor';

export const dynamic = 'force-dynamic';

export default async function CallsPage() {
  await requirePermission('outreach.call');
  return (
    <>
      <h1>Calls</h1>
      <p className="lede">
        The call workspace reads the same eligibility rules the CLI uses (sourced or verified phone only, attempt caps,
        spacing, terminal outcomes). It is wired up once lead data is migrated.
      </p>
      <div className="panel small muted">
        <p>A number with unverified provenance will never appear in a call queue here, exactly as in the engine.</p>
      </div>
    </>
  );
}
