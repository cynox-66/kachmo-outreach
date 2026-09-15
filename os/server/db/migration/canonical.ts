import { createHash } from 'node:crypto';

/** JSON with object keys sorted recursively, so hashes compare meaning (Postgres jsonb does not keep key order). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v
  );
}

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
export const canonicalSha256 = (value: unknown): string => sha256(canonicalJson(value));
