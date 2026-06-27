import { DateTime } from "luxon";

/**
 * The single source of truth for "what day is it" across Tet — scheduling,
 * the daily push, streaks, and completion writes all key off this so the
 * boundary can never drift between subsystems (eng-review Architecture #3).
 *
 * Tet's day starts at local 4am: a late-night session before 04:00 counts as
 * the prior day. We compare the local wall-clock hour rather than subtracting
 * an absolute 4h duration, so DST transitions and zone changes resolve to the
 * correct calendar date instead of being shifted by a changing UTC offset.
 */

export const DAY_START_HOUR = 4;

export type Instant = Date | number;

function toMillis(instant: Instant): number {
  return instant instanceof Date ? instant.getTime() : instant;
}

/**
 * @param instant absolute moment (Date or epoch ms)
 * @param tz IANA zone, e.g. "America/Los_Angeles". Follows the device zone;
 *           a zone change shifts the 4am boundary with it.
 * @returns local-day key "YYYY-MM-DD"
 */
export function localDayKey(instant: Instant, tz: string): string {
  const dt = DateTime.fromMillis(toMillis(instant), { zone: tz });
  if (!dt.isValid) {
    throw new Error(`localDayKey: invalid zone or instant (${tz})`);
  }
  const local = dt.hour < DAY_START_HOUR ? dt.minus({ days: 1 }) : dt;
  return local.toFormat("yyyy-LL-dd");
}

/**
 * Epoch ms of the current Tet day's start — the 04:00 boundary of the local
 * calendar date that {@link localDayKey} resolves `instant` to. Use as the
 * lower bound when counting "things done today" (e.g. reviews) so the window
 * matches the day boundary everything else keys off.
 */
export function startOfTetDay(instant: Instant, tz: string): number {
  const key = localDayKey(instant, tz);
  const start = DateTime.fromISO(key, { zone: tz }).set({
    hour: DAY_START_HOUR,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  if (!start.isValid) {
    throw new Error(`startOfTetDay: invalid zone or instant (${tz})`);
  }
  return start.toMillis();
}

/** Calendar date one Tet-day earlier, for walking streaks backwards. */
export function previousDayKey(dayKey: string): string {
  const dt = DateTime.fromISO(dayKey);
  if (!dt.isValid) throw new Error(`previousDayKey: invalid dayKey (${dayKey})`);
  return dt.minus({ days: 1 }).toFormat("yyyy-LL-dd");
}
