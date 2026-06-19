import { localDayKey, previousDayKey, type Instant } from "./dayKey";
import type { Completion } from "../db/schema";

/**
 * currentStreak — consecutive Tet-days with at least one verified completion,
 * counted backwards from today over a bounded window.
 *
 * Semantics tie back to the design's missed-task rules:
 *   - A day "counts" iff it has >=1 verified completion. Doing any verified
 *     task that day keeps the streak alive.
 *   - FSRS due cards that carry over create NO obligation of their own, so an
 *     unreviewed backlog never breaks the streak by itself.
 *   - A fixed-cadence (video/reading) day with nothing verified is a gap, and
 *     the streak breaks at that 4am boundary.
 *   - Today is given grace: if today has no completion yet we start counting
 *     from yesterday rather than treating the in-progress day as a break.
 */

export const DEFAULT_WINDOW_DAYS = 400;

export interface CurrentStreakInput {
  completions: Completion[];
  now: Instant;
  tz: string;
  /** Upper bound on how far back to scan (prevents unbounded walks). */
  windowDays?: number;
}

export function currentStreak(input: CurrentStreakInput): number {
  const { completions, now, tz } = input;
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;

  const satisfied = new Set(
    completions.filter((c) => c.verified).map((c) => c.date),
  );

  const today = localDayKey(now, tz);

  // Grace: an in-progress today with nothing done yet doesn't break a streak
  // that was alive yesterday — start the walk from yesterday instead.
  let cursor = satisfied.has(today) ? today : previousDayKey(today);

  let streak = 0;
  for (let i = 0; i < windowDays && satisfied.has(cursor); i++) {
    streak++;
    cursor = previousDayKey(cursor);
  }
  return streak;
}

/**
 * longestStreak — the best run of consecutive satisfied days ever achieved,
 * scanning the full history (not just the trailing window). Same "a day counts
 * iff it has >=1 verified completion" rule as currentStreak, so the two agree
 * on what a streak day is.
 */
export function longestStreak(input: { completions: Completion[] }): number {
  const days = [
    ...new Set(input.completions.filter((c) => c.verified).map((c) => c.date)),
  ].sort();

  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of days) {
    run = prev !== null && previousDayKey(day) === prev ? run + 1 : 1;
    if (run > best) best = run;
    prev = day;
  }
  return best;
}
