import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SuppressionEntry } from '@kachmo/core/leads/schema.js';
import { serializeSuppressionArtifact } from '@kachmo/core/reconciliation/suppression-artifact.js';
import type { SuppressionTransport } from './titan-bridge';

/**
 * THE ONLY WRITER OF database/suppression.json.
 *
 * The legacy CLI writer is frozen after cutover (ADR-018): the file is no longer canonical state that an operator
 * edits, it is a DERIVED ARTIFACT produced from Postgres by the audited publisher. This module is that write
 * boundary, and it is deliberately the only one — scripts/lib/store.ts refuses, and a test asserts nothing else
 * writes the path.
 *
 * `sha` here is the SHA-256 of the file's exact bytes, which is what makes the optimistic concurrency in
 * core/reconciliation/publish.ts real: the write is conditional on the bytes the planner read, so a file that
 * moved in between is a conflict rather than a silent overwrite.
 *
 * Holds no credentials and opens no network connection, so it stays importable by tests and by the CLI.
 */

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const SUPPRESSION_ARTIFACT = 'database/suppression.json';

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** The SHA of an absent file. Distinct from any real content hash, so "absent" is a state the planner can see. */
export const ABSENT_SHA = 'absent';

export interface ArtifactRead {
  raw: string | null;
  entries: SuppressionEntry[];
  sha: string;
  path: string;
}

export function readSuppressionArtifact(root: string = REPO_ROOT): ArtifactRead {
  const path = join(root, SUPPRESSION_ARTIFACT);
  if (!existsSync(path)) return { raw: null, entries: [], sha: ABSENT_SHA, path };
  const raw = readFileSync(path, 'utf-8');
  let entries: SuppressionEntry[] = [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) entries = parsed as SuppressionEntry[];
  } catch {
    // Left empty on purpose: the verifier classifies malformed artifacts. Returning [] here would let a caller
    // that skipped verification treat a corrupt file as "no suppressions", so every caller must verify first.
  }
  return { raw, entries, sha: sha256(raw), path };
}

export class ArtifactConflictError extends Error {
  constructor(expected: string, actual: string) {
    super(
      `the suppression artifact changed between read and write (expected ${expected.slice(0, 12)}, found ${actual.slice(0, 12)}). ` +
        'Nothing was written. Re-read and plan again; never overwrite a change you have not seen.'
    );
    this.name = 'ArtifactConflictError';
  }
}

/**
 * Writes the artifact, conditional on `expectedSha`, atomically.
 *
 * Atomic because a half-written suppression file is the worst possible failure: the dispatcher would read fewer
 * suppressions than exist and believe it was safe. Write-then-rename means the dispatcher sees either the old
 * complete file or the new complete file, never a partial one.
 */
export function writeSuppressionArtifact(entries: SuppressionEntry[], expectedSha: string, root: string = REPO_ROOT): { sha: string; bytes: number; changed: boolean } {
  const current = readSuppressionArtifact(root);
  if (current.sha !== expectedSha) throw new ArtifactConflictError(expectedSha, current.sha);

  const contents = serializeSuppressionArtifact(entries);
  const nextSha = sha256(contents);
  if (current.raw === contents) return { sha: nextSha, bytes: Buffer.byteLength(contents), changed: false };

  const path = join(root, SUPPRESSION_ARTIFACT);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, contents, 'utf-8');
    renameSync(tmp, path);
  } catch (e) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw e;
  }
  return { sha: nextSha, bytes: Buffer.byteLength(contents), changed: true };
}

/** The transport the ADR-010 planner expects, backed by the committed file. */
export function artifactTransport(root: string = REPO_ROOT): SuppressionTransport {
  return {
    read: async () => {
      const r = readSuppressionArtifact(root);
      return { entries: r.entries, sha: r.sha };
    },
    write: async (next, expectedSha) => {
      try {
        const r = writeSuppressionArtifact(next, expectedSha, root);
        return { ok: true, sha: r.sha };
      } catch (e) {
        if (e instanceof ArtifactConflictError) return { ok: false, conflict: true, message: e.message };
        return { ok: false, conflict: false, message: (e as Error).message };
      }
    },
  };
}
