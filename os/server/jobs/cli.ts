/**
 * `npm --prefix os run jobs:run -- --job=<name> [--period=<key>] [--actor="<name>"] [--limit=N]`
 * `npm --prefix os run jobs:status`
 *
 * Runs one maintenance job under the ledger (ADR-033), or prints the last run of each. A job writes, so the target
 * host must be confirmed (ADR-030). Jobs are invoked — by a person, or by the committed workflow (ADR-034); nothing
 * schedules itself from inside the application.
 */
import { openOperatorDatabase } from '../leads/operator-db';
import { jobStatus } from './runner';
import { runNamedJob, isJobName, JOBS, JOB_WRITES } from './jobs';

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const status = process.argv.includes('--status') || /jobs:status/.test(process.env.npm_lifecycle_event ?? '');
const job = arg('job') ?? '';

if (!status && !isJobName(job)) {
  console.error(`Usage: jobs:run -- --job=<${JOBS.join('|')}> [--period=<key>] [--actor="<name>"] [--limit=N]`);
  process.exit(2);
}

const { db, close, label } = openOperatorDatabase({ writes: !status });
(async () => {
  if (status) {
    const rows = await jobStatus(db);
    console.log(`\n🧰 Job ledger — target ${label}`);
    if (!rows.length) console.log('   no job has ever run');
    for (const r of rows) {
      const when = r.startedAt.toISOString().slice(0, 16).replace('T', ' ');
      console.log(`   ${r.job.padEnd(18)} ${r.status.padEnd(10)} attempt ${r.attempt}  ${when}  ${r.key}`);
      if (r.error) console.log(`      error: ${r.error.slice(0, 160)}`);
      if (Object.keys(r.summary).length) console.log(`      ${JSON.stringify(r.summary).slice(0, 300)}`);
    }
    return 0;
  }

  const name = job as Parameters<typeof runNamedJob>[1];
  const actor = arg('actor') ?? 'SCHEDULED_JOB';
  console.log(`\n🧰 Job ${name} — target ${label}`);
  console.log(`   may write: ${JOB_WRITES[name].join(', ')}`);
  const r = await runNamedJob(db, name, { actor, period: arg('period'), limit: arg('limit') ? Number(arg('limit')) : undefined });
  console.log(`   ${r.outcome} (attempt ${r.attempt}) · key ${r.key}`);
  if (r.error) console.log(`   error: ${r.error}`);
  if (Object.keys(r.summary).length) console.log(`   ${JSON.stringify(r.summary, null, 1).slice(0, 1200)}`);
  return r.outcome === 'FAILED' ? 1 : 0;
})()
  .then(code => close().then(() => process.exit(code)))
  .catch(err => {
    console.error(`\n❌ ${(err as Error).message}`);
    close().finally(() => process.exit(1));
  });
