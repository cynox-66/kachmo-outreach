// Compatibility re-export: contact provenance lives in core/contact/provenance.ts and the single outreach block /
// suppression matcher in core/suppression/match.ts.
export {
  OUTREACH_USABLE,
  isUrl,
  normalizeEmail,
  phoneKey,
  normalizeDomain,
  classifyEmail,
  emailRoute,
  phoneEligibility,
  whatsappEligibility,
  type EmailClass,
  type EmailRouteQuality,
} from '../../core/contact/provenance.js';
export { checkSuppression, outreachBlock } from '../../core/suppression/match.js';
