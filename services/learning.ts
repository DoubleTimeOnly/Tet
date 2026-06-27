import type { Store } from "../db/store";
import type { Task, Card, Rating, CompletionEvidence } from "../db/schema";
import {
  computeToday,
  flashcardSlice,
  type DailySlice,
  type FlashcardSlice,
} from "../lib/dailySlice";
import { currentStreak, longestStreak } from "../lib/streak";
import { startOfTetDay, localDayKey } from "../lib/dayKey";
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
): Promise<TodayView> {
  const [tasks, dueCards, allCompletions, reviews, reviewedDeckIds] =
    await Promise.all([
      store.listTasks({ activeOnly: true }),
      store.listDueCards(now),
      store.listCompletions(),
      store.countReviews(),
      reviewedDeckIdsToday(store, now, tz),
    ]);
  // computeToday derives the dayKey itself and filters completions to today.
  const slice = computeToday({
    tasks,
    cards: dueCards,
    completions: allCompletions,
    now,
    tz,
    reviewedDeckIds,
  });
  const streak = currentStreak({ completions: allCompletions, now, tz });
  const maxStreak = longestStreak({ completions: allCompletions });
  const xp = levelForXp(totalXp({ reviews, completions: allCompletions }));
  return { slice, streak, maxStreak, xp };
}

/**
 * The deck of each card reviewed today — one entry per review — so a flashcard
 * task's progress can be scoped to its deck. Reviews carry only a card id, so
 * we resolve each through the cards table.
 */
async function reviewedDeckIdsToday(
  store: Store,
  now: number,
  tz: string,
): Promise<string[]> {
  const [todaysReviews, allCards] = await Promise.all([
    store.listReviewsSince(startOfTetDay(now, tz)),
    store.listAllCards(),
  ]);
  const deckByCard = new Map(allCards.map((c) => [c.id, c.deck_id]));
  return todaysReviews
    .map((r) => deckByCard.get(r.card_id))
    .filter((d): d is string => d != null);
}

/**
 * Build the deck-scoped review queue for one flashcard task: the due cards in
 * its deck, capped to the day's remaining goal (cadence minus what's already
 * been reviewed today). The single source of truth the review screen pulls.
 */
export async function getFlashcardQueue(
  store: Store,
  task: Task,
  now: number,
  tz: string,
): Promise<FlashcardSlice> {
  const [dueCards, reviewedDeckIds] = await Promise.all([
    store.listDueCards(now),
    reviewedDeckIdsToday(store, now, tz),
  ]);
  const reviewed = task.source_ref
    ? reviewedDeckIds.filter((d) => d === task.source_ref).length
    : reviewedDeckIds.length;
  return flashcardSlice(task, dueCards, reviewed);
}

/** Grade a due card: advance FSRS, persist scheduling, record the review. */
export async function gradeCard(
  store: Store,
  cardId: string,
  rating: Rating,
  now: number,
  tz: string,
): Promise<Card> {
  const card = await store.getCard(cardId);
  if (!card) throw new Error(`gradeCard: no card ${cardId}`);
  const { card: next, review } = grade(card, rating, now);
  await store.updateCardScheduling(next);
  await store.insertReview(review);
  // Credit flashcard tasks from the day's cumulative review count, so a day's
  // quota counts toward streaks even when spread across several short sessions.
  await creditFlashcardTasks(store, now, tz);
  return next;
}

/**
 * Record a (verified) completion for each active flashcard task whose daily
 * cadence has been met by today's deck-scoped reviews. Idempotent: skips a task
 * that already has a verified completion today, so repeated grades don't pile
 * up duplicate rows. Derives progress from the persisted reviews table rather
 * than a per-session counter, so it survives leaving and re-entering review.
 */
export async function creditFlashcardTasks(
  store: Store,
  now: number,
  tz: string,
): Promise<void> {
  const [tasks, reviewedDeckIds, todaysCompletions] = await Promise.all([
    store.listTasks({ activeOnly: true }),
    reviewedDeckIdsToday(store, now, tz),
    store.listCompletionsForDay(localDayKey(now, tz)),
  ]);
  const alreadyDone = new Set(
    todaysCompletions.filter((c) => c.verified).map((c) => c.task_id),
  );
  const reviewedFor = (task: Task) =>
    task.source_ref
      ? reviewedDeckIds.filter((d) => d === task.source_ref).length
      : reviewedDeckIds.length;
  const toCredit = tasks.filter(
    (t) =>
      t.type === "flashcard" &&
      !alreadyDone.has(t.id) &&
      reviewedFor(t) >= t.cadence,
  );
  await Promise.all(
    toCredit.map((task) =>
      completeTask(
        store,
        task,
        { type: "flashcard", n: reviewedFor(task) },
        now,
        tz,
      ),
    ),
  );
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
