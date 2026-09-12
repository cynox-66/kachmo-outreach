/**
 * Titan Mail Draft Creator for Kachmo Studios
 *
 * Automatically connects to Titan Mail via IMAP (imap.secureserver.net:993)
 * and appends personalized, archetype-designed outreach emails directly into your Drafts folder.
 *
 * Usage:
 *   npx tsx scripts/create-titan-drafts.ts --targets=1,2,3,4,5
 *   npx tsx scripts/create-titan-drafts.ts --limit=5
 *   npx tsx scripts/create-titan-drafts.ts --all
 *   npx tsx scripts/create-titan-drafts.ts --limit=5 --fresh
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { ImapFlow } from 'imapflow';

// Load environment variables from .env
dotenv.config();

const TITAN_HOST = process.env.TITAN_IMAP_HOST || 'imap.secureserver.net';
const TITAN_PORT = parseInt(process.env.TITAN_IMAP_PORT || '993', 10);
const TITAN_EMAIL = process.env.TITAN_EMAIL || 'studios@kachmo.in';
const TITAN_PASSWORD = process.env.TITAN_PASSWORD;

interface TargetRecord {
  targetNumber: string;
  archetypeId: string;
  archetypeLabel: string;
  companyName: string;
  websiteUrl: string;
  locationCity: string;
  locationCountry: string;
  estimatedScale: string;
  decisionMakerName: string;
  decisionMakerTitle: string;
  contactRoute: string;
  commercialSignal: string;
  observableFriction: string;
  solutionAngle: string;
  personalizedHook: string;
}

/**
 * Parse CSV line handling commas inside quotes
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Load targets from kachmo_targets.csv
 */
function loadTargets(): TargetRecord[] {
  const currentDir = path.dirname(new URL(import.meta.url).pathname);
  const possiblePaths = [
    path.resolve(process.cwd(), 'kachmo_targets.csv'),
    path.resolve(process.cwd(), 'mails/kachmo_targets.csv'),
    path.resolve(process.cwd(), 'Clients/mails/kachmo_targets.csv'),
    path.resolve(currentDir, '../kachmo_targets.csv')
  ];

  const resolvedPath = possiblePaths.find(p => fs.existsSync(p));

  if (!resolvedPath) {
    throw new Error(`Could not find targets CSV. Checked: ${possiblePaths.join(', ')}`);
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  const records: TargetRecord[] = [];

  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length >= 15) {
      records.push({
        targetNumber: cols[0],
        archetypeId: cols[1],
        archetypeLabel: cols[2],
        companyName: cols[3],
        websiteUrl: cols[4],
        locationCity: cols[5],
        locationCountry: cols[6],
        estimatedScale: cols[7],
        decisionMakerName: cols[8],
        decisionMakerTitle: cols[9],
        contactRoute: cols[10],
        commercialSignal: cols[11],
        observableFriction: cols[12],
        solutionAngle: cols[13],
        personalizedHook: cols[14]
      });
    }
  }

  return records;
}

/**
 * Clean recipient email from contactRoute
 */
function extractRecipientEmail(contactRoute: string): string | null {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const match = contactRoute.match(emailRegex);
  return match ? match[0] : null;
}

/**
 * Build bespoke email copy and recipient-tailored HTML design
 * Complying strictly with kachmo-cold-outreach skill:
 * - NO em dashes
 * - NO AI buzzwords
 * - Hyper-friendly, peer-to-peer tone
 * - Under 100 words
 * - Archetype-specific aesthetic & signature
 */
