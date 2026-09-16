/**
 * Versioned taxonomy boundary.
 *
 * WHAT THIS IS: a declaration of the archetype/vertical vocabulary the current data actually uses, so that domain
 * logic (scoring, playbooks, research prompts, inventory thresholds) can refer to a versioned configuration instead
 * of hard-coding string literals in a dozen places.
 *
 * WHAT THIS IS NOT: a redefinition. Methodology v1.0 behaviour is unchanged — `core/leads/opportunity.ts` and
 * `core/queues/calls.ts` still key their defaults off `lead.archetype_id` exactly as before. Nothing here is read
 * by a qualification gate or a score.
 *
 * KNOWN INCONSISTENCY (recorded, deliberately not fixed here):
 *   `archetype_label` in the 120-lead dataset is overloaded. Archetype 2 carries two different labels
 *   ("Funded Startup", "Startup Craft Upgrade") and archetype 6 carries ten distinct INDUSTRY VERTICALS
 *   ("Dental Clinics & Chains", "Jewelry Showrooms", …) rather than one archetype name. Archetype and vertical are
 *   therefore not currently separate dimensions in the stored data. Separating them is an open product decision
 *   (Phase 0 §3.1); ADR-013 records why it is deferred rather than silently corrected.
 */

export const TAXONOMY_VERSION = '1.0' as const;

export interface ArchetypeDefinition {
  /** The value stored in `lead.archetype_id`. */
  id: string;
  /** Canonical name. Where the data disagrees with itself, `observedLabels` lists what is actually stored. */
  name: string;
  /** Every distinct `archetype_label` observed for this id in the 120-lead dataset at commit 48cfbc0. */
  observedLabels: readonly string[];
  /** Default owner in the current operating model. */
  defaultOwner: 'DEV' | 'AADI';
  /** True when `observedLabels` holds industry verticals rather than variations on one archetype name. */
  labelsAreVerticals: boolean;
}

/**
 * The six archetype IDs in production. No archetype is added, removed or renamed here.
 * The paused UK micro-trades / Companies House archetype is deliberately absent: it is not in the data and
 * reviving it requires explicit approval.
 */
export const ARCHETYPES_V1: readonly ArchetypeDefinition[] = [
  {
    id: '1',
    name: 'White-Label Agency',
    observedLabels: ['1: White-Label Agency'],
    defaultOwner: 'DEV',
    labelsAreVerticals: false,
  },
  {
    id: '2',
    name: 'Startup Craft Upgrade',
    observedLabels: ['2: Startup Craft Upgrade', '2: Funded Startup'],
    defaultOwner: 'DEV',
    labelsAreVerticals: false,
  },
  {
    id: '3',
    name: 'Interactive System',
    observedLabels: ['3: Interactive System'],
    defaultOwner: 'DEV',
    labelsAreVerticals: false,
  },
  {
    id: '4',
    name: 'Workflow/Booking Overhaul',
    observedLabels: ['4: Workflow/Booking Overhaul'],
    defaultOwner: 'DEV',
    labelsAreVerticals: false,
  },
  {
    id: '5',
    name: 'Zero-Presence Greenfield',
    observedLabels: ['5: Zero-Presence Greenfield'],
    defaultOwner: 'DEV',
    labelsAreVerticals: false,
  },
  {
    id: '6',
    name: 'India Service Business',
    observedLabels: [
      '6: Architecture & Interior Studios',
      '6: Boutique Hotel & Luxury Resort',
      '6: Coaching Institutes',
      '6: D2C Consumer Brands',
      '6: Dental Clinics & Chains',
      '6: Jewelry Showrooms',
      '6: Private Hospitals & Clinics',
      '6: Real Estate Developers',
      '6: Restaurant Chains & Cloud Kitchens',
      '6: Wedding Venues & Banquet Halls',
    ],
    defaultOwner: 'AADI',
    labelsAreVerticals: true,
  },
] as const;

export const ARCHETYPE_IDS: readonly string[] = ARCHETYPES_V1.map(a => a.id);

export const archetypeById = (id: string): ArchetypeDefinition | undefined => ARCHETYPES_V1.find(a => a.id === id);

/** The owner rule the CSV import applies. Kept here so the single place that encodes it is versioned. */
export const defaultOwnerForArchetype = (id: string): 'DEV' | 'AADI' => (id === '6' ? 'AADI' : 'DEV');

/**
 * A vertical is a market segment, independent of the archetype (the play Kachmo runs). In the current data the two
 * are conflated inside `archetype_label`; this function recovers the vertical where one is recoverable, and returns
 * null rather than guessing where it is not.
 */
export function verticalFromLabel(archetypeId: string, label: string): string | null {
  const def = archetypeById(archetypeId);
  if (!def?.labelsAreVerticals) return null;
  const stripped = label.replace(/^\d+:\s*/, '').trim();
  return stripped.length ? stripped : null;
}

/** Geographies the current dataset covers, as stored in `location_country`. Used for inventory reporting only. */
export const OBSERVED_GEOGRAPHIES_V1: readonly string[] = [
  'Australia',
  'Austria',
  'Canada',
  'Denmark',
  'Germany',
  'India',
  'Netherlands',
  'Northern Ireland',
  'Norway',
  'Scotland',
  'Sweden',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
] as const;
