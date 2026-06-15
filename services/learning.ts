import type { Store } from "../db/store";
import type { Task, Card, Rating, CompletionEvidence } from "../db/schema";
import { computeToday, type DailySlice, DEFAULT_REVIEW_CAP } from "../lib/dailySlice";
import { currentStreak } from "../lib/streak";
import { grade } from "../lib/fsrs";
import { recordCompletion } from "../lib/completion";

/**
 * Orchestration: Store reads/writes + pure lib logic. Screens call these and
 * stay dumb. Everything here runs headlessly against MemoryStore in tests, so
 * the full read -> make-cards -> review loop is verified without a device.
 */

export interface TodayView {
  slice: DailySlice;
  streak: number;
}

export async function getTodayView(
  store: Store,
  now: number,
  tz: string,
  cap = DEFAULT_REVIEW_CAP,
): Promise<TodayView> {
  const [tasks, dueCards, allCompletions] = await Promise.all([
    store.listTasks({ activeOnly: true }),
    store.listDueCards(now),
    store.listCompletions(),
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
  return { slice, streak };
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
