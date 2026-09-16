import type { ReportFormat, ReportProblem } from '@kachmo/core/research/report.js';
import { EXTRACTABLE_FIELDS, sanitizeText, MAX_VALUE_LENGTH } from '@kachmo/core/research/extraction.js';
import { parseCsv } from '@kachmo/core/leads/csv.js';

/**
 * REPORT PARSING — untrusted text to a candidate-shaped structure.
 *
 * This is deliberately a DETERMINISTIC parser, not a model. A research drop that follows the brief's output schema
 * needs no LLM to read, and a deterministic parser cannot hallucinate a company that was not in the file. The LLM
 * extraction interface (core/research/extraction.ts) remains available for free-form prose, and its output goes
 * through exactly the same validator this parser's output does.
 *
 * Everything here is bounded: input size, nesting depth, field count, value length and candidate count are all
 * capped, so a malicious or malformed report exhausts a limit rather than the process.
 */

export const MAX_PARSE_BYTES = 5 * 1024 * 1024;
export const MAX_JSON_DEPTH = 12;
export const MAX_PARSED_CANDIDATES = 200;
export const MAX_FIELDS_PER_CANDIDATE = 60;
export const MAX_CSV_ROWS = 1000;

export interface ParseResult {
  /** Candidate-shaped objects, ready for validateExtraction(). Never trusted, never stored as-is. */
  raw: unknown[];
  problems: ReportProblem[];
}

const problem = (code: string, message: string, at: string | null = null, severity: 'ERROR' | 'WARNING' = 'ERROR'): ReportProblem => ({ severity, code, message, at });

const FIELD_SET = new Set<string>(EXTRACTABLE_FIELDS);

/** Normalises a heading or column name to an extractable field, or null. Never guesses beyond exact aliases. */
const FIELD_ALIASES: Record<string, string> = {
  company: 'company_name',
  name: 'company_name',
  website: 'website_url',
  url: 'website_url',
  site: 'website_url',
  country: 'location_country',
  city: 'location_city',
  archetype: 'archetype_id',
  decision_maker: 'decision_maker_name',
  contact_name: 'decision_maker_name',
  role: 'decision_maker_title',
  title: 'decision_maker_title',
  email: 'decision_maker_email',
  phone: 'decision_maker_phone',
  linkedin: 'decision_maker_linkedin',
  commercial_signal: 'commercial_validation_signal',
  commercial_proof: 'commercial_validation_signal',
  friction: 'observable_friction',
  digital_friction: 'observable_friction',
  tech: 'current_framework',
  stack: 'current_framework',
  trigger: 'trigger_event',
  scale: 'estimated_scale',
};

export function normalizeFieldName(raw: string): string | null {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (FIELD_SET.has(key)) return key;
  const alias = FIELD_ALIASES[key];
  return alias && FIELD_SET.has(alias) ? alias : null;
}

/** Rejects deeply nested JSON before it is walked, so a nesting bomb cannot blow the stack. */
export function jsonDepth(value: unknown, depth = 0): number {
  if (depth > MAX_JSON_DEPTH) return depth;
  if (Array.isArray(value)) return value.length ? Math.max(...value.map(v => jsonDepth(v, depth + 1))) : depth;
  if (value && typeof value === 'object') {
    const vals = Object.values(value as Record<string, unknown>);
    return vals.length ? Math.max(...vals.map(v => jsonDepth(v, depth + 1))) : depth;
  }
  return depth;
}

const claim = (field: string, value: string | null, sourceUrl: string | null, at: string) => ({
  field,
  value,
  statedConfidence: 'UNKNOWN',
  reportLocation: at,
  evidence: sourceUrl ? [{ field, claim: `${field} stated in the report`, sourceUrl, sourceType: 'other' }] : [],
});

/**
 * JSON reports: an array of candidate objects, or `{ candidates: [...] }`.
 * A `source`/`source_url` key sitting beside a field attaches to that field as evidence.
 */
