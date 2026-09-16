import { requirePermission } from '@/server/auth/current-actor';

export const dynamic = 'force-dynamic';

export default async function WhatsAppPage() {
  await requirePermission('outreach.whatsapp');
  return (
    <>
      <h1>WhatsApp</h1>
      <p className="lede">
        Draft, human review, human send. This application will never send WhatsApp messages: it prepares the queue,
        records approval and logs the outcome.
      </p>
      <div className="panel small muted">
        <p>A lead appears only with a sourced or verified phone and a recorded WhatsApp basis.</p>
      </div>
    </>
  );
}
