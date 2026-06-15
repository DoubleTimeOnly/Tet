import { DateTime } from "luxon";
import type { Instant } from "./dayKey";

/**
 * Daily reminder scheduling (eng-review #6). Local notifications fire reliably
 * but carry frozen text, so the push is a static nudge ("Time for today's
 * learning") and the live slice is computed when the app opens — never baked
 * into the notification body.
 *
 * This module owns only the pure timing math so it's testable; the
 * expo-notifications side effects live in services/notifications.ts.
 */

export const DEFAULT_REMINDER_HOUR = 9;

export interface DailyTrigger {
  /** Local hour the reminder repeats at (0-23). */
  hour: number;
  minute: number;
}

/**
 * Next absolute moment the daily reminder should fire: today at hour:minute
 * if that's still ahead, otherwise tomorrow. Pure — drives both scheduling
 * and tests.
 */
export function nextDailyTrigger(
  now: Instant,
  tz: string,
  trigger: DailyTrigger = { hour: DEFAULT_REMINDER_HOUR, minute: 0 },
): Date {
  const ms = now instanceof Date ? now.getTime() : now;
  const dt = DateTime.fromMillis(ms, { zone: tz });
  if (!dt.isValid) throw new Error(`nextDailyTrigger: invalid zone ${tz}`);

  let fire = dt.set({
    hour: trigger.hour,
    minute: trigger.minute,
    second: 0,
    millisecond: 0,
  });
  if (fire <= dt) fire = fire.plus({ days: 1 });
  return fire.toJSDate();
}

export const REMINDER_TITLE = "Tet";
export const REMINDER_BODY = "Time for today's learning — open to see your slice.";
