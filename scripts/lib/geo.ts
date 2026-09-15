// Timezone resolution and date arithmetic live in core/geo/timezone.ts. Only the clock/environment read stays here.
export { resolveTimezone, addDays } from '../../core/geo/timezone.js';

/** Today's date in IST (Kachmo's operating timezone). KACHMO_TODAY overrides for tests. */
export function todayIst(): string {
  if (process.env.KACHMO_TODAY) return process.env.KACHMO_TODAY;
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
