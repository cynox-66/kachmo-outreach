/** First clause of a research sentence, capped at `words` words — for scannable cards. */
export function short(text: string | null | undefined, words = 22): string {
  const firstClause = (text || '').trim().split(/(?<=[.;])\s/)[0].trim();
  const w = firstClause.split(/\s+/).filter(Boolean);
  const s = w.length > words ? `${w.slice(0, words).join(' ')}…` : firstClause;
  return s.replace(/[.;,]$/, '');
}

export function greetName(name: string | null | undefined): string {
  const t = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!t[0]) return 'there';
  if (/^dr\.?$/i.test(t[0]) && t.length > 1) return `Dr. ${t[t.length - 1]}`;
  return t[0];
}

export const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** Operator-facing priority: tier plus confidence. The 0–100 number stays internal (it is a heuristic, not a measurement). */
export function priorityLabel(priority: string | null | undefined, confidence?: string | null): string {
  if (!priority || priority === 'UNSCORED') return 'unscored';
  return confidence === 'PROVISIONAL' ? `${priority} (provisional)` : priority;
}

/** ["commercial:funding", "pain:legacy"] → "commercial funding · pain legacy" */
export function signalSummary(signals: string[] | null | undefined): string {
  if (!signals?.length) return 'none matched';
  const by: Record<string, string[]> = {};
  for (const s of signals) {
    const [k, v = ''] = s.split(':');
    (by[k] ??= []).push(v.replace(/_/g, ' '));
  }
  return Object.entries(by).map(([k, v]) => `${k} ${v.join(', ')}`).join(' · ');
}

export const wordCount =(s: string) => s.trim().split(/\s+/).filter(Boolean).length;
