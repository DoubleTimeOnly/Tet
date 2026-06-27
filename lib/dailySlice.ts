import { localDayKey, type Instant } from "./dayKey";
import { burySiblings } from "./siblings";
import type { Task, Card, Completion } from "../db/schema";

/**
 * computeToday — the day's to-do list: each active task that isn't yet done.
 *
 * Flashcard tasks carry their own deck-scoped review state ({@link FlashcardSlice}):
 * the daily goal is the task's cadence, and the surfaced queue is the remaining
 * `cadence - reviewedToday` due cards in the task's deck. Because progress is
 * derived from the persisted reviews table (not a per-session counter), the
 * count is remembered across leaving and re-entering review, and the task drops
 * out of the slice once its goal is met — even if more cards are technically due
 * (the surplus rolls to later days, standard SRS carry-over).
 *
 * Fixed-cadence tasks (youtube/reading) don't roll over: a task verified today
 * simply drops out of the slice (post-completion shrink).
 */

/** Default daily cadence for a freshly created/seeded flashcard task. */
export const DEFAULT_REVIEW_CADENCE = 30;

export interface DailySliceInput {
  tasks: Task[];
  /** Candidate review cards (typically already filtered to due<=now by query). */
  cards: Card[];
  completions: Completion[];
  now: Instant;
  tz: string;
  /**
   * Deck id of each review done today — one entry per review — used to scope a
   * flashcard task's progress to its deck. A task that reviews "all decks"
   * (source_ref null) counts the full list.
   */
  reviewedDeckIds?: string[];
}

/** Deck-scoped daily review state for a flashcard task. */
export interface FlashcardSlice {
  /** The deck this task reviews (null = all decks). */
  deckId: string | null;
  /** Daily goal — the task's cadence. */
  goal: number;
  /** Cards reviewed today within this task's deck scope. */
  reviewedToday: number;
  /** Remaining toward the goal (max(0, goal - reviewedToday)). */
  remaining: number;
  /** Due cards to review now, oldest-first, length <= remaining. */
  queue: Card[];
  /** Due cards held back today — siblings + cards beyond the remaining goal. */
  overflow: Card[];
  /** Whether the day's goal has been met. */
  done: boolean;
}

export interface TaskSliceItem {
  task: Task;
  /** Per-day target count (flashcard: remaining toward goal; else cadence). */
  count: number;
  /** Present for flashcard tasks: the deck-scoped review state. */
  flashcards?: FlashcardSlice;
}

export interface DailySlice {
  dayKey: string;
  tasks: TaskSliceItem[];
}

/** Reviews done today that count toward a task scoped to `deckId`. */
function reviewedTodayForDeck(
  deckId: string | null,
  reviewedDeckIds: string[],
): number {
  return deckId
    ? reviewedDeckIds.filter((d) => d === deckId).length
    : reviewedDeckIds.length;
}

/**
 * Pure deck-scoped review slice for one flashcard task. `dueCards` should be
 * due-filtered and oldest-first; this filters to the task's deck, buries
 * sibling cards (multi-cloze / reversed) so they don't surface together, and
 * caps the queue to the day's remaining goal.
 */
export function flashcardSlice(
  task: Task,
  dueCards: Card[],
  reviewedToday: number,
): FlashcardSlice {
  const deckId = task.source_ref;
  const scoped = deckId
    ? dueCards.filter((c) => c.deck_id === deckId)
    : dueCards;
  const { kept, deferred } = burySiblings(scoped);
  const goal = task.cadence;
  const remaining = Math.max(0, goal - reviewedToday);
  return {
    deckId,
    goal,
    reviewedToday,
    remaining,
    queue: kept.slice(0, remaining),
    overflow: [...kept.slice(remaining), ...deferred],
    done: reviewedToday >= goal,
  };
}

export function computeToday(input: DailySliceInput): DailySlice {
  const { tasks, cards, completions, now, tz } = input;
  const reviewedDeckIds = input.reviewedDeckIds ?? [];
  const dayKey = localDayKey(now, tz);
  const nowMs = now instanceof Date ? now.getTime() : now;

  const doneToday = new Set(
    completions
      .filter((c) => c.date === dayKey && c.verified)
      .map((c) => c.task_id),
  );

  const due = cards
    .filter((c) => c.due <= nowMs)
    .sort((a, b) => a.due - b.due);

  const items: TaskSliceItem[] = [];
  for (const task of tasks) {
    if (!task.active) continue;
    if (task.type === "flashcard") {
      const reviewed = reviewedTodayForDeck(task.source_ref, reviewedDeckIds);
      const fc = flashcardSlice(task, due, reviewed);
      // Goal met -> drop for the day (its surplus rolls over via FSRS).
      if (fc.done) continue;
      items.push({ task, count: fc.remaining, flashcards: fc });
    } else {
      if (doneToday.has(task.id)) continue;
      items.push({ task, count: task.cadence });
    }
  }

  return { dayKey, tasks: items };
}
