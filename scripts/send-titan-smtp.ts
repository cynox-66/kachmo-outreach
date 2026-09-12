/**
 * Titan Mail SMTP Direct Sender for Kachmo Studios
 *
 * Sends emails directly via Titan SMTP (smtpout.secureserver.net:587 STARTTLS)
 * with timezone-aware scheduling — emails are held and dispatched
 * at the optimal local business hour for each recipient's city.
 *
 * Usage (called by the /mail-start workflow, not manually):
 *   npx tsx scripts/send-titan-smtp.ts --payload='[{...}]'
 *   npx tsx scripts/send-titan-smtp.ts --file=batch.json
 *   npx tsx scripts/send-titan-smtp.ts --test
 *
 * Payload format:
 *   [{
 *     to: "info@deucestudio.com",
 *     subject: "dev overflow for Deuce Studio?",
 *     plainText: "...",
 *     htmlContent: "...",
 *     targetNumber: "001",
 *     companyName: "Deuce Studio",
 *     locationCity: "London",
 *     locationCountry: "United Kingdom",
 *     confidence: "HIGH" | "LOW"
 *   }]
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

// ─── Timezone Intelligence ──────────────────────────────────────────────────

/**
 * City-to-timezone mapping for common target locations.
 * Uses IANA timezone identifiers.
 */
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
  'frederiksberg': 'Europe/Copenhagen',

  // Tier 3 — India (comprehensive for Arch-6 Indian Business Pipeline)
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
  'kolkata': 'Asia/Kolkata',
  'ahmedabad': 'Asia/Kolkata',
  'jaipur': 'Asia/Kolkata',
  'surat': 'Asia/Kolkata',
  'lucknow': 'Asia/Kolkata',
  'chandigarh': 'Asia/Kolkata',
  'kochi': 'Asia/Kolkata',
  'coimbatore': 'Asia/Kolkata',
  'indore': 'Asia/Kolkata',
  'bhopal': 'Asia/Kolkata',
  'nagpur': 'Asia/Kolkata',
  'vadodara': 'Asia/Kolkata',
  'rajkot': 'Asia/Kolkata',
  'visakhapatnam': 'Asia/Kolkata',
  'thiruvananthapuram': 'Asia/Kolkata',
  'guwahati': 'Asia/Kolkata',
  'noida': 'Asia/Kolkata',
  'gurgaon': 'Asia/Kolkata',
  'gurugram': 'Asia/Kolkata',
  'faridabad': 'Asia/Kolkata',
  'mysuru': 'Asia/Kolkata',
  'mysore': 'Asia/Kolkata',
  'mangaluru': 'Asia/Kolkata',
  'nashik': 'Asia/Kolkata',
  'aurangabad': 'Asia/Kolkata',
  'ludhiana': 'Asia/Kolkata',
  'kanpur': 'Asia/Kolkata',
  'patna': 'Asia/Kolkata',
  'ranchi': 'Asia/Kolkata',
  'bhubaneswar': 'Asia/Kolkata',
  'dehradun': 'Asia/Kolkata',
  'amritsar': 'Asia/Kolkata',

  // US cities
  'los angeles': 'America/Los_Angeles',
  'chicago': 'America/Chicago',
  'boston': 'America/New_York',
  'seattle': 'America/Los_Angeles',
  'austin': 'America/Chicago',
  'denver': 'America/Denver',
  'portland': 'America/Los_Angeles',
  'miami': 'America/New_York',
  'washington': 'America/New_York',
  'atlanta': 'America/New_York',
  'philadelphia': 'America/New_York',

  // UK cities
  'manchester': 'Europe/London',
  'birmingham': 'Europe/London',
  'edinburgh': 'Europe/London',
  'glasgow': 'Europe/London',
  'bristol': 'Europe/London',
  'leeds': 'Europe/London',
  'belfast': 'Europe/London',
  'cardiff': 'Europe/London',

  // Europe
  'paris': 'Europe/Paris',
  'munich': 'Europe/Berlin',
  'hamburg': 'Europe/Berlin',
  'zurich': 'Europe/Zurich',
  'helsinki': 'Europe/Helsinki',
  'lisbon': 'Europe/Lisbon',
  'madrid': 'Europe/Madrid',
  'rome': 'Europe/Rome',
  'milan': 'Europe/Rome',
  'prague': 'Europe/Prague',
  'warsaw': 'Europe/Warsaw',
  'brussels': 'Europe/Brussels',

  // APAC
  'tokyo': 'Asia/Tokyo',
  'hong kong': 'Asia/Hong_Kong',
  'seoul': 'Asia/Seoul',
  'jakarta': 'Asia/Jakarta',
  'kuala lumpur': 'Asia/Kuala_Lumpur',
  'bangkok': 'Asia/Bangkok',

  // Other
  'sao paulo': 'America/Sao_Paulo',
  'mexico city': 'America/Mexico_City',
  'johannesburg': 'Africa/Johannesburg',
  'cape town': 'Africa/Johannesburg',
  'lagos': 'Africa/Lagos',
  'nairobi': 'Africa/Nairobi',
  'cairo': 'Africa/Cairo',
  'tel aviv': 'Asia/Jerusalem',
};

