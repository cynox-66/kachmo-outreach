/** Binds the golden snapshot directly to core/ — the functions the hosted application calls. */
import type { PureImpl } from './snapshot.js';
import * as core from '../../../core/index.js';

export const corePure: PureImpl = {
  evaluateLeadGates: core.evaluateLeadGates,
  isGenericDecisionMaker: core.isGenericDecisionMaker,
  calculateLeadScores: core.calculateLeadScores,
  phoneEligibility: core.phoneEligibility,
  emailRoute: core.emailRoute,
  whatsappEligibility: core.whatsappEligibility,
  classifyEmail: core.classifyEmail,
  checkSuppression: core.checkSuppression,
  outreachBlock: core.outreachBlock,
  callEligibility: core.callEligibility,
  taskFor: core.taskFor,
  buildCallCard: core.buildCallCard,
  buildWhatsAppDraft: core.buildWhatsAppDraft,
  findInvariantViolations: core.findInvariantViolations,
  findDuplicates: core.findDuplicates,
  normalizeCompanyName: core.normalizeCompanyName,
  resolveTimezone: core.resolveTimezone,
  normalizeDomain: core.normalizeDomain,
  normalizeEmail: core.normalizeEmail,
  phoneKey: core.phoneKey,
  isUrl: core.isUrl,
  parseTrackerContent: core.parseTrackerContent,
};
