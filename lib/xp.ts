import type { Completion } from "../db/schema";

/**
 * XP & levels — light gamification, fully DERIVED from existing activity and
 * never persisted (same philosophy as lib/streak). XP comes from two sources:
 *   - flashcards: 1 XP per card reviewed (one row in the reviews table), and
 *   - youtube: 1 XP per minute of content (captured from the player at watch
 *     time and stored in the completion's evidence).
 *
 * Deriving rather than storing means a backup restore reconstructs the bar
 * exactly, and there's no counter to drift out of sync with reality.
 */

/** Minutes credited by a completion (0 for non-youtube or pre-feature data). */
export function youtubeMinutes(c: Completion): number {
  return c.evidence.type === "youtube" ? c.evidence.minutes ?? 0 : 0;
}

export interface XpInput {
  /** Total graded reviews — each is one flashcard reviewed, worth 1 XP. */
  reviews: number;
  /** Every completion; only youtube ones contribute (their minutes). */
  completions: Completion[];
}

export function totalXp(input: XpInput): number {
  const ytMinutes = input.completions.reduce((sum, c) => sum + youtubeMinutes(c), 0);
  return input.reviews + ytMinutes;
}

/**
 * Size of a level's bar, per spec: 100 XP per level, +100 each decade — so
 * levels 1-9 cost 100, 10-19 cost 200, 20-29 cost 300, and so on.
 */
export function barSize(level: number): number {
  return (Math.floor(level / 10) + 1) * 100;
}

export interface LevelProgress {
  /** Current level (starts at 1). */
  level: number;
  /** XP accumulated within the current level's bar. */
  xpIntoLevel: number;
  /** XP the current level's bar needs to advance to the next. */
  xpForLevel: number;
  totalXp: number;
}

/** Walk the bars from level 1, consuming XP, to find the current level. */
export function levelForXp(totalXp: number): LevelProgress {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  while (remaining >= barSize(level)) {
    remaining -= barSize(level);
    level += 1;
  }
  return { level, xpIntoLevel: remaining, xpForLevel: barSize(level), totalXp };
}
