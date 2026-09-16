import { ARCHETYPE_IDS, archetypeById, TAXONOMY_VERSION } from '../config/taxonomy.js';
import { FIELD_ORDER } from './tasks.js';

/**
 * THE RESEARCH PROMPT CONTRACT — versioned briefs, not requests for "good leads".
 *
 * A research brief tells an external researcher (a human, Gemini Deep Research, an approved agent environment)
 * exactly WHAT EVIDENCE IS REQUIRED, not merely what kind of company is wanted. That is the whole point: a brief
 * that asks for "10 good agencies" produces prose; a brief that says "for each company, the URL of the page that
 * names the decision maker and their role" produces something that can be validated.
 *
 * Phase 1.5 defines the CONTRACT and a minimal renderer. Final production wording is deliberately deferred to
 * Phase 2, when there are real reports to judge it by.
 */

export const PROMPT_CONTRACT_VERSION = '1.0' as const;

export const RESEARCH_DEPTHS = ['SHALLOW', 'STANDARD', 'DEEP'] as const;
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number];

export interface EvidenceRequirement {
  field: string;
  /** What must be found. */
  requirement: string;
  /** What counts as acceptable evidence. Always a retrievable source, never "general knowledge". */
  acceptableEvidence: string;
  /** Whether a candidate without this is useless or merely weaker. */
  mandatory: boolean;
}

export interface ResearchBriefSpec {
  contractVersion: typeof PROMPT_CONTRACT_VERSION;
  taxonomyVersion: typeof TAXONOMY_VERSION;
  promptId: string;
  createdAt: string;
  /** The named human who asked for this research. */
  requestedBy: string;
  archetypeId: string;
  /** Market segment, separate from the archetype. Null when the archetype is not vertical-specific. */
  vertical: string | null;
  /** Countries, as they should appear in location_country. */
  geographies: string[];
  /** The role that can say yes to a project. */
  decisionMakerRole: string;
  /** How the decision maker must be reachable for the lead to be usable. */
  requiredContactability: 'EMAIL' | 'PHONE' | 'EITHER';
  requiredEvidence: EvidenceRequirement[];
  /** The friction Kachmo expects to find and solve. Stated so the researcher looks for it specifically. */
  knownFriction: string;
  depth: ResearchDepth;
  /** Source kinds that are acceptable, and those that are not. */
  sourceRequirements: { preferred: string[]; unacceptable: string[] };
  targetCount: number;
  notes: string | null;
}

export interface BriefProblem {
  code: string;
  message: string;
}

export const MAX_TARGET_COUNT = 50;

/** The evidence every brief demands, whatever it is about. These mirror the blocking qualification gates. */
export const BASELINE_EVIDENCE: readonly EvidenceRequirement[] = [
  {
    field: 'decision_maker_name',
    requirement: 'the name and role of the person who can approve a website or product project',
    acceptableEvidence: 'the URL of a page that shows both the person and their role (team page, LinkedIn profile, company register filing)',
    mandatory: true,
  },
  {
    field: 'decision_maker_email',
    requirement: 'a direct working email for that person, or the best published contact route',
    acceptableEvidence: 'the URL of the page where the address is published. A guessed pattern (first@domain) is NOT acceptable and must be reported as absent.',
    mandatory: false,
  },
  {
    field: 'decision_maker_phone',
    requirement: 'a published phone number for the business or the person',
    acceptableEvidence: 'the URL of the page where the number is published. An unsourced number is worse than none: it cannot be called.',
    mandatory: false,
  },
  {
    field: 'commercial_validation_signal',
    requirement: 'concrete evidence the company can pay: named clients, funding, scale, or paid services',
    acceptableEvidence: 'the URL of the page stating it. Not an impression of the brand.',
    mandatory: true,
  },
  {
    field: 'observable_friction',
    requirement: 'a specific, checkable problem with their current digital presence',
    acceptableEvidence: 'the URL of the exact page where the problem is visible, plus what is wrong with it.',
    mandatory: true,
  },
] as const;

/**
 * Builds a brief spec from a request. Fails closed on anything it would otherwise have to invent: an unknown
 * archetype, an absent geography, a target count that would encourage padding.
 */
