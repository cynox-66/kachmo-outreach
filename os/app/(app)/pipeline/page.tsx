import { requirePermission } from '@/server/auth/current-actor';

export const dynamic = 'force-dynamic';

export default async function PipelinePage() {
  await requirePermission('pipeline.update');
  return (
    <>
      <h1>Pipeline</h1>
      <p className="lede">
        Meeting → proposal → won or lost, in the order the engine enforces. Stage changes will run through the same
        rules as <code>pipeline:log</code>, including the single-bump follow-up protocol.
      </p>
    </>
  );
}
