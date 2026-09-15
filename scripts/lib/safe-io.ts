import {
  writeFileSync,
  readFileSync,
  renameSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  unlinkSync,
  appendFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'fs';
import { dirname, join, basename } from 'path';

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Atomic JSON write: serialize, write + fsync a temp file in the same directory,
 * then rename over the target. A crash leaves either the old or the new file, never half of one.
 */
export function safeWriteJson(filePath: string, data: unknown): void {
  const jsonStr = JSON.stringify(data, null, 2);
  JSON.parse(jsonStr);

  const dir = dirname(filePath);
  ensureDir(dir);

  const tmpPath = join(dir, `.tmp_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  const fd = openSync(tmpPath, 'w');
  try {
    writeFileSync(fd, jsonStr, 'utf-8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, filePath);
}

export class CorruptJsonError extends Error {}

/**
 * Reads JSON. Returns `fallback` ONLY when the file does not exist.
 * A file that exists but cannot be parsed throws: silently substituting a fallback
 * previously caused `[]` to be written over the whole lead database.
 */
export function safeReadJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) {
    return fallback;
  }
  const content = readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(content) as T;
  } catch (err) {
    throw new CorruptJsonError(
      `Refusing to continue: ${filePath} exists but is not valid JSON (${(err as Error).message}). ` +
        `Restore it from database/backups/ or git before re-running.`
    );
  }
}

export function createBackup(sourcePath: string, backupDir?: string): string {
  if (!existsSync(sourcePath)) {
    throw new Error(`Cannot backup non-existent file: ${sourcePath}`);
  }

  const targetDir = backupDir || join(dirname(sourcePath), 'backups');
  ensureDir(targetDir);

  const ext = sourcePath.slice(sourcePath.lastIndexOf('.'));
  const base = basename(sourcePath, ext);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let destPath = join(targetDir, `${base}_${timestamp}${ext}`);
  for (let i = 1; existsSync(destPath); i++) destPath = join(targetDir, `${base}_${timestamp}_${i}${ext}`);

  copyFileSync(sourcePath, destPath);
  return destPath;
}

/** Keeps the newest `keep` backups whose filename starts with `prefix`. ISO timestamps sort lexically. */
export function pruneBackups(backupDir: string, prefix: string, keep: number): void {
  if (!existsSync(backupDir)) return;
  const files = readdirSync(backupDir)
    .filter(f => f.startsWith(prefix))
    .sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    unlinkSync(join(backupDir, f));
  }
}

/** Append-only log line. Appends never rewrite earlier history. */
export function appendJsonl(filePath: string, record: unknown): void {
  ensureDir(dirname(filePath));
  appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
}

/**
 * Reads a JSONL file. A truncated FINAL line (crash mid-append) is skipped with a warning;
 * corruption anywhere else throws.
 */
export function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  const out: T[] = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      const isLast = lines.slice(i + 1).every(l => !l.trim());
      if (!isLast) throw new CorruptJsonError(`${filePath} line ${i + 1} is not valid JSON.`);
      console.warn(`⚠️  Ignoring truncated final line in ${filePath}`);
    }
  });
  return out;
}
