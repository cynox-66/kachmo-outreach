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
 *
 * KACHMO_NO_LOCAL_ENV opts out entirely. Test harnesses set it: a test that spawns a migration command with a
 * deliberately minimal environment must not silently inherit whatever real target the operator has configured.
 */
const OS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(OS_ROOT, '..');

export const LOCAL_ENV_FILE = join(OS_ROOT, '.env.local');
/** The neighbouring path an operator is most likely to use by mistake. Never loaded — only reported. */
export const MISPLACED_ENV_FILE = join(REPO_ROOT, '.env.local');

export function loadLocalEnv(): { loaded: boolean; path: string; misplaced: string | null } {
  // Checked before anything else, so an isolated process stays isolated.
  if (process.env.KACHMO_NO_LOCAL_ENV) return { loaded: false, path: LOCAL_ENV_FILE, misplaced: null };
  // A connection string one directory up is silently invisible, and the command then claims DATABASE_URL is
  // unset while the operator is looking straight at the file. Say so instead.
  const misplaced = existsSync(MISPLACED_ENV_FILE) ? MISPLACED_ENV_FILE : null;
  if (misplaced) {
    console.warn(`⚠️  Ignoring ${MISPLACED_ENV_FILE}: configuration belongs in ${LOCAL_ENV_FILE}. Move it, and check it is gitignored.`);
  }
  if (!existsSync(LOCAL_ENV_FILE)) return { loaded: false, path: LOCAL_ENV_FILE, misplaced };
  loadEnvFile({ path: LOCAL_ENV_FILE, override: false, quiet: true });
  return { loaded: true, path: LOCAL_ENV_FILE, misplaced };
}
