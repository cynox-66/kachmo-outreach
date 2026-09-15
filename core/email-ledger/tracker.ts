/**
 * READ-ONLY interpretation of the production email ledger (OUTREACH_TRACKER.md) and scheduled queue.
 * core/ only parses content it is given; it never reads or writes these files. Titan stays authoritative for email.
 */

export interface TrackerRow {
  target_number: string;
  batch: string;
  email: string | null;
  phone: string | null;
  sent_date: string | null;
  follow_up_due: string | null;
  status: string;
}

const clean = (s?: string) => (s ? s.replace(/[`*]/g, '').trim() || null : null);

/** Header-driven parse of every "### Batch N" table. Later sections override earlier ones for the same target. */
export function parseTrackerContent(content: string): Map<string, TrackerRow> {
  const map = new Map<string, TrackerRow>();

  let batch = '';
  let header: string[] | null = null;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    const bm = line.match(/^###\s*Batch\s+(\d+)/i);
    if (bm) {
      batch = `batch${bm[1]}`;
      header = null;
      continue;
    }
    if (/^##\s/.test(line)) {
      batch = '';
      header = null;
      continue;
    }
    if (!batch || !line.startsWith('|')) continue;

    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells[0] === '#') {
      header = cells.map(c => c.toLowerCase());
      continue;
    }
    const m = cells[0]?.match(/^\*\*(\d{3})\*\*$/);
    if (!m || !header) continue;

    const col = (pred: (h: string) => boolean) => {
      const i = header!.findIndex(pred);
      return i >= 0 ? clean(cells[i]) : null;
    };
    const emailCell = col(h => h.includes('recipient') || h.includes('email'));
    const phoneCell = col(h => h.includes('phone'));
    const statusCell = col(h => h.includes('status')) ?? '';
    let status = statusCell.toUpperCase().replace(/\s+/g, '_');
    if (/DISQUALIFIED/i.test(statusCell) || /❌\s*Gate/.test(line)) status = 'DISQUALIFIED';

    map.set(m[1], {
      target_number: m[1],
      batch,
      email: emailCell && emailCell.includes('@') ? emailCell : null,
      phone: phoneCell && /^\+?\d[\d\s()-]{8,}$/.test(phoneCell) ? phoneCell : null,
      sent_date: col(h => h.startsWith('sent')),
      follow_up_due: col(h => h.includes('follow')),
      status,
    });
  }
  return map;
}

export interface ScheduledEmail {
  targetNumber: string;
  to: string;
  companyName: string;
}

/** Interprets parsed scheduled-queue.json content. `label` names the source in the error message. */
export function scheduledQueueFromJson(parsed: unknown, label: string): ScheduledEmail[] {
  if (!Array.isArray(parsed)) throw new Error(`${label} is not a JSON array`);
  return parsed.map((p: any) => ({ targetNumber: String(p.targetNumber), to: String(p.to), companyName: String(p.companyName) }));
}

export const EMAIL_SENT_STATUSES = new Set(['SENT', 'FOLLOW_UP_DUE', 'FOLLOWED_UP', 'REPLIED_WARM', 'REPLIED_NOT_NOW', 'REPLIED_NO', 'CALL_BOOKED', 'PROPOSAL_SENT', 'WON']);
export const EMAIL_REPLY_STATUSES = new Set(['REPLIED_WARM', 'REPLIED_NOT_NOW', 'REPLIED_NO', 'CALL_BOOKED', 'PROPOSAL_SENT', 'WON']);
export const EMAIL_POSITIVE_STATUSES = new Set(['REPLIED_WARM', 'CALL_BOOKED', 'PROPOSAL_SENT', 'WON']);
