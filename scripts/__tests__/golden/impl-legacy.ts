/**
 * Binds the golden snapshot to the operator-facing script modules — the entry points the CLIs actually run.
 * This is the "old" side of the comparison: it was used to capture the baseline before core/ existed, and it
 * keeps proving that the CLIs still behave identically after extraction.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { PureImpl, PipelineImpl } from './snapshot.js';
import { evaluateLeadGates, isGenericDecisionMaker } from '../../leads-qualify.js';
import { calculateLeadScores } from '../../leads-score.js';
import { phoneEligibility, emailRoute, whatsappEligibility, classifyEmail, checkSuppression, outreachBlock, normalizeDomain, normalizeEmail, phoneKey, isUrl } from '../../lib/contact.js';
import { callEligibility, buildCallCard, generateCallingQueue } from '../../queue-calls.js';
import { taskFor } from '../../leads-research-queue.js';
import { buildWhatsAppDraft, generateWhatsAppQueue } from '../../queue-whatsapp.js';
import { findInvariantViolations } from '../../lib/invariants.js';
import { findDuplicates, normalizeCompanyName } from '../../leads-dedupe.js';
import { resolveTimezone } from '../../lib/geo.js';
import { parseTracker } from '../../lib/email-state.js';
import { refreshLeads } from '../../leads-refresh.js';
import { checkEmailQueue } from '../../email-queue-check.js';
import { runWarRoom } from '../../war-room.js';
import { generateWeeklyReport } from '../../analytics-weekly.js';

/** The legacy parser only reads from a path, so the content goes through a temp file. */
function parseTrackerViaFile(content: string) {
  const dir = mkdtempSync(join(tmpdir(), 'kachmo-golden-tracker-'));
  try {
    const p = join(dir, 'OUTREACH_TRACKER.md');
    writeFileSync(p, content);
    return parseTracker(p);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const legacyPure: PureImpl = {
  evaluateLeadGates,
  isGenericDecisionMaker,
  calculateLeadScores,
  phoneEligibility,
  emailRoute,
  whatsappEligibility,
  classifyEmail,
  checkSuppression,
  outreachBlock,
  callEligibility,
  taskFor,
  buildCallCard,
  buildWhatsAppDraft,
  findInvariantViolations,
  findDuplicates,
  normalizeCompanyName,
  resolveTimezone,
  normalizeDomain,
  normalizeEmail,
  phoneKey,
  isUrl,
  parseTrackerContent: parseTrackerViaFile,
};

export const legacyPipeline: PipelineImpl = {
  refreshLeads,
  generateCallingQueue,
  generateWhatsAppQueue,
  checkEmailQueue,
  runWarRoom,
  generateWeeklyReport,
};
