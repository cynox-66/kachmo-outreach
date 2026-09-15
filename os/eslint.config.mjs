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
  globalIgnores(['.next/**', 'out/**', 'node_modules/**', 'next-env.d.ts', 'server/db/migrations/**', 'server/db/migration/out/**']),
]);
