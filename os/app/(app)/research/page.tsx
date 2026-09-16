import { requirePermission } from '@/server/auth/current-actor';

export const dynamic = 'force-dynamic';

export default async function ResearchPage() {
  await requirePermission('research.create');
  return (
    <>
      <h1>Research</h1>
      <p className="lede">
        Research missions, the prompt engine, report upload and the candidate review queue are Phase 2. They will be
        generated from the versioned methodology, and imported candidates will reach the canonical database only after
        a human approves them.
      </p>
      <div className="panel small muted">
        <p>
          Externally supplied source URLs will be stored as unreviewed evidence: a URL is not proof until someone
          checks that it supports the claim.
        </p>
      </div>
    </>
  );
}
