/**
 * Audit payload redaction. Pure. Audit rows record WHAT changed, never contact values or secrets:
 * any key that names a contact value, credential or token is replaced by a marker (plus whether a value was present),
 * and email- or phone-shaped strings anywhere else are masked.
 */
const SENSITIVE_KEY = /(^|_|\b)(email|e_mail|phone|mobile|whatsapp(_number)?|password|pass|secret|token|api_?key|authorization|cookie|session|otp|backup_?codes?)($|_|\b)/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\+?\d[\d\s().-]{8,}\d/g;

export const REDACTED = '[redacted]';

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 12) return REDACTED;
  if (typeof value === 'string') return value.replace(EMAIL, '[email]').replace(PHONE, '[phone]');
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => {
        const key = k.replace(/([a-z])([A-Z])/g, '$1_$2');
        if (SENSITIVE_KEY.test(key)) return [k, v === null || v === undefined || v === '' ? v ?? null : `${REDACTED} (present)`];
        return [k, redact(v, depth + 1)];
      })
    );
  }
  return value;
}

/** Namespaced, lower-case action names (e.g. `lead.approve`, `auth.sign_in_failed`) — mirrors the database check. */
export const AUDIT_ACTION = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;
