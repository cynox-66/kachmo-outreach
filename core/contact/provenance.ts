import type { KachmoLead, ContactProvenance } from '../leads/schema.js';

/** The only provenance levels allowed to drive a call or a WhatsApp message. */
export const OUTREACH_USABLE: ReadonlySet<ContactProvenance> = new Set<ContactProvenance>(['PUBLICLY_LISTED', 'VERIFIED']);

const NO_CONTACT_LOCALS = new Set([
  'support', 'care', 'help', 'billing', 'customerservice', 'customer.service', 'abuse', 'noreply', 'no-reply',
  'donotreply', 'do-not-reply', 'privacy', 'legal', 'accounts', 'careers', 'jobs', 'hr',
]);

const GENERIC_LOCALS = new Set([
  'info', 'hello', 'hi', 'hey', 'contact', 'contactus', 'enquiries', 'enquiry', 'inquiries', 'inquiry', 'office',
  'studio', 'team', 'admin', 'mail', 'sales', 'reservation', 'reservations', 'bookings', 'booking', 'business',
  'partnership', 'partnerships', 'press', 'media', 'general', 'reception', 'us', 'dev', 'founders', 'work', 'new',
  'newbusiness', 'new.business', 'appointments', 'marketing', 'hola', 'bonjour',
]);

/** Hosts that identify a platform, directory or mailbox provider rather than the prospect's own business. */
const PLATFORM_HOSTS = [
  'company-information.service.gov.uk', 'gov.uk', 'mybuilder.com', 'calendly.com', 'cal.com', 'linkedin.com',
  'instagram.com', 'facebook.com', 'twitter.com', 'x.com', 'github.com', 'google.com', '192.com', 'rooplex.co.uk',
  'northdata.com', 'kitomba.com', 'justdial.com', 'indiamart.com', 'practo.com', 'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'icloud.com', 'rediffmail.com', 'proton.me',
];

/**
 * True when the string is shaped like an http(s) URL. This is a FORMAT check only: it does not prove the URL
 * exists or supports the claim it is attached to (see core/README.md, "Known v1.0 evidence limitation").
 */
export function isUrl(s?: string | null): boolean {
  return !!s && /^https?:\/\/[^\s/]+\.[^\s]+/i.test(s.trim());
}

export function normalizeEmail(e?: string | null): string | null {
  const m = e?.trim().toLowerCase();
  return m && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m) ? m : null;
}

/** Comparable phone key: last 10 digits. Deliberately loose — for suppression, over-matching is the safe direction. */
export function phoneKey(p?: string | null): string | null {
  if (!p) return null;
  let d = p.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  return d.length >= 10 ? d.slice(-10) : null;
}

export function normalizeDomain(input?: string | null): string | null {
  if (!input) return null;
  const s = input.trim();
  let host: string;
  try {
    const candidate = /^https?:\/\//i.test(s) ? s : `https://${s.includes('@') ? s.split('@').pop() : s}`;
    host = new URL(candidate).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/^www\./, '');
  if (!host.includes('.')) return null;
  if (PLATFORM_HOSTS.some(h => host === h || host.endsWith('.' + h))) return null;
  return host;
}

export type EmailClass = 'NONE' | 'NO_CONTACT' | 'GENERIC' | 'PERSONAL';

export function classifyEmail(email?: string | null): EmailClass {
  const e = normalizeEmail(email);
  if (!e) return 'NONE';
  const local = e.split('@')[0];
  if (NO_CONTACT_LOCALS.has(local)) return 'NO_CONTACT';
  if (GENERIC_LOCALS.has(local)) return 'GENERIC';
  return 'PERSONAL';
}

const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com',
  'rediffmail.com', 'proton.me', 'protonmail.com', 'aol.com',
]);

export type EmailRouteQuality = 'NONE' | 'INVALID' | 'INFERRED' | 'NO_CONTACT' | 'GENERIC' | 'UNSOURCED_FREEMAIL' | 'DIRECT';

export function emailRoute(lead: KachmoLead): { quality: EmailRouteQuality; detail: string } {
  const e = normalizeEmail(lead.decision_maker_email);
  if (!e) return { quality: 'NONE', detail: 'no email on file' };
  if (lead.email_status === 'INVALID') return { quality: 'INVALID', detail: 'email marked INVALID (bounced)' };
  if (lead.email_status === 'INFERRED') return { quality: 'INFERRED', detail: 'email is pattern-inferred, not found' };
  const cls = classifyEmail(e);
  if (cls === 'NO_CONTACT') return { quality: 'NO_CONTACT', detail: `${e.split('@')[0]}@ is a support/no-reply mailbox` };
  if (cls === 'GENERIC') return { quality: 'GENERIC', detail: `${e.split('@')[0]}@ is a shared mailbox, not the decision-maker` };
  // A private Gmail/Yahoo address attributed to a named person with no source is the easiest fact to fabricate.
  if (FREEMAIL_DOMAINS.has(e.split('@')[1]) && lead.email_status !== 'PUBLICLY_LISTED' && lead.email_status !== 'VERIFIED') {
    return { quality: 'UNSOURCED_FREEMAIL', detail: 'personal freemail address with no recorded source; verify before use' };
  }
  return { quality: 'DIRECT', detail: `personal address (provenance ${lead.email_status})` };
}

export function phoneEligibility(lead: KachmoLead): { ok: boolean; reason: string } {
  if (!phoneKey(lead.decision_maker_phone)) return { ok: false, reason: 'no phone on file' };
  const status = lead.phone_status;
  if (!OUTREACH_USABLE.has(status)) {
    return { ok: false, reason: `phone provenance is ${status}; needs PUBLICLY_LISTED (source URL) or VERIFIED (basis)` };
  }
  if (status === 'PUBLICLY_LISTED' && !isUrl(lead.phone_source)) {
    return { ok: false, reason: 'phone marked PUBLICLY_LISTED but phone_source is not a URL' };
  }
  if (status === 'VERIFIED' && !lead.phone_verification_basis?.trim()) {
    return { ok: false, reason: 'phone marked VERIFIED but no verification basis recorded' };
  }
  return { ok: true, reason: `phone ${status}` };
}

export function whatsappEligibility(lead: KachmoLead): { ok: boolean; reason: string } {
  const phone = phoneEligibility(lead);
  if (!phone.ok) return phone;
  if (!lead.whatsapp_basis) {
    return { ok: false, reason: 'no WhatsApp basis (business-advertised WhatsApp with URL, or permission given on a call)' };
  }
  if (lead.whatsapp_basis === 'BUSINESS_LISTED_WHATSAPP' && !isUrl(lead.whatsapp_basis_source)) {
    return { ok: false, reason: 'BUSINESS_LISTED_WHATSAPP requires whatsapp_basis_source URL' };
  }
  if (lead.whatsapp_basis === 'PERMISSION_GIVEN_ON_CALL' && !lead.whatsapp_basis_source?.trim()) {
    return { ok: false, reason: 'PERMISSION_GIVEN_ON_CALL requires a note of when permission was given' };
  }
  return { ok: true, reason: lead.whatsapp_basis };
}