function parseJsonReport(text: string): ParseResult {
  const problems: ReportProblem[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { raw: [], problems: [problem('JSON_INVALID', `The report is not valid JSON: ${(e as Error).message}`)] };
  }
  if (jsonDepth(parsed) > MAX_JSON_DEPTH) {
    return { raw: [], problems: [problem('JSON_TOO_DEEP', `The report nests deeper than ${MAX_JSON_DEPTH} levels and was not walked.`)] };
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).candidates)
      ? ((parsed as Record<string, unknown>).candidates as unknown[])
      : null;
  if (!list) return { raw: [], problems: [problem('JSON_SHAPE', 'Expected an array of candidates, or an object with a "candidates" array.')] };
  if (list.length > MAX_PARSED_CANDIDATES) problems.push(problem('TOO_MANY_CANDIDATES', `Only the first ${MAX_PARSED_CANDIDATES} candidates were read.`, null, 'WARNING'));

  const raw = list.slice(0, MAX_PARSED_CANDIDATES).map((entry, i) => {
    const at = `candidate ${i + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(problem('CANDIDATE_SHAPE', 'A candidate was not an object and was skipped.', at));
      return { claims: [] };
    }
    // Already in claim form? Pass it through for the validator to judge.
    if (Array.isArray((entry as Record<string, unknown>).claims)) return entry;

    const obj = entry as Record<string, unknown>;
    const claims: ReturnType<typeof claim>[] = [];
    for (const [k, v] of Object.entries(obj).slice(0, MAX_FIELDS_PER_CANDIDATE)) {
      const field = normalizeFieldName(k);
      if (!field) continue;
      if (v !== null && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
        problems.push(problem('VALUE_NOT_SCALAR', `"${k}" was not a simple value and was skipped.`, at, 'WARNING'));
        continue;
      }
      const sourceKey = Object.keys(obj).find(x => new RegExp(`^${k}[_-]?(source|url|evidence)$`, 'i').test(x));
      const source = sourceKey && typeof obj[sourceKey] === 'string' ? (obj[sourceKey] as string) : null;
      claims.push(claim(field, v === null ? null : sanitizeText(String(v)).slice(0, MAX_VALUE_LENGTH), source, at));
    }
    return { claims };
  });

  return { raw, problems };
}

/** CSV reports: a header row of field names, one candidate per row. */
function parseCsvReport(text: string): ParseResult {
  const problems: ReportProblem[] = [];
  const rows = parseCsv(text);
  if (rows.length < 2) return { raw: [], problems: [problem('CSV_EMPTY', 'The CSV has no data rows.')] };
  if (rows.length - 1 > MAX_CSV_ROWS) problems.push(problem('TOO_MANY_ROWS', `Only the first ${MAX_CSV_ROWS} rows were read.`, null, 'WARNING'));

  const header = rows[0].map(h => normalizeFieldName(h));
  const recognised = header.filter(Boolean).length;
  if (recognised === 0) {
    return { raw: [], problems: [problem('CSV_NO_FIELDS', `No column matched a known field. Expected some of: ${EXTRACTABLE_FIELDS.join(', ')}.`)] };
  }

  // A column literally named for a field's source attaches as that field's evidence.
  const sourceFor = new Map<number, string>();
  rows[0].forEach((h, i) => {
    const m = /^(.*?)[ _-]?(source|url|evidence)$/i.exec(h.trim());
    const target = m ? normalizeFieldName(m[1]) : null;
    if (target && header[i] === null) sourceFor.set(i, target);
  });

  // Only columns that are neither a field nor a field's source are genuinely unrecognised.
  const unmatched = rows[0].filter((_, i) => header[i] === null && !sourceFor.has(i));
  if (unmatched.length) problems.push(problem('CSV_UNKNOWN_COLUMNS', `Ignored unrecognised columns: ${unmatched.slice(0, 8).join(', ')}.`, null, 'WARNING'));

  const raw = rows.slice(1, MAX_CSV_ROWS + 1).map((cells, r) => {
    const at = `row ${r + 2}`;
    const sources = new Map<string, string>();
    for (const [i, field] of sourceFor) if (cells[i]?.trim()) sources.set(field, cells[i].trim());
    const claims = header
      .map((field, i) => (field && cells[i]?.trim() ? claim(field, sanitizeText(cells[i]).slice(0, MAX_VALUE_LENGTH), sources.get(field) ?? null, at) : null))
      .filter((c): c is ReturnType<typeof claim> => c !== null);
    return { claims };
  });

  return { raw, problems };
}

/**
 * Markdown / plain text reports.
 *
 * One candidate per `##`-level heading. Inside a section, `field: value` lines (with or without a leading bullet
 * or bold markers) become claims, and a bare URL on a line — or a `(source: ...)` suffix — attaches to the field
 * above it. Text that matches nothing is ignored rather than guessed at.
 */
function parseMarkdownReport(text: string): ParseResult {
  const problems: ReportProblem[] = [];
  const lines = text.split(/\r?\n/);
  const sections: Array<{ title: string; body: string[]; line: number }> = [];
  let current: { title: string; body: string[]; line: number } | null = null;

  lines.forEach((line, i) => {
    const heading = /^\s{0,3}#{2,3}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current) sections.push(current);
      current = { title: sanitizeText(heading[1].replace(/^\d+[.)]\s*/, '')), body: [], line: i + 1 };
      return;
    }
    if (current) current.body.push(line);
  });
  if (current) sections.push(current);

  if (!sections.length) {
    return { raw: [], problems: [problem('MARKDOWN_NO_SECTIONS', 'No "## Company" headings were found. Each company needs its own heading.')] };
  }
  if (sections.length > MAX_PARSED_CANDIDATES) problems.push(problem('TOO_MANY_CANDIDATES', `Only the first ${MAX_PARSED_CANDIDATES} sections were read.`, null, 'WARNING'));

  const URL_RE = /https?:\/\/[^\s)<>"']+/;

  const raw = sections.slice(0, MAX_PARSED_CANDIDATES).map(section => {
    const at = `line ${section.line} — ${section.title.slice(0, 60)}`;
    const claims: ReturnType<typeof claim>[] = [claim('company_name', section.title.slice(0, MAX_VALUE_LENGTH), null, at)];
    let lastField: string | null = 'company_name';

    for (const bodyLine of section.body) {
      const line = bodyLine.replace(/^\s*[-*+]\s*/, '').trim();
      if (!line) continue;

      // Checked first: "Source: <url>" would otherwise be read as an unknown field called "Source".
      const sourceOnly = /^\*{0,2}(?:source|evidence)\*{0,2}\s*[:：]?\s*(https?:\/\/\S+)$/i.exec(line);
      if (sourceOnly) {
        if (lastField) {
          const target = claims.slice().reverse().find(c => c.field === lastField);
          if (target && !target.evidence.length) {
            target.evidence.push({ field: lastField, claim: `${lastField} stated in the report`, sourceUrl: sourceOnly[1], sourceType: 'other' });
          }
        }
        continue;
      }

      const kv = /^\*{0,2}([A-Za-z][A-Za-z0-9 _/-]{0,40})\*{0,2}\s*[:：]\s*(.*)$/.exec(line);
      if (kv) {
        const field = normalizeFieldName(kv[1]);
        if (!field) {
          lastField = null;
          continue;
        }
        let value = kv[2].trim();
        // An inline "(source: https://…)" is evidence for this field, not part of the value.
        const inline = /\(\s*(?:source|evidence)\s*[:：]?\s*(https?:\/\/[^\s)]+)\s*\)/i.exec(value);
        let source: string | null = inline ? inline[1] : null;
        if (inline) value = value.replace(inline[0], '').trim();
        if (!source && field !== 'website_url' && field !== 'decision_maker_linkedin') {
          const bare = URL_RE.exec(value);
          // A value that is ONLY a URL is the value; a URL trailing prose is its source.
          if (bare && value.trim() !== bare[0]) {
            source = bare[0];
            value = value.replace(bare[0], '').trim().replace(/[—–-]\s*$/, '').trim();
          }
        }
        value = sanitizeText(value.replace(/^\*+|\*+$/g, '')).slice(0, MAX_VALUE_LENGTH);
        if (claims.length >= MAX_FIELDS_PER_CANDIDATE) {
          problems.push(problem('TOO_MANY_FIELDS', `Only the first ${MAX_FIELDS_PER_CANDIDATE} fields were read.`, at, 'WARNING'));
          break;
        }
        claims.push(claim(field, value || null, source, at));
        lastField = field;
        continue;
      }
    }
    return { claims };
  });

  return { raw, problems };
}

/** Dispatches on the declared format. An unsupported format never reaches a parser. */
export function parseReport(content: string, format: ReportFormat): ParseResult {
  if (content.length > MAX_PARSE_BYTES) {
    return { raw: [], problems: [problem('TOO_LARGE', `The report is larger than ${MAX_PARSE_BYTES} bytes and was not parsed.`)] };
  }
  switch (format) {
    case 'json':
      return parseJsonReport(content);
    case 'csv':
      return parseCsvReport(content);
    case 'markdown':
    case 'text':
      return parseMarkdownReport(content);
    default:
      return { raw: [], problems: [problem('FORMAT_UNSUPPORTED', `"${format}" is not a supported report format.`)] };
  }
}
