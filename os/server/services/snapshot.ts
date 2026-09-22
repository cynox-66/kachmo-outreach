import 'server-only';
import { cache } from 'react';
import { loadCanonical, type CanonicalSnapshot } from '../repo/canonical';

/**
 * ONE canonical snapshot per request (audit E1).
 *
 * Pages used to call `loadCanonical()` once per service — Today read every lead, every suppression entry and every
 * analytics event three times, plus once more in the layout. React's `cache()` scopes this read to a single server
 * request: the page and every service it calls share one snapshot, and the next request always reads afresh, so
 * nothing is ever served stale across requests. Services still accept an explicit snapshot, which is how tests and
 * CLIs call them.
 */
export const requestSnapshot = cache((): Promise<CanonicalSnapshot> => loadCanonical());
