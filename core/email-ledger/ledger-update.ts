import { addDays } from '../geo/timezone.js';
import type { OutboundEmailKind } from './send-guard.js';

/** Ledger status as the tracker parser reads it (backticks/asterisks removed, upper case, spaces → underscores). */
const cellStatus = (cell: string) => cell.replace(/[`*]/g, '').trim().toUpperCase().replace(/\s+/g, '_');

/**
 * Records a successful direct send in OUTREACH_TRACKER.md content, following the tracker's own state machine:
 *  - FIRST_TOUCH  DRAFTED / SCHEDULED → SENT, with Sent Date = sentDate and Follow-up Due = sentDate + 3 days
 *                 (the same transition and dates the GitHub cron dispatcher writes)
 *  - FOLLOW_UP    SENT / FOLLOW_UP_DUE → FOLLOWED_UP (dates untouched)
 * Columns are located from each batch table's header, so tables with a different layout are handled or skipped
 * safely. Rows in any other state are never touched. Pure: returns new content and how many rows changed.
 */
export function applyLedgerSendUpdate(content: string, targetNumber: string, kind: OutboundEmailKind, sentDate: string): { content: string; updated: number } {
  const lines = content.split('\n');
  let inBatch = false;
  let header: string[] | null = null;
  let updated = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^###\s*Batch\s+\d+/i.test(line)) {
      inBatch = true;
      header = null;
      continue;
    }
    if (/^##\s/.test(line)) {
      inBatch = false;
      header = null;
      continue;
    }
    if (!inBatch || !line.startsWith('|')) continue;

    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells[0] === '#') {
      header = cells.map(c => c.toLowerCase());
      continue;
    }
    if (!header || cells[0] !== `**${targetNumber}**`) continue;

    const statusIdx = header.findIndex(h => h.includes('status'));
    if (statusIdx < 0 || statusIdx >= cells.length) continue;
    const current = cellStatus(cells[statusIdx]);
    const parts = lines[i].split('|'); // parts[k + 1] is cells[k]
    const before = lines[i];

    if (kind === 'FIRST_TOUCH') {
      if (current !== 'DRAFTED' && current !== 'SCHEDULED') continue;
      parts[statusIdx + 1] = parts[statusIdx + 1].replace(/SCHEDULED|DRAFTED/, 'SENT');
      const sentIdx = header.findIndex(h => h.startsWith('sent'));
      const followIdx = header.findIndex(h => h.includes('follow'));
      if (sentIdx >= 0 && sentIdx < cells.length) parts[sentIdx + 1] = ` ${sentDate} `;
      if (followIdx >= 0 && followIdx < cells.length) parts[followIdx + 1] = ` ${addDays(sentDate, 3)} `;
    } else {
      if (current !== 'SENT' && current !== 'FOLLOW_UP_DUE') continue;
      parts[statusIdx + 1] = parts[statusIdx + 1].replace(/\bFOLLOW_UP_DUE\b|\bSENT\b/, 'FOLLOWED_UP');
    }

    lines[i] = parts.join('|');
    if (lines[i] !== before) updated++;
  }
  return { content: lines.join('\n'), updated };
}