function composeEmail(target: TargetRecord): { subject: string; plainText: string; htmlContent: string } {
  const firstName = target.decisionMakerName.split(' ')[0] || 'there';
  const isNamedPerson = !target.decisionMakerName.toLowerCase().includes('principal') && 
                        !target.decisionMakerName.toLowerCase().includes('founder') &&
                        !target.decisionMakerName.toLowerCase().includes('director');

  const greeting = isNamedPerson ? `Hey ${firstName},` : 'Hello,';

  let subject = '';
  let paragraphs: string[] = [];
  let signatureHtml = '';
  let signaturePlain = '';

  const arch = target.archetypeId;

  if (arch.startsWith('1')) {
    // Archetype 1: White-Label Agency Partner
    // Aesthetic: Swiss Minimalist / High Editorial Typography
    subject = `dev overflow for ${target.companyName}?`;
    paragraphs = [
      greeting,
      target.personalizedHook,
      `We run a small creative-tech studio in Pune called Kachmo. We basically act as the quiet engineering crew for brand studios when a client needs a custom, motion-heavy website in React and GSAP, but your team doesn't want to deal with hiring in-house devs.`,
      `Everything we do is totally invisible under NDA and mutual non-solicitation.`,
      `Curious if you ever run into dev overflow on client branding projects?`
    ];

    signatureHtml = `
      <div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid rgba(128, 128, 128, 0.28);">
        <div style="font-weight: 600; font-size: 14px;">Dev &amp; Aadi</div>
        <div style="font-size: 13px; margin-top: 3px; opacity: 0.85;">Kachmo Studios &middot; <a href="https://www.kachmo.in/" style="color: inherit; text-decoration: underline; font-weight: 500;">kachmo.in</a></div>
        <div class="kachmo-sub" style="font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: #888888; margin-top: 6px;">Motion Engineering &middot; React &middot; GSAP &middot; Invisible White-Label</div>
      </div>
    `;
    signaturePlain = `Dev & Aadi | Kachmo Studios\nMotion Engineering · React · GSAP · Invisible White-Label\nstudios@kachmo.in | https://www.kachmo.in/`;

  } else if (arch.startsWith('2')) {
    // Archetype 2: Funded Startup / Tech Lead
    // Aesthetic: Modern Tech Velocity / Speed & Performance Badge
    subject = `${target.companyName} first fold`;
    paragraphs = [
      greeting,
      target.personalizedHook,
      `Had a look at the site today. The tech depth is obvious, but for a founder landing on mobile, the core punch gets lost before they even scroll.`,
      `We build clean, motion-driven landing pages for fast-moving startups. Usually takes us about a week to turn a dense feature dump into a first screen that actually hooks people in 5 seconds.`,
      `Would love to mock up a quick take on your hero if you're open to seeing it.`
    ];

    signatureHtml = `
      <div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid rgba(128, 128, 128, 0.28);">
        <div style="font-weight: 600; font-size: 14px;">Dev &amp; Aadi</div>
        <div style="font-size: 13px; margin-top: 3px; opacity: 0.85;"><a href="https://www.kachmo.in/" style="color: inherit; text-decoration: underline; font-weight: 600;">Kachmo Studios</a> &middot; High-Performance Web</div>
        <div class="kachmo-badge" style="margin-top: 8px; display: inline-block; background-color: rgba(128, 128, 128, 0.12); border: 1px solid rgba(128, 128, 128, 0.25); padding: 4px 10px; border-radius: 6px; font-size: 11px; color: inherit; font-family: ui-monospace, Menlo, Monaco, monospace;">
          ⚡ 7-Day First Fold &middot; 95+ Core Web Vitals &middot; Next.js / GSAP
        </div>
      </div>
    `;
    signaturePlain = `Dev & Aadi | Kachmo Studios\nEngineering · Next.js · GSAP · 95+ Core Web Vitals\nstudios@kachmo.in | https://www.kachmo.in/`;

  } else if (arch.startsWith('3')) {
    // Archetype 3: Direct-to-Consumer / Luxury & Craft Brand
    // Aesthetic: Tactile Editorial Luxury & Scroll Narratives
    subject = `${target.companyName} digital experience`;
    paragraphs = [
      greeting,
      target.personalizedHook,
      `Your physical work and spaces are deeply considered, but the current web store presents it as a flat photo grid.`,
      `We engineer interactive scroll narratives in Next.js and GSAP that bring tactile craft and provenance directly into the browser.`,
      `Curious if you've ever thought about turning your catalog into an interactive journey?`
    ];

    signatureHtml = `
      <div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid rgba(128, 128, 128, 0.28);">
        <div style="font-weight: 600; font-size: 14px;">Dev &amp; Aadi</div>
        <div style="font-size: 13px; margin-top: 3px; opacity: 0.85;">Kachmo Studios &middot; <a href="https://www.kachmo.in/" style="color: inherit; text-decoration: underline;">kachmo.in</a></div>
        <div class="kachmo-sub" style="font-size: 12px; font-style: italic; color: #888888; margin-top: 5px;">Interactive digital craft &amp; scroll narratives</div>
      </div>
    `;
    signaturePlain = `Dev & Aadi | Kachmo Studios\nInteractive digital craft & scroll narratives\nstudios@kachmo.in | https://www.kachmo.in/`;

  } else if (arch.startsWith('4')) {
    // Archetype 4: High-Ticket Professional Services
    // Aesthetic: Executive Polish & Institutional Trust
    subject = `quick note on ${target.companyName}`;
    paragraphs = [
      greeting,
      target.personalizedHook,
      `We build clean, fast booking frontends for high-ticket practices with instant scheduling, mobile polish, and zero lag.`,
      `Happy to record a 60-second video showing how to streamline that consult path if helpful?`
    ];

    signatureHtml = `
      <div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid rgba(128, 128, 128, 0.28);">
        <div style="font-weight: 600; font-size: 14px;">Dev &amp; Aadi</div>
        <div style="font-size: 13px; margin-top: 3px; opacity: 0.85;">Kachmo Studios &middot; <a href="https://www.kachmo.in/" style="color: inherit; text-decoration: underline;">kachmo.in</a></div>
        <div class="kachmo-sub" style="font-size: 11px; color: #888888; margin-top: 5px; text-transform: uppercase; letter-spacing: 0.04em;">Frictionless Scheduling &middot; Flagship Digital Presence</div>
      </div>
    `;
    signaturePlain = `Dev & Aadi | Kachmo Studios\nFlagship Digital Presence & Scheduling\nstudios@kachmo.in | https://www.kachmo.in/`;

  } else {
    // Archetype 5: Zero-Presence / Local Commercial Upgrade
    // Aesthetic: Direct, Friendly & Approachable
    subject = `quick question about ${target.companyName}`;
    paragraphs = [
      greeting,
      target.personalizedHook,
      `We build clean, fast single-page flagship sites for local specialists: clear services, visible phone numbers, and instant booking so customers can find you directly.`,
      `Would a simple site that turns searchers into calls be useful for you?`
    ];

    signatureHtml = `
      <div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid rgba(128, 128, 128, 0.28);">
        <div style="font-weight: 600; font-size: 14px;">Dev &amp; Aadi</div>
        <div style="font-size: 13px; margin-top: 3px; opacity: 0.85;">Kachmo Studios &middot; <a href="https://www.kachmo.in/" style="color: inherit; text-decoration: underline;">kachmo.in</a></div>
        <div class="kachmo-sub" style="font-size: 12px; color: #888888; margin-top: 4px;">Pune, India &middot; studios@kachmo.in</div>
      </div>
    `;
    signaturePlain = `Dev & Aadi | Kachmo Studios\nPune, India · studios@kachmo.in | https://www.kachmo.in/`;
  }

  // Generate plain text version
  const plainText = paragraphs.join('\n\n') + '\n\n' + signaturePlain;

  // Generate HTML version with native Dark/Light Mode support
  const paragraphsHtml = paragraphs
    .map(p => `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.65;">${p}</p>`)
    .join('');

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    :root {
      color-scheme: light dark;
      supported-color-schemes: light dark;
    }
    @media (prefers-color-scheme: dark) {
      .kachmo-sub { color: #94a3b8 !important; }
      .kachmo-badge {
        background-color: rgba(255, 255, 255, 0.08) !important;
        border-color: rgba(255, 255, 255, 0.15) !important;
        color: #f1f5f9 !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; -webkit-font-smoothing: antialiased; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <div style="max-width: 580px; margin: 0; padding: 8px 0; font-size: 15px; line-height: 1.65;">
    ${paragraphsHtml}
    ${signatureHtml}
  </div>
</body>
</html>`;

  return { subject, plainText, htmlContent };
}

/**
 * Format RFC 822 multipart/alternative raw email buffer
 * Contains both plain-text and bespoke HTML representations
 */
function formatRfc822({
  from,
  to,
  subject,
  plainText,
  htmlContent
}: {
  from: string;
  to: string;
  subject: string;
  plainText: string;
  htmlContent: string;
}): Buffer {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  const date = new Date().toUTCString();

  const raw = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    plainText,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    htmlContent,
    '',
    `--${boundary}--`
  ].join('\r\n');

  return Buffer.from(raw, 'utf-8');
}

async function main() {
  console.log('─────────────────────────────────────────────────────────────────');
  console.log('  Kachmo Studios — Titan Mail Bespoke Auto-Draft Creator');
  console.log('─────────────────────────────────────────────────────────────────');

  if (!TITAN_PASSWORD) {
    console.error('\n❌ ERROR: TITAN_PASSWORD is not set in your .env file!');
    console.error('Please add the following to Clients/reachout/.env:');
    console.error('  TITAN_EMAIL=studios@kachmo.in');
    console.error('  TITAN_PASSWORD=your_titan_login_password\n');
    process.exit(1);
  }

  const allTargets = loadTargets();
  console.log(`Loaded ${allTargets.length} total targets from kachmo_targets.csv.`);

  // Parse CLI args
  const args = process.argv.slice(2);
  let selectedTargets: TargetRecord[] = [];

  const targetsArg = args.find(a => a.startsWith('--targets='));
  const limitArg = args.find(a => a.startsWith('--limit='));
  const archArg = args.find(a => a.startsWith('--archetype=') || a.startsWith('--arch='));
  const isAll = args.includes('--all');
  const isFresh = args.includes('--fresh') || args.includes('--replace');

  let candidates = allTargets.filter(t => extractRecipientEmail(t.contactRoute) !== null);

  if (archArg) {
    const val = (archArg.split('=')[1] || '').trim();
    candidates = candidates.filter(t => t.archetypeId.startsWith(val));
  }

  if (targetsArg) {
    const targetNums = targetsArg.split('=')[1].split(',').map(n => n.trim().padStart(3, '0'));
    selectedTargets = allTargets.filter(t => targetNums.includes(t.targetNumber.padStart(3, '0')));
  } else if (limitArg) {
    const limit = parseInt(limitArg.split('=')[1], 10) || 5;
    selectedTargets = candidates.slice(0, limit);
  } else if (isAll) {
    selectedTargets = candidates;
  } else {
    // Default: First 5 candidates with valid emails
    selectedTargets = candidates.slice(0, 5);
  }

  console.log(`Selected ${selectedTargets.length} targets to draft in Titan Mail.`);

  // Connect to Titan via IMAP
  console.log(`Connecting to ${TITAN_HOST}:${TITAN_PORT} as ${TITAN_EMAIL}...`);

  const client = new ImapFlow({
    host: TITAN_HOST,
    port: TITAN_PORT,
    secure: true,
    auth: {
      user: TITAN_EMAIL,
      pass: TITAN_PASSWORD
    },
    logger: false
  });

  try {
    await client.connect();
    console.log('✓ Successfully authenticated with Titan Mail via IMAP!');

    // Find Drafts mailbox
    const mailboxes = await client.list();
    let draftsBox = 'Drafts';

    for (const m of mailboxes) {
      if (m.specialUse === '\\Drafts' || m.name.toLowerCase().includes('draft')) {
        draftsBox = m.path;
        break;
      }
    }

    console.log(`Targeting mailbox: "${draftsBox}"`);

    // If --fresh is requested, clear previous drafts first
    if (isFresh) {
      const lock = await client.getMailboxLock(draftsBox);
      try {
        const status = await client.status(draftsBox, { messages: true });
        if (status.messages && status.messages > 0) {
          console.log(`Clearing ${status.messages} existing draft(s) in "${draftsBox}" (--fresh mode)...`);
          await client.messageDelete('1:*');
        }
      } finally {
        lock.release();
      }
    }

    let draftedCount = 0;

    for (const target of selectedTargets) {
      const recipientEmail = extractRecipientEmail(target.contactRoute);
      if (!recipientEmail) {
        console.log(`⚠️  Target #${target.targetNumber} (${target.companyName}) has no public email (contact form only). Skipping draft.`);
        continue;
      }

      const { subject, plainText, htmlContent } = composeEmail(target);
      const rfc822 = formatRfc822({
        from: `Dev & Aadi <${TITAN_EMAIL}>`,
        to: recipientEmail,
        subject,
        plainText,
        htmlContent
      });

      await client.append(draftsBox, rfc822, ['\\Draft', '\\Seen']);
      draftedCount++;
      console.log(`  ✓ Drafted [Arch-${target.archetypeId[0]}]: #${target.targetNumber} | To: ${recipientEmail} | Subject: "${subject}"`);
    }

    console.log('\n─────────────────────────────────────────────────────────────────');
    console.log(`🎉 SUCCESS: ${draftedCount} bespoke archetype-designed draft(s) created in Titan Mail!`);
    console.log(`👉 Refresh your Titan Mail tab (secureserver.titan.email/mail/), open "Drafts", and view your new drafts!`);
    console.log('─────────────────────────────────────────────────────────────────\n');

  } catch (err: any) {
    const errorDetails = err.responseText || err.message || String(err);
    console.error('\n❌ Failed to create drafts via Titan IMAP:', errorDetails);

    if (errorDetails.includes('AuthenticationError') || (err.message && err.message.includes('AUTHENTICATE'))) {
      console.error('\n📋 Titan Authentication Troubleshooting:');
      console.error('  1. Third-Party App Access:');
      console.error('     In your Titan Webmail tab (secureserver.titan.email/mail/):');
      console.error('     Click Settings (gear icon) ➔ Look for "Enable Titan on Other Apps" or "Preferences".');
      console.error('     Ensure third-party app access / IMAP access is enabled.');
      console.error('  2. App Password (if 2FA is active):');
      console.error('     If you have Two-Factor Authentication (2FA) enabled on Titan, your regular');
      console.error('     password will NOT work for IMAP. Go to Settings ➔ Security ➔ Generate App Password,');
      console.error('     and paste that password into Clients/reachout/.env as TITAN_PASSWORD.');
      console.error('  3. Password Verification:');
      console.error('     Ensure TITAN_PASSWORD in Clients/reachout/.env matches your Titan login or app password.\n');
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

main().catch(console.error);
