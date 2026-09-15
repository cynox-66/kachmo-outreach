/** City keys are matched as substrings of the lowercased city ("London (West End)" → london). Longest key wins. */
const CITY_TIMEZONE_MAP: Record<string, string> = {
  'london': 'Europe/London',
  'new york': 'America/New_York',
  'brooklyn': 'America/New_York',
  'long island': 'America/New_York',
  ', ny': 'America/New_York',
  'boston': 'America/New_York',
  'asheville': 'America/New_York',
  'houston': 'America/Chicago',
  'san francisco': 'America/Los_Angeles',
  'los angeles': 'America/Los_Angeles',
  'sausalito': 'America/Los_Angeles',
  'toronto': 'America/Toronto',
  'amsterdam': 'Europe/Amsterdam',
  'berlin': 'Europe/Berlin',
  'copenhagen': 'Europe/Copenhagen',
  'dublin': 'Europe/Dublin',
  'stockholm': 'Europe/Stockholm',
  'oslo': 'Europe/Oslo',
  'vienna': 'Europe/Vienna',
  'melbourne': 'Australia/Melbourne',
  'sydney': 'Australia/Sydney',
  'mosman': 'Australia/Sydney',
  'gold coast': 'Australia/Brisbane',
  'dubai': 'Asia/Dubai',
  'singapore': 'Asia/Singapore',
};

/** Only countries with a single timezone may fall back to the country. */
const SINGLE_TZ_COUNTRIES: Record<string, string> = {
  'united kingdom': 'Europe/London',
  'scotland': 'Europe/London',
  'northern ireland': 'Europe/London',
  'wales': 'Europe/London',
  'england': 'Europe/London',
  'ireland': 'Europe/Dublin',
  'germany': 'Europe/Berlin',
  'netherlands': 'Europe/Amsterdam',
  'denmark': 'Europe/Copenhagen',
  'sweden': 'Europe/Stockholm',
  'norway': 'Europe/Oslo',
  'austria': 'Europe/Vienna',
  'india': 'Asia/Kolkata',
  'united arab emirates': 'Asia/Dubai',
  'singapore': 'Asia/Singapore',
};

export function resolveTimezone(city: string, country: string): { timezone: string | null; basis: string } {
  const c = (city || '').toLowerCase();
  const key = Object.keys(CITY_TIMEZONE_MAP)
    .filter(k => c.includes(k))
    .sort((a, b) => b.length - a.length)[0];
  if (key) return { timezone: CITY_TIMEZONE_MAP[key], basis: `city match "${key}"` };
  const co = (country || '').toLowerCase().trim();
  if (SINGLE_TZ_COUNTRIES[co]) return { timezone: SINGLE_TZ_COUNTRIES[co], basis: `single-timezone country "${co}"` };
  return { timezone: null, basis: `unresolved: "${city}, ${country}" (multi-timezone country or unknown city — not guessed)` };
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