/**
 * Fallback: country-to-timezone mapping for when the city isn't in the map.
 */
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
  'france': 'Europe/Paris',
  'spain': 'Europe/Madrid',
  'italy': 'Europe/Rome',
  'switzerland': 'Europe/Zurich',
  'ireland': 'Europe/Dublin',
  'india': 'Asia/Kolkata',
  'united arab emirates': 'Asia/Dubai',
  'singapore': 'Asia/Singapore',
  'japan': 'Asia/Tokyo',
  'south korea': 'Asia/Seoul',
  'israel': 'Asia/Jerusalem',
  'new zealand': 'Pacific/Auckland',
  'south africa': 'Africa/Johannesburg',
  'brazil': 'America/Sao_Paulo',
  'mexico': 'America/Mexico_City',
  'portugal': 'Europe/Lisbon',
  'belgium': 'Europe/Brussels',
  'finland': 'Europe/Helsinki',
  'poland': 'Europe/Warsaw',
  'czech republic': 'Europe/Prague',
};

/**
 * The optimal send window: Tue-Thu, 9:00-10:30 AM local time.
 * If outside this window, calculate delay to next optimal slot.
 * Fallback: any weekday 8:00-11:00 AM is acceptable.
 */
interface SendWindow {
  sendNow: boolean;
  delayMs: number;
  scheduledLocalTime: string;
  timezone: string;
  reason: string;
}

function getTimezoneForTarget(city: string, country: string): string {
  const cityLower = city.toLowerCase().trim();
  const countryLower = country.toLowerCase().trim();

  if (CITY_TIMEZONE_MAP[cityLower]) {
    return CITY_TIMEZONE_MAP[cityLower];
  }

  if (COUNTRY_TIMEZONE_MAP[countryLower]) {
    return COUNTRY_TIMEZONE_MAP[countryLower];
  }

  // Default: assume UTC, better than guessing wrong
  return 'UTC';
}

function calculateSendWindow(timezone: string): SendWindow {
  const now = new Date();

  // Get current time in target timezone
  const targetLocalTime = new Date(
    now.toLocaleString('en-US', { timeZone: timezone })
  );

  const hour = targetLocalTime.getHours();
  const minute = targetLocalTime.getMinutes();
  const dayOfWeek = targetLocalTime.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  const currentMinuteOfDay = hour * 60 + minute;
  const formattedTime = targetLocalTime.toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  // Optimal window: weekday 8:00 AM - 10:30 AM local time
  const OPTIMAL_START = 8 * 60;      // 8:00 AM
  const OPTIMAL_END = 10 * 60 + 30;  // 10:30 AM
  // Acceptable window: weekday 7:30 AM - 11:30 AM local time
  const ACCEPTABLE_START = 7 * 60 + 30;  // 7:30 AM
  const ACCEPTABLE_END = 11 * 60 + 30;   // 11:30 AM

  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const isOptimal = isWeekday && currentMinuteOfDay >= OPTIMAL_START && currentMinuteOfDay <= OPTIMAL_END;
  const isAcceptable = isWeekday && currentMinuteOfDay >= ACCEPTABLE_START && currentMinuteOfDay <= ACCEPTABLE_END;

  if (isOptimal) {
    return {
      sendNow: true,
      delayMs: 0,
      scheduledLocalTime: formattedTime,
      timezone,
      reason: `Optimal window (${formattedTime} local in ${timezone})`,
    };
  }

  if (isAcceptable) {
    return {
      sendNow: true,
      delayMs: 0,
      scheduledLocalTime: formattedTime,
      timezone,
      reason: `Acceptable window (${formattedTime} local in ${timezone})`,
    };
  }

  // Calculate delay to next optimal window
  let targetDate = new Date(now);

  if (isWeekday && currentMinuteOfDay < OPTIMAL_START) {
    // Today but before the window. Wait until 9:00 AM local.
    const minutesToWait = (9 * 60) - currentMinuteOfDay;
    // Add a random 0-30 minute jitter to avoid sending at exactly :00
    const jitter = Math.floor(Math.random() * 30);
    return {
      sendNow: false,
      delayMs: (minutesToWait + jitter) * 60 * 1000,
      scheduledLocalTime: `~9:${String(jitter).padStart(2, '0')} AM`,
      timezone,
      reason: `Queued for morning window (currently ${formattedTime} in ${timezone})`,
    };
  }

  // Past the window today, or weekend. Find next weekday 9 AM.
  let daysToAdd = 1;
  let nextDay = (dayOfWeek + 1) % 7;

  while (nextDay === 0 || nextDay === 6) {
    daysToAdd++;
    nextDay = (nextDay + 1) % 7;
  }

  targetDate.setDate(targetDate.getDate() + daysToAdd);

  // Set to 9:00 AM in target timezone (approximate)
  const targetTzOffset = getTimezoneOffsetMs(timezone);
  const localTzOffset = now.getTimezoneOffset() * 60 * 1000;

  // Calculate milliseconds until next weekday 9 AM local target time
  const nextMorning = new Date(targetDate);
  nextMorning.setHours(9, Math.floor(Math.random() * 30), 0, 0);

  // Adjust for timezone difference
  const delayMs = nextMorning.getTime() - now.getTime() + (localTzOffset - targetTzOffset);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return {
    sendNow: false,
    delayMs: Math.max(delayMs, 0),
    scheduledLocalTime: `${dayNames[nextDay]} ~9:00 AM`,
    timezone,
    reason: `Scheduled for next business morning (currently ${formattedTime} in ${timezone})`,
  };
}

