import { localDayKey, type Instant } from "./dayKey";
import type { Task, Card, Completion } from "../db/schema";

/**
 * computeToday — the union of each active task's per-task fixed cadence plus
 * the FSRS-due review cards, capped so one missed day never becomes an
 * unfinishable wall (eng-review Architecture #4 + daily cap #9).
 *
 * Two distinct backlog policies, intentionally:
 *   - FSRS due cards carry over (standard SRS) and are surfaced oldest-first;
 *     overflow beyond `cap` rolls to later days but is NOT dropped.
 *   - Fixed-cadence tasks (youtube/reading) don't roll over — a task done
 *     today simply drops out of the slice (post-completion shrink).
 */

export const DEFAULT_REVIEW_CAP = 30;

export interface DailySliceInput {
  tasks: Task[];
  /** Candidate review cards (typically already filtered to due<=now by query). */
  cards: Card[];
  completions: Completion[];
  now: Instant;
  tz: string;
  cap?: number;
}

export interface TaskSliceItem {
  task: Task;
  /** How much of this task to do today (its cadence). */
  count: number;
}

export interface DailySlice {
  dayKey: string;
  tasks: TaskSliceItem[];
  /** Due cards to surface today, oldest-first, length <= cap. */
  reviewCards: Card[];
  /** Due cards beyond the cap — roll to later days, oldest-first. */
  reviewOverflow: Card[];
}

export function computeToday(input: DailySliceInput): DailySlice {
  const { tasks, cards, completions, now, tz } = input;
  const cap = input.cap ?? DEFAULT_REVIEW_CAP;
  const dayKey = localDayKey(now, tz);
  const nowMs = now instanceof Date ? now.getTime() : now;

  const doneToday = new Set(
    completions
      .filter((c) => c.date === dayKey && c.verified)
      .map((c) => c.task_id),
  );

  const taskItems: TaskSliceItem[] = tasks
    .filter((t) => t.active && !doneToday.has(t.id))
    .map((t) => ({ task: t, count: t.cadence }));

  const due = cards
    .filter((c) => c.due <= nowMs)
    .sort((a, b) => a.due - b.due);

  return {
    dayKey,
    tasks: taskItems,
    reviewCards: due.slice(0, cap),
    reviewOverflow: due.slice(cap),
  };
}
