import { requirePermission } from '@/server/auth/current-actor';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  await requirePermission('analytics.view');
  return (
    <>
      <h1>Analytics</h1>
      <p className="lede">
        Operational counts only. Heuristic scores are labelled as heuristic and are never presented as conversion
        probabilities, and ratios below a usable sample size are shown as raw counts.
      </p>
    </>
  );
}
