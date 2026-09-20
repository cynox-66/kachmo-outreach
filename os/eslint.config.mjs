import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // The hosted OS must never become a second email pipeline or reach into the legacy CLI/Titan code.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'nodemailer', message: 'Email is sent only by the Titan subsystem. The OS reads email state; it never sends.' },
            { name: 'imapflow', message: 'Email is handled only by the Titan subsystem.' },
          ],
          patterns: [{ group: ['**/scripts/*', '**/scripts/**'], message: 'Import domain logic from core/, never from the legacy scripts/.' }],
        },
      ],
    },
  },
  {
    // Phase B parity suites replay the legacy CLI's own golden scenario against the Postgres write path, so they
    // read the golden ORACLES (pinned dataset, scripted scenario, the CLI's argument parser) — never domain logic.
    // Narrow on purpose: only these two test files, and only these three modules; the mail ban still applies.
    files: ['tests/lead-writes.ts', 'tests/evidence.ts', 'tests/concurrency.ts', 'tests/operating-loop.ts', 'tests/evidence-intelligence.ts', 'tests/jobs.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'nodemailer', message: 'Email is sent only by the Titan subsystem. The OS reads email state; it never sends.' },
            { name: 'imapflow', message: 'Email is handled only by the Titan subsystem.' },
          ],
          patterns: [
            {
              regex: '(^|/)scripts/(?!__tests__/golden/(snapshot|write-paths)\\.js$|lib/cli\\.js$)',
              message: 'Only the golden oracles may be imported by the parity suites.',
            },
          ],
        },
      ],
    },
  },
  globalIgnores(['.next/**', 'out/**', 'node_modules/**', 'next-env.d.ts', 'server/db/migrations/**', 'server/db/migration/out/**']),
]);
