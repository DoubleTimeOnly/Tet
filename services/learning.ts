import type { Store } from "../db/store";
import type { Task, Card, Rating, CompletionEvidence } from "../db/schema";
import { computeToday, type DailySlice, DEFAULT_REVIEW_CAP } from "../lib/dailySlice";
import { currentStreak, longestStreak } from "../lib/streak";
import { grade } from "../lib/fsrs";
import { recordCompletion } from "../lib/completion";
import { totalXp, levelForXp, type LevelProgress } from "../lib/xp";

/**
 * Orchestration: Store reads/writes + pure lib logic. Screens call these and
 * stay dumb. Everything here runs headlessly against MemoryStore in tests, so
 * the full read -> make-cards -> review loop is verified without a device.
 */

export interface TodayView {
  slice: DailySlice;
  /** Current consecutive-day streak. */
  streak: number;
  /** Best streak ever achieved (for the "best N" display). */
  maxStreak: number;
  /** XP level + progress, derived from reviews + youtube minutes. */
  xp: LevelProgress;
}

export async function getTodayView(
  store: Store,
  now: number,
  tz: string,
  cap = DEFAULT_REVIEW_CAP,
): Promise<TodayView> {
  const [tasks, dueCards, allCompletions, reviews] = await Promise.all([
    store.listTasks({ activeOnly: true }),
    store.listDueCards(now),
    store.listCompletions(),
    store.countReviews(),
  ]);
  // computeToday derives the dayKey itself and filters completions to today.
  const slice = computeToday({
    tasks,
    cards: dueCards,
    completions: allCompletions,
    now,
    tz,
    cap,
  });
  const streak = currentStreak({ completions: allCompletions, now, tz });
  const maxStreak = longestStreak({ completions: allCompletions });
  const xp = levelForXp(totalXp({ reviews, completions: allCompletions }));
  return { slice, streak, maxStreak, xp };
}

/** Grade a due card: advance FSRS, persist scheduling, record the review. */
export async function gradeCard(
  store: Store,
  cardId: string,
  rating: Rating,
  now: number,
): Promise<Card> {
  const card = await store.getCard(cardId);
  if (!card) throw new Error(`gradeCard: no card ${cardId}`);
  const { card: next, review } = grade(card, rating, now);
  await store.updateCardScheduling(next);
  await store.insertReview(review);
  return next;
}

/** Edit a card's question/answer text (e.g. a typo spotted while reviewing). */
export async function editCard(
  store: Store,
  cardId: string,
  front: string,
  back: string,
): Promise<void> {
  await store.updateCardContent(cardId, front.trim(), back.trim());
}

/**
 * Ignore a card: soft-delete so it stops appearing in review but stays in the
 * database (and in exports) for later recovery. Pass ignored=false to restore.
 */
export async function setCardIgnored(
  store: Store,
  cardId: string,
  ignored: boolean,
): Promise<void> {
  await store.setCardIgnored(cardId, ignored);
}

/**
 * Record a task completion. Counts the cards already made from this task so
 * the makes_cards_count gate is evaluated against live data.
 */
export async function completeTask(
  store: Store,
  task: Task,
  evidence: CompletionEvidence,
  now: number,
  tz: string,
) {
  const cardsMade = await store.countCardsBySourceTask(task.id);
  const completion = recordCompletion({ task, evidence, now, tz, cardsMade });
  await store.insertCompletion(completion);
  return completion;
}