export function buildBriefSpec(
  req: Omit<ResearchBriefSpec, 'contractVersion' | 'taxonomyVersion' | 'requiredEvidence'> & { extraEvidence?: EvidenceRequirement[] }
): { spec: ResearchBriefSpec | null; problems: BriefProblem[] } {
  const problems: BriefProblem[] = [];
  const err = (code: string, message: string) => problems.push({ code, message });

  if (!ARCHETYPE_IDS.includes(req.archetypeId)) {
    err('ARCHETYPE_UNKNOWN', `archetype "${req.archetypeId}" is not declared; briefs never invent an archetype (declared: ${ARCHETYPE_IDS.join(', ')})`);
  }
  if (!req.geographies.length) err('GEOGRAPHY_MISSING', 'a brief must name at least one geography; "anywhere" produces unusable leads');
  if (!req.decisionMakerRole.trim()) err('ROLE_MISSING', 'a brief must name the role that can approve the project');
  if (!req.knownFriction.trim()) err('FRICTION_MISSING', 'a brief must state the friction to look for, or the researcher will invent one');
  if (!req.requestedBy.trim()) err('REQUESTER_MISSING', 'a brief is requested by a named human');
  if (req.targetCount < 1) err('TARGET_COUNT_INVALID', 'a brief must ask for at least one company');
  else if (req.targetCount > MAX_TARGET_COUNT) {
    err('TARGET_COUNT_EXCESSIVE', `asking for ${req.targetCount} companies invites padding; the limit is ${MAX_TARGET_COUNT}`);
  }
  if (problems.length) return { spec: null, problems };

  const def = archetypeById(req.archetypeId);
  if (req.vertical && !def?.labelsAreVerticals) {
    problems.push({ code: 'VERTICAL_IGNORED', message: `archetype ${req.archetypeId} is not vertical-specific; the vertical is recorded but does not narrow the search` });
  }

  return {
    spec: {
      ...req,
      contractVersion: PROMPT_CONTRACT_VERSION,
      taxonomyVersion: TAXONOMY_VERSION,
      requiredEvidence: [...BASELINE_EVIDENCE, ...(req.extraEvidence ?? [])],
    },
    problems,
  };
}

/**
 * Renders a brief as instructions for an external researcher.
 *
 * Deliberately plain and deliberately explicit about what NOT to do. The two instructions that matter most are
 * "report absence as absence" and "never give a URL you did not open" — those are what make the returned report
 * validatable instead of merely plausible.
 */
export function renderBrief(spec: ResearchBriefSpec): string {
  const def = archetypeById(spec.archetypeId);
  const mandatory = spec.requiredEvidence.filter(e => e.mandatory);
  const optional = spec.requiredEvidence.filter(e => !e.mandatory);

  const lines = [
    `# Research brief ${spec.promptId}`,
    '',
    `Find ${spec.targetCount} companies matching the profile below. Return fewer if fewer genuinely match — a short, accurate list is worth more than a padded one.`,
    '',
    '## Profile',
    `- Archetype: ${spec.archetypeId} ${def?.name ?? ''}`,
    ...(spec.vertical ? [`- Vertical: ${spec.vertical}`] : []),
    `- Geography: ${spec.geographies.join(', ')}`,
    `- Decision maker: ${spec.decisionMakerRole}`,
    `- Must be reachable by: ${spec.requiredContactability}`,
    `- Friction to look for: ${spec.knownFriction}`,
    `- Depth: ${spec.depth}`,
    '',
    '## For EVERY company, you must supply',
    ...mandatory.flatMap(e => [`### ${e.field}`, e.requirement, `**Evidence:** ${e.acceptableEvidence}`, '']),
    '## Supply if you can find it, and say so plainly if you cannot',
    ...optional.flatMap(e => [`### ${e.field}`, e.requirement, `**Evidence:** ${e.acceptableEvidence}`, '']),
    '## Rules',
    '1. **Every factual claim needs the URL of the page you read it on.** A claim with no URL will be recorded as unverified and will not qualify the company.',
    '2. **Never give a URL you did not open.** A URL that does not resolve, or does not contain the claim, invalidates the whole entry and wastes the review.',
    '3. **Report absence as absence.** If there is no published email, write "no published email found". Do not guess a pattern like first@company.com — a guessed address is worse than none.',
    '4. **Do not infer.** If you cannot tell who the decision maker is, say so. An uncertain answer is useful; a confident wrong one is not.',
    '5. **No summaries in place of facts.** "A well-regarded studio" is not a commercial signal. "Lists Nike and Adidas as clients at <url>" is.',
    '6. Quote the exact sentence you relied on where you can. It will be checked.',
    '',
    '## Source preferences',
    `- Preferred: ${spec.sourceRequirements.preferred.join(', ') || 'official company pages and first-party sources'}`,
    `- Not acceptable: ${spec.sourceRequirements.unacceptable.join(', ') || 'AI-generated summaries, content farms, unattributed aggregators'}`,
    '',
    ...(spec.notes ? ['## Notes', spec.notes, ''] : []),
    `_Brief ${spec.promptId} · contract ${spec.contractVersion} · taxonomy ${spec.taxonomyVersion} · requested by ${spec.requestedBy} on ${spec.createdAt.slice(0, 10)}._`,
    '',
  ];
  return lines.join('\n');
}

/** The research fields the engine tracks, exposed so a brief can be generated from an actual intelligence gap. */
export const RESEARCHABLE_FIELDS = FIELD_ORDER;
