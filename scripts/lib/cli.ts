export class CliError extends Error {}

/** `--key=value` (split on the FIRST "=") and bare `--flag` → true. Unknown keys are rejected. */
export function parseArgs(argv: string[], allowed: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (const a of argv) {
    if (!a.startsWith('--')) fail(`Unexpected argument "${a}". Arguments must look like --key=value.`);
    const eq = a.indexOf('=');
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (!allowed.includes(key)) fail(`Unknown option --${key}. Allowed: ${allowed.map(k => `--${k}`).join(', ')}`);
    out[key] = eq === -1 ? true : a.slice(eq + 1);
  }
  return out;
}

export function str(args: Record<string, string | true>, key: string): string | undefined {
  const v = args[key];
  if (v === true) fail(`--${key} needs a value (--${key}=...)`);
  return v === undefined ? undefined : v.trim() || undefined;
}

export function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], name: string): T | undefined {
  if (value === undefined) return undefined;
  const up = value.toUpperCase() as T;
  if (!allowed.includes(up)) fail(`Invalid --${name}=${value}. Allowed: ${allowed.join(', ')}`);
  return up;
}

/** Throws; runCli turns it into a non-zero exit. Throwing (not exiting) keeps CLIs testable. */
export function fail(msg: string): never {
  throw new CliError(msg);
}

export function runCli(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
