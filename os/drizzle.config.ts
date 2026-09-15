import { defineConfig } from 'drizzle-kit';

/**
 * Schema → SQL migration generation only (`npm run db:generate`). No credentials are needed or read here:
 * migrations are applied by server/db/migrate.ts, which refuses to run without an explicit target confirmation.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema/index.ts',
  out: './server/db/migrations',
  strict: true,
  verbose: true,
});