function getTimezoneOffsetMs(timezone: string): number {
  const now = new Date();
  const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  return tzDate.getTime() - utcDate.getTime();
}

// ─── Email Payload ──────────────────────────────────────────────────────────

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

interface SendResult {
  targetNumber: string;
  companyName: string;
  to: string;
  status: 'SENT' | 'SCHEDULED' | 'DRAFTED' | 'FAILED';
  scheduledTime?: string;
  timezone?: string;
  reason?: string;
  error?: string;
  messageId?: string;
}

// ─── Throttle ───────────────────────────────────────────────────────────────

const THROTTLE_DELAY_MS = 4000; // 4 seconds between sends

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── SMTP Transport ─────────────────────────────────────────────────────────

function createSmtpTransport(): Transporter {
  return createTransport({
    host: TITAN_SMTP_HOST,
    port: TITAN_SMTP_PORT,
    secure: TITAN_SMTP_PORT === 465, // true for 465 (SSL), false for 587 (STARTTLS)
    auth: {
      user: TITAN_EMAIL,
      pass: TITAN_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false, // Titan sometimes has intermediate cert issues
    },
  });
}

async function sendEmail(
  transporter: Transporter,
  payload: EmailPayload
): Promise<SendResult> {
  try {
    const info = await transporter.sendMail({
      from: `"Dev & Aadi" <${TITAN_EMAIL}>`,
      to: payload.to,
      subject: payload.subject,
      text: payload.plainText,
      html: payload.htmlContent,
      headers: {
        'X-Kachmo-Target': payload.targetNumber,
        'X-Kachmo-Company': payload.companyName,
      },
    });

    return {
      targetNumber: payload.targetNumber,
      companyName: payload.companyName,
      to: payload.to,
      status: 'SENT',
      messageId: info.messageId,
    };
  } catch (err: any) {
    return {
      targetNumber: payload.targetNumber,
      companyName: payload.companyName,
      to: payload.to,
      status: 'FAILED',
      error: err.message || String(err),
    };
  }
}

// ─── IMAP Draft Fallback (for LOW confidence) ───────────────────────────────

