/**
 * PHASE 1.5E — RESEARCH FOUNDATION TESTS.
 *
 * The contracts Phase 2 will build on, tested against hostile input: fabricated URLs, invented evidence, spoofed
 * approvals, suppressed candidates, oversized text and self-contradictory extractor output.
 *
 * Nothing here calls a model, fetches a URL or performs research.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { KachmoLead, SuppressionEntry } from '../lib/schema.js';
import {
  EVIDENCE_LEVELS,
  MAX_LEVEL_BY_VALIDATOR,
  atLeast,
  deriveEvidenceLevel,
  evidenceProblems,
  recordEvidence,
  gateOutcomeFor,
  strictGateOutcomeFor,
  type EvidenceRecord,
} from '../../core/research/evidence.js';
import { reportMetadataProblems, canAdvance, REPORT_STAGES, MAX_REPORT_BYTES, RESEARCH_REPORT_CONTRACT_VERSION } from '../../core/research/report.js';
import {
  assessCandidate,
  approvalRefusal,
  findDuplicateMatches,
  findSuppressionMatches,
  withDerivedEvidence,
  sameCandidate,
  evidenceLevelFor,
  REQUIRED_CANDIDATE_FIELDS,
  TERMINAL_CANDIDATE_STATUSES,
  type ResearchCandidate,
} from '../../core/research/candidate.js';
import { validateExtraction, sanitizeText, EXTRACTION_DISABLED, MAX_VALUE_LENGTH } from '../../core/research/extraction.js';
import { buildBriefSpec, renderBrief, BASELINE_EVIDENCE, MAX_TARGET_COUNT } from '../../core/research/prompt.js';
import { buildInventoryReport, researchNeeds, uncoveredArchetypes, DEFAULT_THRESHOLDS, isUsable } from '../../core/research/inventory.js';

const REPO = process.cwd();
let passed = 0;
const failures: string[] = [];
function assert(cond: unknown, name: string, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ❌ ${name}${detail !== undefined ? `\n     ${JSON.stringify(detail)}` : ''}`);
  }
}
const group = (t: string) => console.log(`\n${t}`);

const NOW = '2026-09-15T06:00:00.000Z';
const LEADS: KachmoLead[] = JSON.parse(readFileSync(join(REPO, 'database/kachmo_leads.json'), 'utf-8'));

const evidence = (over: Partial<EvidenceRecord> = {}): EvidenceRecord =>
  recordEvidence({
    field: 'commercial_validation_signal',
    claim: 'lists named clients',
    sourceUrl: null,
    sourceType: 'official_website',
    retrievedAt: null,
    retrievedContentSha256: null,
    supportingExcerpt: null,
    validator: 'NONE',
    validatedAt: null,
    contradictsEvidenceId: null,
    notes: null,
    ...over,
  });

const candidate = (claims: Array<[string, string | null, EvidenceRecord[]?]>, over: Partial<ResearchCandidate> = {}): ResearchCandidate => ({
  candidateId: 'c-1',
  sourceReportId: 'r-1',
  extractedAt: NOW,
  status: 'EXTRACTED',
  claims: claims.map(([field, value, ev]) => ({ field, value, statedConfidence: 'HIGH' as const, evidence: ev ?? [], reportLocation: null })),
  duplicateMatches: [],
  suppressionMatches: 0,
  missingFields: [],
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  resolvedLeadId: null,
  ...over,
});

const completeClaims = (): Array<[string, string | null, EvidenceRecord[]?]> => [
  ['company_name', 'New Studio', [evidence({ sourceUrl: 'https://new-studio.example/about' })]],
  ['website_url', 'https://new-studio.example', []],
  ['location_country', 'United Kingdom', []],
  ['archetype_id', '1', []],
  ['decision_maker_name', 'Jane Roe', [evidence({ field: 'decision_maker_name', sourceUrl: 'https://new-studio.example/team' })]],
];

console.log('\n🔬 RESEARCH FOUNDATION (Phase 1.5E)');

group('1. Evidence: URL syntax, reachability and support are three different things');
{
  const shaped = evidence({ sourceUrl: 'https://example.com/clients', validator: 'SYNTAX_CHECK' });
  assert(shaped.level === 'URL_SHAPED', 'a valid URL that nobody fetched is URL_SHAPED, not proof of anything');
  assert(deriveEvidenceLevel(shaped).reason.includes('may not exist'), 'and the reason says explicitly that it may not exist');

  const fabricated = evidence({ sourceUrl: 'their-website-dot-com', validator: 'LLM_EXTRACTION' });
  assert(fabricated.level === 'CLAIMED', 'a URL-shaped string that is not a URL never reaches URL_SHAPED');

  const retrieved = evidence({ sourceUrl: 'https://example.com/clients', retrievedAt: NOW, retrievedContentSha256: 'a'.repeat(64), validator: 'FETCHER' });
  assert(retrieved.level === 'RETRIEVED', 'a fetched page is RETRIEVED — it exists, but nobody has read it against the claim');

  const llmSupported = evidence({ sourceUrl: 'https://example.com/clients', retrievedAt: NOW, retrievedContentSha256: 'a'.repeat(64), supportingExcerpt: 'Clients include Nike.', validator: 'LLM_EXTRACTION' });
  assert(llmSupported.level === 'RETRIEVED', 'an LLM cannot take evidence to SUPPORTED — it would be certifying its own claim');
  assert(deriveEvidenceLevel(llmSupported).reason.includes('a human must confirm'), 'and the reason names who can');

  const humanSupported = evidence({ sourceUrl: 'https://example.com/clients', retrievedAt: NOW, retrievedContentSha256: 'a'.repeat(64), supportingExcerpt: 'Clients include Nike.', validator: 'HUMAN' });
  assert(humanSupported.level === 'SUPPORTED', 'only a human confirming the excerpt reaches SUPPORTED');

  assert(evidence({ sourceUrl: null }).level === 'NONE', 'no source at all is NONE');
  assert(evidence({ sourceUrl: null, sourceType: 'human_note', notes: 'they told me on a call' }).level === 'CLAIMED', 'a described but unlinked source is CLAIMED');

  assert(MAX_LEVEL_BY_VALIDATOR.LLM_EXTRACTION === 'RETRIEVED', 'the LLM cap is declared, not incidental');
  assert(MAX_LEVEL_BY_VALIDATOR.HUMAN === 'SUPPORTED', 'only a human can establish support');
  assert(atLeast('SUPPORTED', 'URL_SHAPED') && !atLeast('URL_SHAPED', 'SUPPORTED'), 'levels are ordered');
  assert(!atLeast('CONTRADICTED', 'SUPPORTED') && !atLeast('SUPPORTED', 'CONTRADICTED'), 'CONTRADICTED is not ordered with the rest and is never "stronger"');
  assert(EVIDENCE_LEVELS.length === 6, 'there are six evidence levels');
}

group('2. Evidence cannot be over-claimed');
{
  const lying: EvidenceRecord = { ...evidence({ sourceUrl: 'https://example.com/x' }), level: 'SUPPORTED' };
  const problems = evidenceProblems(lying);
  assert(problems.some(p => p.code === 'FABRICATED_LEVEL'), 'a record that asserts SUPPORTED without a retrieval is rejected');
  assert(problems.some(p => p.code === 'VALIDATOR_OVERREACH'), 'and the validator overreach is named separately');

  const excerptWithoutFetch: EvidenceRecord = { ...evidence({ sourceUrl: 'https://example.com/x' }), supportingExcerpt: 'they say so' };
  assert(evidenceProblems(excerptWithoutFetch).some(p => p.code === 'EXCERPT_WITHOUT_RETRIEVAL'), 'an excerpt that predates its source is rejected');

  const retrievalWithoutUrl: EvidenceRecord = { ...evidence({ sourceUrl: null }), retrievedAt: NOW, retrievedContentSha256: 'a'.repeat(64) };
  assert(evidenceProblems(retrievalWithoutUrl).some(p => p.code === 'RETRIEVAL_WITHOUT_URL'), 'a retrieval with nothing to retrieve from is rejected');

  const contradiction: EvidenceRecord = { ...evidence({}), level: 'CONTRADICTED' };
  assert(evidenceProblems(contradiction).some(p => p.code === 'CONTRADICTION_WITHOUT_TARGET'), 'a contradiction must name what it contradicts');

  const oversized: EvidenceRecord = { ...evidence({}), claim: 'x'.repeat(600) };
  assert(evidenceProblems(oversized).some(p => p.code === 'OVERSIZED'), 'oversized text is rejected');
  assert(evidenceProblems(evidence({ sourceUrl: 'https://example.com/x', validator: 'SYNTAX_CHECK' })).length === 0, 'a correctly derived record has no problems');
}

group('3. Evidence maps onto the EXISTING gate outcomes, unchanged');
{
  assert(gateOutcomeFor('URL_SHAPED') === 'PASS', 'a URL-shaped source still passes, exactly as Methodology v1.0 does today');
  assert(gateOutcomeFor('SUPPORTED') === 'PASS' && gateOutcomeFor('RETRIEVED') === 'PASS', 'stronger evidence also passes');
  assert(gateOutcomeFor('CLAIMED') === 'UNVERIFIED', 'an unlinked claim is unverified');
  assert(gateOutcomeFor('NONE') === 'PENDING', 'no evidence is pending research, never FAIL');
  assert(gateOutcomeFor('CONTRADICTED') === 'FAIL', 'a contradicted claim fails — the one thing the new model can say that v1.0 could not');
  const outcomes = new Set(EVIDENCE_LEVELS.map(gateOutcomeFor));
  assert([...outcomes].every(o => ['PASS', 'UNVERIFIED', 'PENDING', 'UNKNOWN', 'FAIL'].includes(o)), 'no sixth gate outcome is introduced');
  assert(strictGateOutcomeFor('URL_SHAPED') === 'UNVERIFIED', 'the stricter future mapping exists and differs');
  assert(strictGateOutcomeFor !== gateOutcomeFor, 'but it is a separate function that no gate calls');
  const src = readFileSync(join(REPO, 'core/qualification/gates.ts'), 'utf-8');
  assert(!/strictGateOutcomeFor|gateOutcomeFor/.test(src), 'the qualification gates do not import the evidence mapping, so v1.0 behaviour is untouched');
}

group('4. Uploaded reports are treated as hostile');
{
  const ok = { originalFilename: 'gemini-report-2026-09-15.md', byteSize: 4096, format: 'markdown' as const, sha256: 'a'.repeat(64) };
  assert(reportMetadataProblems(ok).length === 0, 'a well-formed upload is accepted');
  assert(reportMetadataProblems({ ...ok, originalFilename: '../../etc/passwd' }).some(p => p.code === 'FILENAME_UNSAFE'), 'a traversal filename is rejected');
  assert(reportMetadataProblems({ ...ok, originalFilename: 'reports/x.md' }).some(p => p.code === 'FILENAME_UNSAFE'), 'a filename with a path separator is rejected');
  assert(reportMetadataProblems({ ...ok, originalFilename: 'x .md' }).some(p => p.code === 'FILENAME_UNSAFE'), 'a NUL byte in a filename is rejected');
  assert(reportMetadataProblems({ ...ok, byteSize: MAX_REPORT_BYTES + 1 }).some(p => p.code === 'SIZE_EXCEEDED'), 'an oversized upload is rejected');
  assert(reportMetadataProblems({ ...ok, byteSize: 0 }).some(p => p.code === 'SIZE_INVALID'), 'a zero-byte upload is rejected');
  assert(reportMetadataProblems({ ...ok, format: 'exe' as never }).some(p => p.code === 'FORMAT_UNSUPPORTED'), 'an unsupported format is never parsed');
  assert(reportMetadataProblems({ ...ok, sha256: 'nope' }).some(p => p.code === 'HASH_MISSING'), 'an unhashed upload is rejected, so the stored report can be proven unaltered');
  assert(reportMetadataProblems({}).length >= 4, 'an upload with no metadata at all is rejected on every count');

  assert(canAdvance('RECEIVED', 'PARSED').allowed, 'a report advances one stage at a time');
  assert(!canAdvance('RECEIVED', 'QUALIFIED').allowed, 'a report cannot skip stages');
  assert(!canAdvance('REVIEWED', 'PARSED').allowed, 'a report cannot go backwards');
  assert(canAdvance('EXTRACTED', 'REJECTED').allowed, 'a report can be rejected at any stage');
  assert(!canAdvance('REJECTED', 'PARSED').allowed, 'a rejected report is terminal');
  assert(REPORT_STAGES[0] === 'RECEIVED' && RESEARCH_REPORT_CONTRACT_VERSION === '1.0', 'the report contract is versioned');
}

group('5. Candidates never become leads by themselves');
{
  const suppression: SuppressionEntry[] = [{ reason: 'opted out', suppressed_at: NOW, source: 'test', domain: 'new-studio.example' }];
  const complete = candidate(completeClaims());

  const clean = assessCandidate(complete, [], []);
  assert(clean.status === 'AWAITING_REVIEW' && clean.recommendedDecision === 'ACCEPT', 'a complete, unsuppressed, unique candidate awaits review');
  assert(approvalRefusal(complete, clean, 'Dev') === null, 'and a named human may approve it');

  assert(approvalRefusal(complete, clean, 'SYSTEM')?.code === 'NOT_A_HUMAN', 'SYSTEM may not approve a candidate');
  assert(approvalRefusal(complete, clean, 'LLM')?.code === 'NOT_A_HUMAN', 'nor may an LLM');
  assert(approvalRefusal(complete, clean, 'agent-7')?.code === 'NOT_A_HUMAN', 'nor may anything that looks like an agent');
  assert(approvalRefusal(complete, clean, '   ')?.code === 'NOT_A_HUMAN', 'nor may an empty reviewer');

  const suppressed = assessCandidate(complete, [], suppression);
  assert(suppressed.status === 'SUPPRESSED' && suppressed.recommendedDecision === 'REJECT', 'a candidate matching a suppression entry is suppressed');
  assert(approvalRefusal(complete, suppressed, 'Dev')?.code === 'SUPPRESSED', 'and can never be approved, by anyone');
  assert(approvalRefusal(complete, suppressed, 'Dev')!.message.includes('by anyone'), 'and the refusal says so explicitly');

  const incomplete = assessCandidate(candidate([['company_name', 'X', [evidence({ sourceUrl: 'https://x.example' })]]]), [], []);
  assert(incomplete.status === 'INCOMPLETE' && incomplete.recommendedDecision === 'SEND_BACK', 'a candidate missing required fields is sent back');
  assert(incomplete.missingFields.length === REQUIRED_CANDIDATE_FIELDS.length - 1, 'and every missing field is named', incomplete.missingFields);

  const contradicted = candidate([
    ...completeClaims().slice(0, 4),
    ['decision_maker_name', 'Jane Roe', [{ ...evidence({ field: 'decision_maker_name', sourceUrl: 'https://x.example/team' }), level: 'CONTRADICTED' as const, contradictsEvidenceId: 'e-1' }]],
  ]);
  const contra = assessCandidate(contradicted, [], []);
  assert(contra.status === 'FLAGGED_CONTRADICTION', 'a candidate whose source contradicts its own claim is flagged');
  assert(approvalRefusal(contradicted, contra, 'Dev')?.code === 'CONTRADICTED', 'and cannot be approved until it is resolved');
  assert(evidenceLevelFor(contradicted, 'decision_maker_name') === 'CONTRADICTED', 'the contradiction wins over any other evidence on the field');

  const noEvidence = candidate(completeClaims().map(([f, v]) => [f, v, []] as [string, string | null, EvidenceRecord[]]));
  const noEvAssessment = assessCandidate(noEvidence, [], []);
  assert(approvalRefusal(noEvidence, noEvAssessment, 'Dev')?.code === 'NO_EVIDENCE', 'a candidate with no evidence at all cannot be approved, however complete it looks');

  const resolved = candidate(completeClaims(), { status: 'ACCEPTED' });
  assert(approvalRefusal(resolved, clean, 'Dev')?.code === 'ALREADY_RESOLVED', 'a resolved candidate cannot be approved twice');
  assert(TERMINAL_CANDIDATE_STATUSES.has('ACCEPTED') && TERMINAL_CANDIDATE_STATUSES.has('SUPPRESSED'), 'accepted and suppressed are terminal');
}

group('6. Duplicates are detected and never resolved automatically');
{
  const existing = LEADS[0];
  const dupe = candidate([
    ['company_name', existing.company_name, [evidence({ sourceUrl: 'https://x.example' })]],
    ['website_url', existing.website_url, []],
    ['location_country', existing.location_country, []],
    ['archetype_id', existing.archetype_id, []],
    ['decision_maker_name', 'Someone Else', []],
  ]);
  const matches = findDuplicateMatches(dupe, LEADS);
  assert(matches.some(m => m.matchedOn === 'domain' && m.confidence === 'HIGH'), 'a candidate on a known domain matches the existing lead');
  const assessment = assessCandidate(dupe, LEADS, []);
  assert(assessment.status === 'DUPLICATE_SUSPECTED' && assessment.recommendedDecision === 'MERGE', 'and is flagged as a suspected duplicate');
  assert(approvalRefusal(dupe, assessment, 'Dev')?.code === 'UNRESOLVED_DUPLICATE', 'which blocks approval until a human resolves it');
  assert(assessment.reason.includes(existing.target_number), 'and the reason names the lead it may already be');

  const unique = assessCandidate(candidate(completeClaims()), LEADS, []);
  assert(unique.duplicateMatches.length === 0 && unique.status === 'AWAITING_REVIEW', 'a genuinely new company matches nothing');

  const a = candidate([['company_name', 'Same Co', []], ['website_url', 'https://same.example', []]]);
  const b = candidate([['company_name', 'Same Co Ltd.', []], ['website_url', 'https://www.same.example/', []]]);
  assert(sameCandidate(a, b), 'two candidates in one report on the same domain are the same candidate');
  const c = candidate([['company_name', 'Other Co', []], ['website_url', 'https://other.example', []]]);
  assert(!sameCandidate(a, c), 'and different companies are not');

  assert(findSuppressionMatches(candidate([['decision_maker_email', 'x@blocked.example', []]]), [{ reason: 'r', suppressed_at: NOW, source: 't', email: 'X@Blocked.example' }]).length === 1, 'suppression matches a candidate on email, case-insensitively');
}

group('7. LLM extraction output is validated as hostile input');
{
  const ctx = { sourceReportId: 'r-1', extractedAt: NOW, candidateId: (i: number) => `c-${i}` };
  const good = validateExtraction(
    [{ claims: [{ field: 'company_name', value: 'New Studio', statedConfidence: 'HIGH', evidence: [{ claim: 'named on the about page', sourceUrl: 'https://new-studio.example/about', sourceType: 'official_website' }] }] }],
    ctx
  );
  assert(good.clean && good.candidates.length === 1, 'well-formed extractor output produces a candidate');
  assert(good.candidates[0].status === 'EXTRACTED', 'which starts at EXTRACTED, never further along');
  assert(good.candidates[0].claims[0].evidence[0].level === 'URL_SHAPED', 'and its evidence is capped at URL_SHAPED');
  assert(good.candidates[0].claims[0].evidence[0].validator === 'LLM_EXTRACTION', 'and attributed to the extractor');

  const invented = validateExtraction([{ claims: [{ field: 'company_name', value: 'X', evidence: [{ claim: 'c', sourceUrl: 'https://x.example', retrievedAt: NOW }] }] }], ctx);
  assert(invented.problems.some(p => p.code === 'EVIDENCE_INVENTED_RETRIEVAL'), 'an extractor claiming a page was retrieved is rejected');
  assert(invented.candidates.length === 0, 'and the whole candidate is discarded, not partially kept');

  const excerpt = validateExtraction([{ claims: [{ field: 'company_name', value: 'X', evidence: [{ claim: 'c', sourceUrl: 'https://x.example', supportingExcerpt: 'it says so' }] }] }], ctx);
  assert(excerpt.problems.some(p => p.code === 'EVIDENCE_INVENTED_EXCERPT'), 'an extractor supplying an excerpt it could not have read is rejected');

  const spoofedValidator = validateExtraction([{ claims: [{ field: 'company_name', value: 'X', evidence: [{ claim: 'c', sourceUrl: 'https://x.example', validator: 'HUMAN' }] }] }], ctx);
  assert(spoofedValidator.problems.some(p => p.code === 'EVIDENCE_VALIDATOR_SPOOFED'), 'an extractor claiming to be a human validator is rejected');

  const fakeUrl = validateExtraction([{ claims: [{ field: 'company_name', value: 'X', evidence: [{ claim: 'c', sourceUrl: 'probably-their-site.com' }] }] }], ctx);
  assert(fakeUrl.problems.some(p => p.code === 'EVIDENCE_URL_INVALID'), 'a fabricated URL-ish string is not recorded as a source');
  assert(fakeUrl.candidates[0]?.claims[0].evidence[0].level === 'NONE' || fakeUrl.candidates[0]?.claims[0].evidence[0].sourceUrl === null, 'and the evidence carries no source');

  const spoofedStatus = validateExtraction([{ status: 'ACCEPTED', claims: [{ field: 'company_name', value: 'X' }] }], ctx);
  assert(spoofedStatus.problems.some(p => p.code === 'CANDIDATE_STATUS_SPOOFED'), 'an extractor setting a candidate status is rejected');
  const spoofedApproval = validateExtraction([{ reviewedBy: 'Dev', claims: [{ field: 'company_name', value: 'X' }] }], ctx);
  assert(spoofedApproval.problems.some(p => p.code === 'CANDIDATE_APPROVAL_SPOOFED'), 'an extractor claiming a human reviewed it is rejected');

  const badArchetype = validateExtraction([{ claims: [{ field: 'archetype_id', value: '9' }] }], ctx);
  assert(badArchetype.problems.some(p => p.code === 'CLAIM_ARCHETYPE_INVENTED'), 'an invented archetype is rejected');
  const badUrl = validateExtraction([{ claims: [{ field: 'website_url', value: 'not a url' }] }], ctx);
  assert(badUrl.problems.some(p => p.code === 'CLAIM_URL_INVALID'), 'an invalid website_url is rejected');
  const unknownField = validateExtraction([{ claims: [{ field: 'secret_backdoor', value: 'x' }, { field: 'company_name', value: 'X' }] }], ctx);
  assert(unknownField.problems.some(p => p.code === 'CLAIM_FIELD_NOT_EXTRACTABLE'), 'a field outside the allowed set is dropped with a warning');
  assert(unknownField.candidates[0]?.claims.every(c => c.field !== 'secret_backdoor'), 'and never stored');

  const selfContradictory = validateExtraction([{ claims: [{ field: 'company_name', value: 'A' }, { field: 'company_name', value: 'B' }] }], ctx);
  assert(selfContradictory.problems.some(p => p.code === 'CANDIDATE_SELF_CONTRADICTORY'), 'an extractor giving two values for one field is rejected');

  const oversized = validateExtraction([{ claims: [{ field: 'company_name', value: 'x'.repeat(MAX_VALUE_LENGTH + 500) }] }], ctx);
  assert(oversized.problems.some(p => p.code === 'CLAIM_VALUE_TRUNCATED'), 'an oversized value is truncated with a warning');
  assert((oversized.candidates[0]?.claims[0].value?.length ?? 0) <= MAX_VALUE_LENGTH, 'and never stored at full length');

  assert(validateExtraction({ not: 'an array' }, ctx).problems.some(p => p.code === 'OUTPUT_NOT_AN_ARRAY'), 'non-array output is rejected');
  assert(validateExtraction([{ claims: [] }], ctx).problems.some(p => p.code === 'CANDIDATE_NO_CLAIMS'), 'a candidate with no claims is rejected');
  assert(validateExtraction(['a string'], ctx).problems.some(p => p.code === 'CANDIDATE_NOT_AN_OBJECT'), 'a non-object candidate is rejected');
  assert(sanitizeText('a bc ') === 'abc', 'control characters and NUL are stripped from every extracted string');
  assert(EXTRACTION_DISABLED.enabled === false, 'LLM extraction is off by default');

  const extractionSrc = readFileSync(join(REPO, 'core/research/extraction.ts'), 'utf-8');
  assert(!/fetch\(|anthropic|openai|api\.|https:\/\/api/i.test(extractionSrc), 'the extraction module calls no model and names no endpoint');
}

group('8. Research briefs demand evidence, not "good leads"');
{
  const base = {
    promptId: 'brief-001',
    createdAt: NOW,
    requestedBy: 'Dev',
    archetypeId: '1',
    vertical: null,
    geographies: ['United Kingdom'],
    decisionMakerRole: 'Founder or Creative Director',
    requiredContactability: 'EITHER' as const,
    knownFriction: 'portfolio sites that break on mobile',
    depth: 'STANDARD' as const,
    sourceRequirements: { preferred: ['official site'], unacceptable: ['AI summaries'] },
    targetCount: 10,
    notes: null,
  };
  const { spec, problems } = buildBriefSpec(base);
  assert(spec !== null && problems.length === 0, 'a well-specified brief builds');
  assert(spec!.requiredEvidence.length >= BASELINE_EVIDENCE.length, 'and always carries the baseline evidence requirements');
  assert(spec!.requiredEvidence.filter(e => e.mandatory).length >= 3, 'with at least three mandatory ones');

  assert(buildBriefSpec({ ...base, archetypeId: '9' }).problems.some(p => p.code === 'ARCHETYPE_UNKNOWN'), 'a brief never invents an archetype');
  assert(buildBriefSpec({ ...base, geographies: [] }).problems.some(p => p.code === 'GEOGRAPHY_MISSING'), 'a brief must name a geography');
  assert(buildBriefSpec({ ...base, knownFriction: '' }).problems.some(p => p.code === 'FRICTION_MISSING'), 'a brief must state the friction, or the researcher will invent one');
  assert(buildBriefSpec({ ...base, requestedBy: '' }).problems.some(p => p.code === 'REQUESTER_MISSING'), 'a brief is requested by a named human');
  assert(buildBriefSpec({ ...base, targetCount: MAX_TARGET_COUNT + 1 }).problems.some(p => p.code === 'TARGET_COUNT_EXCESSIVE'), 'an excessive target count is refused because it invites padding');
  assert(buildBriefSpec({ ...base, archetypeId: '9' }).spec === null, 'and a refused brief produces nothing to send');

  const rendered = renderBrief(spec!);
  assert(rendered.includes('Never give a URL you did not open'), 'the rendered brief forbids unopened URLs');
  assert(rendered.includes('Report absence as absence'), 'and requires absence to be reported');
  assert(rendered.includes('Do not guess a pattern'), 'and forbids guessed email patterns');
  assert(!/good leads|high[- ]quality leads/i.test(rendered), 'and never asks for "good leads"');
  assert(rendered.includes(spec!.promptId) && rendered.includes(spec!.contractVersion), 'the brief is traceable to its id and contract version');
  assert(rendered.includes('Return fewer if fewer genuinely match'), 'and explicitly permits returning fewer');
}

group('9. Low inventory is counted, never guessed');
{
  const ledger = () => null;
  const report = buildInventoryReport(LEADS, [], ledger, NOW);
  assert(report.totals.leads === LEADS.length, 'every lead is counted into a segment');
  assert(report.segments.reduce((n, s) => n + s.total, 0) === LEADS.length, 'and segment totals add up to the whole database');
  assert(report.thresholds === DEFAULT_THRESHOLDS, 'thresholds are explicit configuration');
  assert(report.segments.every(s => s.usable + s.recoverableByResearch + s.permanentlyUnavailable === s.total), 'every lead is exactly one of usable, recoverable or permanently unavailable');

  // The live dataset has no sourced phones, so usable inventory should be near zero and everything should be LOW.
  assert(report.totals.usable === LEADS.filter(l => isUsable(l, [], null)).length, 'the usable count is the sum of the per-lead rule');
  assert(report.needsResearch.length > 0, 'the real database reports segments needing research');
  assert(report.needsResearch.every(s => s.status !== 'HEALTHY'), 'and only unhealthy ones');
  assert(report.needsResearch.every(s => s.total >= DEFAULT_THRESHOLDS.minSegmentSize), 'segments too small to interpret are not reported');

  const worst = report.needsResearch[0];
  assert(worst.blockingGates.length > 0, 'a shortfall names the gates causing it', worst.reason);
  assert(worst.topMissingFields.length > 0, 'and the fields that are missing');
  assert(worst.reason.includes(String(DEFAULT_THRESHOLDS.low)), 'and states the threshold it is measured against');

  const needs = researchNeeds(report);
  assert(needs.length === report.needsResearch.length, 'every unhealthy segment produces a research need');
  assert(needs.every(n => n.shortfall > 0 && ['RESEARCH_EXISTING', 'FIND_NEW', 'BOTH'].includes(n.approach)), 'each need states a shortfall and an approach');
  assert(needs.every(n => n.rationale.length > 20), 'and a rationale a human can act on');
  assert(uncoveredArchetypes(LEADS).length === 0, 'the live database covers every declared archetype');
  assert(uncoveredArchetypes([]).length === 6, 'an empty database reports all six as uncovered');

  const inventorySrc = readFileSync(join(REPO, 'core/research/inventory.ts'), 'utf-8');
  assert(!/llm|model|predict|estimate\(/i.test(inventorySrc.replace(/never.*$/gim, '')), 'inventory is counted from state, with no model and no prediction');
}

group('10. The pipeline preserves the human boundary end to end');
{
  const ctx = { sourceReportId: 'r-1', extractedAt: NOW, candidateId: (i: number) => `c-${i}` };
  const extracted = validateExtraction(
    [
      {
        claims: [
          { field: 'company_name', value: 'New Studio', evidence: [{ claim: 'named on the about page', sourceUrl: 'https://new-studio.example/about', sourceType: 'official_website' }] },
          { field: 'website_url', value: 'https://new-studio.example' },
          { field: 'location_country', value: 'United Kingdom' },
          { field: 'archetype_id', value: '1' },
          { field: 'decision_maker_name', value: 'Jane Roe', evidence: [{ claim: 'listed as founder', sourceUrl: 'https://new-studio.example/team', sourceType: 'official_website' }] },
        ],
      },
    ],
    ctx
  );
  assert(extracted.clean, 'a realistic extraction passes validation');
  const c = withDerivedEvidence(extracted.candidates[0]);
  assert(c.claims.every(x => x.evidence.every(e => e.level !== 'SUPPORTED')), 'nothing reaches SUPPORTED without a human, even end to end');
  const assessment = assessCandidate(c, LEADS, []);
  assert(assessment.status === 'AWAITING_REVIEW', 'and the candidate stops at AWAITING_REVIEW');
  assert(c.resolvedLeadId === null && c.reviewedBy === null, 'no lead was created and no review was recorded by the pipeline itself');
  assert(approvalRefusal(c, assessment, 'Dev') === null, 'only an explicit human approval can take it further');
}

console.log(`\n${'='.repeat(60)}\nRESEARCH FOUNDATION SUMMARY: ${passed} passed | ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
