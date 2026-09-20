import type { KachmoLead, ContactProvenance } from '@kachmo/core/leads/schema.js';
import { OUTREACH_USABLE } from '@kachmo/core/contact/provenance.js';
import type { Actor } from '../authz/authorize';

/**
 * THE SINGLE PLACE CONTACT VALUES ARE REVEALED.
 *
 * Interns and viewers must never see a prospect's email address or phone number. That is enforced here, once, on
 * the server, by returning a masked value rather than by hiding a column in the browser — a masked field cannot be
 * recovered from the page source, from a network response, or by disabling CSS.
 *
 * Provenance travels WITH the value at all times. A number nobody sourced is not a number anyone may call, so the
 * UI is never allowed to show a phone without also showing where it came from.
 */

export interface ContactView {
  /** The real value, or null when the actor may not see it. */
  value: string | null;
  /** Always present: a shape-preserving mask so the operator can tell "absent" from "not permitted". */
  masked: string;
  present: boolean;
  visible: boolean;
  status: ContactProvenance;
  /** The recorded source URL or verification basis. Never invented. */
  source: string | null;
  /** True only for PUBLICLY_LISTED or VERIFIED — the provenance levels outreach may actually use. */
  usableForOutreach: boolean;
  /** One line explaining the provenance in operator language. */
  provenanceNote: string;
}

const PROVENANCE_NOTE: Record<ContactProvenance, string> = {
  UNKNOWN: 'nothing on file',
  INFERRED: 'guessed by pattern — never usable for outreach',
  UNVERIFIED: 'on file from legacy research, but nobody recorded where it came from',
  PUBLICLY_LISTED: 'published by the business; the source URL is recorded',
  VERIFIED: 'a human confirmed it; the basis is recorded',
  INVALID: 'bounced or wrong number',
};

/**
 * Removes a lead's own contact values from free text before it is shown to someone who may not see them.
 *
 * Core writes operator instructions that quote the record ("Find where +44 … is published"), and those strings are
 * rendered on pages an INTERN or VIEWER can open. Masking the contact FIELDS while leaking the same value inside a
 * sentence would defeat the whole boundary, so every surface that renders core's task text scrubs it here.
 */
export function scrubContactValues(text: string, lead: Pick<KachmoLead, 'decision_maker_email' | 'decision_maker_phone' | 'whatsapp_number' | 'decision_maker_whatsapp'>): string {
  let out = text;
  for (const [value, kind] of [
    [lead.decision_maker_email, 'email'],
    [lead.decision_maker_phone, 'phone'],
    [lead.whatsapp_number, 'phone'],
    [lead.decision_maker_whatsapp, 'phone'],
  ] as const) {
    const v = value?.trim();
    if (!v || v.length < 5) continue;
    out = out.split(v).join(maskContact(v, kind));
  }
  return out;
}

/** Masks an email as `j•••@d•••.com`, a phone as its last two digits. Shape survives; the value does not. */
export function maskContact(value: string | null | undefined, kind: 'email' | 'phone'): string {
  if (!value) return '—';
  if (kind === 'email') {
    const [local, domain] = value.split('@');
    if (!domain) return '•••';
    const [host, ...rest] = domain.split('.');
    return `${local.slice(0, 1)}•••@${host.slice(0, 1)}•••${rest.length ? `.${rest.join('.')}` : ''}`;
  }
  const digits = value.replace(/\D/g, '');
  return digits.length >= 2 ? `•••• ${digits.slice(-2)}` : '••••';
}

function view(value: string | null, kind: 'email' | 'phone', status: ContactProvenance, source: string | null, visible: boolean): ContactView {
  return {
    value: visible ? value : null,
    masked: maskContact(value, kind),
    present: !!value,
    visible,
    status,
    source,
    usableForOutreach: !!value && OUTREACH_USABLE.has(status),
    provenanceNote: PROVENANCE_NOTE[status] ?? 'unknown provenance',
  };
}

export interface LeadContacts {
  email: ContactView;
  phone: ContactView;
  /** True when this actor may see raw contact values at all. */
  revealed: boolean;
}

/** Builds the contact view for one lead, gated on `lead.view_contacts`. */
export function contactsFor(lead: KachmoLead, actor: Actor): LeadContacts {
  const revealed = actor.permissions.has('lead.view_contacts');
  return {
    email: view(lead.decision_maker_email, 'email', lead.email_status, lead.email_source ?? lead.email_verification_basis ?? null, revealed),
    phone: view(lead.decision_maker_phone, 'phone', lead.phone_status, lead.phone_source ?? lead.phone_verification_basis ?? null, revealed),
    revealed,
  };
}

/**
 * Strips contact values out of an arbitrary object before it crosses a boundary that does not need them
 * (an audit metadata blob, an analytics payload, a log line).
 */
export function withoutContactValues<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  const CONTACT_KEYS = /email|phone|whatsapp|mobile|tel/i;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, CONTACT_KEYS.test(k) && typeof x === 'string' ? '[redacted]' : walk(x)])
      );
    }
    return v;
  };
  return walk(value) as Record<string, unknown>;
}
