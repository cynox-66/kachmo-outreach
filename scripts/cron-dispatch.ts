/**
 * Autonomous Timezone-Aware Outreach Cron Dispatcher for Kachmo Studios
 *
 * Designed to run in ephemeral cloud runners (GitHub Actions cron) or locally.
 * Reads queued emails from `scheduled-queue.json`, checks if the recipient's local
 * city is currently in its optimal business morning (weekday 8:00 AM - 10:30 AM local time),
 * and dispatches matching emails directly via Titan SMTP.
 *
 * Usage:
 *   npx tsx scripts/cron-dispatch.ts
 *   npx tsx scripts/cron-dispatch.ts --dry-run
 *   npx tsx scripts/cron-dispatch.ts --force
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createTransport, type Transporter } from 'nodemailer';

dotenv.config();

const TITAN_SMTP_HOST = process.env.TITAN_SMTP_HOST || 'smtpout.secureserver.net';
const TITAN_SMTP_PORT = parseInt(process.env.TITAN_SMTP_PORT || '587', 10);
const TITAN_EMAIL = process.env.TITAN_EMAIL || 'studios@kachmo.in';
const TITAN_PASSWORD = process.env.TITAN_PASSWORD;

const THROTTLE_DELAY_MS = 4000;

interface EmailPayload {
  to: string;
  subject: string;
  plainText: string;
  htmlContent: string;
  targetNumber: string;
  companyName: string;
  locationCity: string;
  locationCountry: string;
  confidence: 'HIGH' | 'LOW';
}

const CITY_TIMEZONE_MAP: Record<string, string> = {
  // Tier 1
  'london': 'Europe/London',
  'new york': 'America/New_York',
  'brooklyn': 'America/New_York',
  'san francisco': 'America/Los_Angeles',
  'amsterdam': 'Europe/Amsterdam',
  'berlin': 'Europe/Berlin',
  'copenhagen': 'Europe/Copenhagen',

  // Tier 2
  'toronto': 'America/Toronto',
  'dublin': 'Europe/Dublin',
  'melbourne': 'Australia/Melbourne',
  'sydney': 'Australia/Sydney',
  'stockholm': 'Europe/Stockholm',
  'oslo': 'Europe/Oslo',
  'vienna': 'Europe/Vienna',

  // Tier 3
  'dubai': 'Asia/Dubai',
  'singapore': 'Asia/Singapore',
  'mumbai': 'Asia/Kolkata',
  'bangalore': 'Asia/Kolkata',
  'bengaluru': 'Asia/Kolkata',
  'delhi': 'Asia/Kolkata',
  'pune': 'Asia/Kolkata',
  'new delhi': 'Asia/Kolkata',
  'hyderabad': 'Asia/Kolkata',
  'chennai': 'Asia/Kolkata',

  // US cities
  'los angeles': 'America/Los_Angeles',
  'chicago': 'America/Chicago',
  'boston': 'America/New_York',
  'seattle': 'America/Los_Angeles',
  'austin': 'America/Chicago',
  'denver': 'America/Denver',
  'portland': 'America/Los_Angeles',
};

const COUNTRY_TIMEZONE_MAP: Record<string, string> = {
  'united kingdom': 'Europe/London',
  'united states': 'America/New_York',
  'canada': 'America/Toronto',
  'australia': 'Australia/Sydney',
  'germany': 'Europe/Berlin',
  'netherlands': 'Europe/Amsterdam',
  'denmark': 'Europe/Copenhagen',
  'sweden': 'Europe/Stockholm',
  'norway': 'Europe/Oslo',
  'austria': 'Europe/Vienna',
  'india': 'Asia/Kolkata',
  'united arab emirates': 'Asia/Dubai',
  'singapore': 'Asia/Singapore',
};

function getTimezone(city: string, country: string): string {
  const c = city.toLowerCase().trim();
  const co = country.toLowerCase().trim();
  return CITY_TIMEZONE_MAP[c] || COUNTRY_TIMEZONE_MAP[co] || 'UTC';
}

interface WindowEvaluation {
  isSendable: boolean;
  localTimeFormatted: string;
  timezone: string;
  reason: string;
}

function evaluateWindow(timezone: string, force: boolean): WindowEvaluation {
  const now = new Date();

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const partMap = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const hour = parseInt(partMap.hour === '24' ? '0' : partMap.hour, 10);
  const minute = parseInt(partMap.minute, 10);
  const weekday = partMap.weekday;

  const currentMin = hour * 60 + minute;
  const formatted = now.toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  if (force) {
    return {
      isSendable: true,
      localTimeFormatted: formatted,
      timezone,
      reason: `Force override active (${formatted} in ${timezone})`,
    };
  }

  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
  // Sendable window: weekday 7:30 AM to 11:30 AM local
  const isSendable = isWeekday && currentMin >= (7 * 60 + 30) && currentMin <= (11 * 60 + 30);

  let reason = '';
  if (!isWeekday) {
    reason = `Weekend (${formatted} in ${timezone})`;
  } else if (currentMin < (7 * 60 + 30)) {
    reason = `Too early in morning (${formatted} in ${timezone})`;
  } else if (currentMin > (11 * 60 + 30)) {
    reason = `Past morning window (${formatted} in ${timezone})`;
  } else {
    reason = `Active morning window (${formatted} in ${timezone})`;
  }

  return { isSendable, localTimeFormatted: formatted, timezone, reason };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createSmtpTransport(): Transporter {
  return createTransport({
    host: TITAN_SMTP_HOST,
    port: TITAN_SMTP_PORT,
    secure: false, // STARTTLS
    auth: {
      user: TITAN_EMAIL,
      pass: TITAN_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
}

function updateTrackerStatus(targetNumber: string, sentDate: string): void {
  const trackerPath = path.resolve(process.cwd(), 'OUTREACH_TRACKER.md');
  if (!fs.existsSync(trackerPath)) return;

  let content = fs.readFileSync(trackerPath, 'utf-8');
  
  // Calculate follow-up date (+3 days)
  const d = new Date(sentDate);
  d.setDate(d.getDate() + 3);
  const followUpDate = d.toISOString().split('T')[0];

  const lines = content.split('\n');
  const updatedLines = lines.map(line => {
    if (line.includes(`| **${targetNumber}** |`)) {
      const cols = line.split('|');
      if (cols.length >= 9) {
        cols[5] = ` ${sentDate} `;
        cols[6] = ` ${followUpDate} `;
        cols[7] = cols[7].replace(/SCHEDULED|DRAFTED/, 'SENT');
        return cols.join('|');
      }
    }
    return line;
  });

  content = updatedLines.join('\n');
  fs.writeFileSync(trackerPath, content);
  console.log(`  ✓ Updated Target #${targetNumber} to SENT in OUTREACH_TRACKER.md`);
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Kachmo Studios — Autonomous Cloud Outreach Dispatcher');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  const queuePath = path.resolve(process.cwd(), 'scheduled-queue.json');
  if (!fs.existsSync(queuePath)) {
    console.log('No scheduled-queue.json found. Queue is empty.');
    return;
  }

  const queue: EmailPayload[] = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
  if (queue.length === 0) {
    console.log('No emails in scheduled-queue.json. Nothing to dispatch.');
    return;
  }

  console.log(`Loaded ${queue.length} email(s) from scheduled-queue.json.\n`);

  const readyToSend: { payload: EmailPayload; evalResult: WindowEvaluation }[] = [];
  const remainingInQueue: EmailPayload[] = [];

  // Suppression safety check (fails closed): a missing or malformed list aborts the run before anything is sent.
  const suppressionPath = path.resolve(process.cwd(), 'database/suppression.json');
  if (!fs.existsSync(suppressionPath)) throw new Error('database/suppression.json missing — refusing to send');
  const suppressionList: Array<{ email?: string; domain?: string; target_number?: string; phone?: string; lead_id?: string }> = JSON.parse(fs.readFileSync(suppressionPath, 'utf-8'));
  if (!Array.isArray(suppressionList) || suppressionList.some(e => !e || typeof e !== 'object' || !(e.email || e.domain || e.target_number || e.phone || e.lead_id))) {
    throw new Error('database/suppression.json is malformed — refusing to send');
  }
  const host = (s?: string) => (s ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const suppressedEmails = new Set(suppressionList.map(e => (e.email ?? '').trim().toLowerCase()).filter(Boolean));
  const suppressedDomains = new Set(suppressionList.map(e => host(e.domain)).filter(Boolean));
  const suppressedTargets = new Set(suppressionList.map(e => e.target_number ?? '').filter(Boolean));
  const trackerFile = path.resolve(process.cwd(), 'OUTREACH_TRACKER.md');
  const trackerLines = fs.existsSync(trackerFile) ? fs.readFileSync(trackerFile, 'utf-8').split('\n') : [];

  for (const email of queue) {
    // Checked before the time window, so --force cannot bypass it. Blocked entries are not re-queued.
    const recipient = email.to.trim().toLowerCase();
    if (suppressedTargets.has(email.targetNumber) || suppressedEmails.has(recipient) || suppressedDomains.has(recipient.split('@')[1])) {
      console.log(`Target #${email.targetNumber} ${email.companyName} ⛔ suppressed — not sent`);
      continue;
    }
    if (trackerLines.some(l => l.includes(`| **${email.targetNumber}** |`) && /\*\*(SENT|FOLLOWED_UP|REPLIED_\w+)\*\*/.test(l))) {
      console.log(`Target #${email.targetNumber} ${email.companyName} ⛔ already sent per OUTREACH_TRACKER.md — not sent`);
      continue;
    }

    const tz = getTimezone(email.locationCity, email.locationCountry);
    const evalResult = evaluateWindow(tz, force);

    console.log(`Target #${email.targetNumber} ${email.companyName} (${email.locationCity})`);
    console.log(`  Timezone: ${tz} | ${evalResult.reason}`);

    if (evalResult.isSendable) {
      readyToSend.push({ payload: email, evalResult });
    } else {
      remainingInQueue.push(email);
    }
  }

  console.log(`\nReady to dispatch now: ${readyToSend.length}`);
  console.log(`Held for future window: ${remainingInQueue.length}\n`);

  if (readyToSend.length === 0) {
    console.log('No emails currently in their local morning window. Holding queue.');
    return;
  }

  if (dryRun) {
    console.log('🔍 [DRY RUN] Would dispatch the following:');
    for (const { payload, evalResult } of readyToSend) {
      console.log(`  #${payload.targetNumber} to ${payload.to} (${evalResult.reason})`);
    }
    return;
  }

  if (!TITAN_PASSWORD) {
    console.error('❌ TITAN_PASSWORD not configured. Aborting send.');
    process.exit(1);
  }

  const transporter = createSmtpTransport();
  await transporter.verify();
  console.log('✓ Connected to Titan SMTP.');

  const dispatchedTargets: string[] = [];
  const todayStr = new Date().toISOString().split('T')[0];

  for (let i = 0; i < readyToSend.length; i++) {
    const { payload, evalResult } = readyToSend[i];
    console.log(`\n📨 Dispatching #${payload.targetNumber} to ${payload.to}...`);

    try {
      const info = await transporter.sendMail({
        from: `"Dev & Aadi" <${TITAN_EMAIL}>`,
        to: payload.to,
        subject: payload.subject,
        text: payload.plainText,
        html: payload.htmlContent,
      });

      console.log(`  ✓ Sent! Message ID: ${info.messageId}`);
      updateTrackerStatus(payload.targetNumber, todayStr);
      dispatchedTargets.push(payload.targetNumber);
    } catch (err: any) {
      console.error(`  ❌ Failed to send to ${payload.to}: ${err.message}`);
      remainingInQueue.push(payload); // Re-queue on failure
    }

    if (i < readyToSend.length - 1) {
      console.log(`  ⏳ Throttling ${THROTTLE_DELAY_MS / 1000}s...`);
      await sleep(THROTTLE_DELAY_MS);
    }
  }

  // Update scheduled-queue.json with remaining
  fs.writeFileSync(queuePath, JSON.stringify(remainingInQueue, null, 2));
  console.log(`\n✓ Updated scheduled-queue.json (${remainingInQueue.length} emails remaining).`);
}

main().catch(err => {
  console.error('Fatal dispatch error:', err);
  process.exit(1);
});