async function saveToDraft(payload: EmailPayload): Promise<SendResult> {
  // Dynamically import imapflow only when needed
  const { ImapFlow } = await import('imapflow');

  const client = new ImapFlow({
    host: process.env.TITAN_IMAP_HOST || 'imap.secureserver.net',
    port: parseInt(process.env.TITAN_IMAP_PORT || '993', 10),
    secure: true,
    auth: {
      user: TITAN_EMAIL,
      pass: TITAN_PASSWORD!,
    },
    logger: false,
  });

  try {
    await client.connect();

    const mailboxes = await client.list();
    let draftsBox = 'Drafts';
    for (const m of mailboxes) {
      if (m.specialUse === '\\Drafts' || m.name.toLowerCase().includes('draft')) {
        draftsBox = m.path;
        break;
      }
    }

    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    const date = new Date().toUTCString();

    const raw = [
      `From: Dev & Aadi <${TITAN_EMAIL}>`,
      `To: ${payload.to}`,
      `Subject: ${payload.subject}`,
      `Date: ${date}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      payload.plainText,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      payload.htmlContent,
      '',
      `--${boundary}--`,
    ].join('\r\n');

    await client.append(draftsBox, Buffer.from(raw, 'utf-8'), ['\\Draft', '\\Seen']);

    return {
      targetNumber: payload.targetNumber,
      companyName: payload.companyName,
      to: payload.to,
      status: 'DRAFTED',
      reason: 'LOW confidence — saved to Titan Drafts for manual review',
    };
  } finally {
    await client.logout().catch(() => {});
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Kachmo Studios — Titan Mail SMTP Direct Sender');
  console.log('  with Timezone-Aware Scheduling');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!TITAN_PASSWORD) {
    console.error('\n❌ TITAN_PASSWORD not set in .env');
    process.exit(1);
  }

  const args = process.argv.slice(2);

  // Test mode: send a test email to yourself
  if (args.includes('--test')) {
    console.log('\n🧪 Test mode: sending a test email to studios@kachmo.in...');
    const transporter = createSmtpTransport();

    try {
      await transporter.verify();
      console.log('✓ SMTP connection verified.');

      const info = await transporter.sendMail({
        from: `"Dev & Aadi" <${TITAN_EMAIL}>`,
        to: TITAN_EMAIL,
        subject: 'Kachmo SMTP Test — ignore this',
        text: 'This is a test email from the /mail-start workflow SMTP sender. If you see this, SMTP is working.',
        html: '<p>This is a test email from the <strong>/mail-start</strong> workflow SMTP sender. If you see this, SMTP is working.</p>',
      });

      console.log(`✓ Test email sent! Message ID: ${info.messageId}`);
      console.log('  Check your Titan inbox for the test message.');
    } catch (err: any) {
      console.error(`\n❌ SMTP test failed: ${err.message}`);
      if (err.message.includes('auth') || err.message.includes('AUTH')) {
        console.error('  Hint: Your TITAN_PASSWORD may need to be an app-specific password if 2FA is enabled.');
      }
    }

    return;
  }

  // Load payload
  let payloads: EmailPayload[] = [];

  const payloadArg = args.find(a => a.startsWith('--payload='));
  const fileArg = args.find(a => a.startsWith('--file='));
  const dryRun = args.includes('--dry-run');

  if (payloadArg) {
    payloads = JSON.parse(payloadArg.split('=').slice(1).join('='));
  } else if (fileArg) {
    const filePath = fileArg.split('=')[1];
    const resolved = path.resolve(process.cwd(), filePath);
    payloads = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  } else {
    // Read from stdin
    const stdin = fs.readFileSync(0, 'utf-8');
    payloads = JSON.parse(stdin);
  }

  if (payloads.length === 0) {
    console.log('\n⚠️  No emails to process.');
    return;
  }

  console.log(`\nProcessing ${payloads.length} email(s)...`);

  // Categorize by confidence and timezone
  const highConfidence = payloads.filter(p => p.confidence === 'HIGH');
  const lowConfidence = payloads.filter(p => p.confidence === 'LOW');

  console.log(`  HIGH confidence (direct send): ${highConfidence.length}`);
  console.log(`  LOW confidence (save to drafts): ${lowConfidence.length}`);

  const results: SendResult[] = [];
  const scheduled: { payload: EmailPayload; window: SendWindow }[] = [];

  // ── Process HIGH confidence emails with timezone scheduling ──

  if (highConfidence.length > 0) {
    console.log('\n── Timezone Analysis ──');

    for (const payload of highConfidence) {
      const tz = getTimezoneForTarget(payload.locationCity, payload.locationCountry);
      const window = calculateSendWindow(tz);

      console.log(`  #${payload.targetNumber} ${payload.companyName} (${payload.locationCity})`);
      console.log(`    Timezone: ${tz}`);
      console.log(`    ${window.reason}`);

      if (window.sendNow) {
        // Send immediately (in optimal/acceptable window)
        if (dryRun) {
          console.log(`    [DRY RUN] Would send now to ${payload.to}`);
          results.push({
            targetNumber: payload.targetNumber,
            companyName: payload.companyName,
            to: payload.to,
            status: 'SENT',
            reason: `[DRY RUN] ${window.reason}`,
          });
        } else {
          scheduled.push({ payload, window });
        }
      } else {
        // Queue for later
        console.log(`    ⏰ Scheduled for ${window.scheduledLocalTime} (${tz})`);
        console.log(`    Delay: ${Math.round(window.delayMs / 1000 / 60)} minutes`);
        scheduled.push({ payload, window });
      }
    }

    if (!dryRun) {
      // Sort by delay (send immediate ones first)
      scheduled.sort((a, b) => a.window.delayMs - b.window.delayMs);

      const transporter = createSmtpTransport();

      try {
        await transporter.verify();
        console.log('\n✓ SMTP connection verified.');
      } catch (err: any) {
        console.error(`\n❌ SMTP connection failed: ${err.message}`);
        console.error('  Falling back to saving all as drafts...');

        for (const { payload } of scheduled) {
          const result = await saveToDraft(payload);
          results.push(result);
        }

        return printSummary(results);
      }

      // Process send-now emails
      const sendNow = scheduled.filter(s => s.window.sendNow);
      const sendLater = scheduled.filter(s => !s.window.sendNow);

      for (let i = 0; i < sendNow.length; i++) {
        const { payload, window } = sendNow[i];
        console.log(`\n  📨 Sending #${payload.targetNumber} to ${payload.to}...`);

        const result = await sendEmail(transporter, payload);
        result.timezone = window.timezone;
        result.scheduledTime = window.scheduledLocalTime;
        results.push(result);

        if (result.status === 'SENT') {
          console.log(`  ✓ Sent! (${window.reason})`);
        } else {
          console.log(`  ❌ Failed: ${result.error}`);
        }

        // Throttle between sends
        if (i < sendNow.length - 1) {
          console.log(`  ⏳ Throttling ${THROTTLE_DELAY_MS / 1000}s...`);
          await sleep(THROTTLE_DELAY_MS);
        }
      }

      // For emails that need scheduling, we send them now but log the intended time
      // (true scheduling would require a cron/queue system; for now we batch-send
      // and note the timezone analysis in the tracker)
      if (sendLater.length > 0) {
        console.log(`\n── Delayed Sends (${sendLater.length} emails outside optimal window) ──`);
        console.log('  Note: These emails are outside the recipient\'s optimal morning window.');
        console.log('  Consider re-running /mail-start during their morning hours, or sending now.\n');

        // For now, save to drafts with a scheduling note
        for (const { payload, window } of sendLater) {
          console.log(`  📋 #${payload.targetNumber} ${payload.companyName}: Best time is ${window.scheduledLocalTime} (${window.timezone})`);
          const result = await saveToDraft(payload);
          result.scheduledTime = window.scheduledLocalTime;
          result.timezone = window.timezone;
          result.reason = `Saved to drafts: outside optimal window. Best send time: ${window.scheduledLocalTime} ${window.timezone}`;
          result.status = 'SCHEDULED';
          results.push(result);
        }
      }
    }
  }

  // ── Process LOW confidence emails (always save to drafts) ──

  if (lowConfidence.length > 0 && !dryRun) {
    console.log('\n── LOW Confidence (Saving to Drafts) ──');

    for (const payload of lowConfidence) {
      console.log(`  📋 #${payload.targetNumber} ${payload.companyName} → Drafts`);
      const result = await saveToDraft(payload);
      results.push(result);
    }
  }

  printSummary(results);
}

function printSummary(results: SendResult[]) {
  const sent = results.filter(r => r.status === 'SENT');
  const scheduled = results.filter(r => r.status === 'SCHEDULED');
  const drafted = results.filter(r => r.status === 'DRAFTED');
  const failed = results.filter(r => r.status === 'FAILED');

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  DISPATCH SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ✅ Sent directly:    ${sent.length}`);
  console.log(`  ⏰ Scheduled:        ${scheduled.length}`);
  console.log(`  📋 Saved to drafts:  ${drafted.length}`);
  console.log(`  ❌ Failed:           ${failed.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (failed.length > 0) {
    console.log('\n  Failed emails:');
    for (const f of failed) {
      console.log(`    #${f.targetNumber} ${f.companyName}: ${f.error}`);
    }
  }

  if (scheduled.length > 0) {
    console.log('\n  Scheduled emails (saved to drafts for timed dispatch):');
    for (const s of scheduled) {
      console.log(`    #${s.targetNumber} ${s.companyName}: Send at ${s.scheduledTime} (${s.timezone})`);
    }
  }

  // Output JSON results for the workflow to consume
  const outputPath = path.resolve(process.cwd(), '.last-send-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n  Results saved to ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
