import type { Store } from "../db/store";
import type { Deck, Task, Card, TaskType } from "../db/schema";
import { createCard } from "../lib/fsrs";
import { newId } from "../lib/id";

/** Deck / task / card creation used by the editor screens and seeding. */

export async function createDeck(
  store: Store,
  name: string,
  now: number = Date.now(),
): Promise<Deck> {
  const deck: Deck = { id: newId(), name, created_at: now };
  await store.insertDeck(deck);
  return deck;
}

export interface NewTaskInput {
  type: TaskType;
  title: string;
  sourceRef?: string | null;
  cadence?: number;
  makesCardsCount?: number;
  readingTarget?: number | null;
}

export async function createTask(
  store: Store,
  input: NewTaskInput,
  now: number = Date.now(),
): Promise<Task> {
  const task: Task = {
    id: newId(),
    type: input.type,
    title: input.title,
    source_ref: input.sourceRef ?? null,
    cadence: input.cadence ?? 1,
    makes_cards_count: input.makesCardsCount ?? 0,
    reading_target: input.readingTarget ?? null,
    active: true,
    created_at: now,
  };
  await store.insertTask(task);
  return task;
}

export interface NewCardInput {
  deckId: string;
  front: string;
  back: string;
  sourceTaskId?: string | null;
}

export async function addCard(
  store: Store,
  input: NewCardInput,
  now: number = Date.now(),
): Promise<Card> {
  const card = createCard({
    deckId: input.deckId,
    front: input.front,
    back: input.back,
    sourceTaskId: input.sourceTaskId ?? null,
    now,
  });
  await store.insertCard(card);
  return card;
}

/**
 * Cold-start seed (eng-review #8): a starter deck with a few cards plus a
 * daily flashcard-review task, so day 1 isn't an empty screen.
 */
export async function seedStarterDeck(
  store: Store,
  now: number = Date.now(),
): Promise<{ deck: Deck; task: Task }> {
  const deck = await createDeck(store, "Starter", now);
  const samples: Array<[string, string]> = [
    ["What does FSRS schedule?", "When to next review a card"],
    ["Tet day boundary", "Local 4am"],
    ["Reading verification source", "Readwise reading_progress"],
  ];
  for (const [front, back] of samples) {
    await addCard(store, { deckId: deck.id, front, back }, now);
  }
  const task = await createTask(
    store,
    { type: "flashcard", title: "Review flashcards", cadence: 10 },
    now,
  );
  return { deck, task };
}
