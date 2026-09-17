import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnvFile } from 'dotenv';

/**
 * Loads `os/.env.local` for the command-line database tools.
 *
 * Next loads this file automatically; a tsx script does not. Every operator-facing database command reads its
 * target from here, so without this the operator puts a connection string in the documented place and the command
 * reports "DATABASE_URL is not set".
 *
 * `override: false` means a value already exported into the environment always wins, so an env-file entry can
 * never silently replace something the operator set deliberately on the command line.
 *
 * The file is gitignored. Nothing here prints or returns its contents.
 */
const OS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const LOCAL_ENV_FILE = join(OS_ROOT, '.env.local');

export function loadLocalEnv(): { loaded: boolean; path: string } {
  if (!existsSync(LOCAL_ENV_FILE)) return { loaded: false, path: LOCAL_ENV_FILE };
  loadEnvFile({ path: LOCAL_ENV_FILE, override: false, quiet: true });
  return { loaded: true, path: LOCAL_ENV_FILE };
}
