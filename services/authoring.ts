import type { Store } from "../db/store";
import type { Deck, Task, Card, Note, NoteKind, TaskType } from "../db/schema";
import { createCard } from "../lib/fsrs";
import { generateCards, reconcileNoteCards } from "../lib/notes";
import { newId } from "../lib/id";

/** Find a deck by exact name, or create it. Used to land cards made from a task. */
export async function findOrCreateDeck(
  store: Store,
  name: string,
  now: number = Date.now(),
): Promise<Deck> {
  const existing = (await store.listDecks()).find((d) => d.name === name);
  return existing ?? createDeck(store, name, now);
}

/**
 * Author a card from a youtube/reading task so it counts toward that task's
 * makes_cards_count gate. Cards land in a per-task deck ("From: <title>") and
 * carry source_task_id so completeTask can verify once enough exist.
 */
export async function addCardFromTask(
  store: Store,
  task: Task,
  front: string,
  back: string,
  now: number = Date.now(),
): Promise<Card> {
  const deck = await findOrCreateDeck(store, `From: ${task.title}`, now);
  return addCard(store, { deckId: deck.id, front, back, sourceTaskId: task.id }, now);
}

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
    meta: null,
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

export interface NewNoteInput {
  deckId: string;
  kind: NoteKind;
  /** Shared source as JSON (see lib/notes.makeFields). */
  fields: string;
  sourceTaskId?: string | null;
}

/**
 * Author a note and generate its sibling cards. The note owns the shared text;
 * each generated card carries note_id + its template index, so a later
 * updateNote regenerates them while preserving schedules.
 */
export async function addNote(
  store: Store,
  input: NewNoteInput,
  now: number = Date.now(),
): Promise<{ note: Note; cards: Card[] }> {
  const note: Note = {
    id: newId(),
    deck_id: input.deckId,
    kind: input.kind,
    fields: input.fields,
    source_task_id: input.sourceTaskId ?? null,
    created_at: now,
  };
  await store.insertNote(note);
  const cards = generateCards(note).map((g) =>
    createCard({
      deckId: note.deck_id,
      front: g.front,
      back: g.back,
      sourceTaskId: note.source_task_id,
      noteId: note.id,
      template: g.template,
      now,
    }),
  );
  for (const c of cards) await store.insertCard(c);
  return { note, cards };
}

/**
 * Edit a note's shared source and regenerate its cards: surviving siblings keep
 * their id (and FSRS schedule) with refreshed text, newly added blanks become
 * fresh cards, and removed blanks are deleted. This is what makes an edit to one
 * sibling propagate to them all.
 */
export async function updateNote(
  store: Store,
  noteId: string,
  fields: string,
  now: number = Date.now(),
): Promise<void> {
  const note = await store.getNote(noteId);
  if (!note) throw new Error(`updateNote: no note ${noteId}`);
  const next: Note = { ...note, fields };
  const existing = await store.listCardsByNote(noteId);
  const { updated, inserted, removed } = reconcileNoteCards(next, existing);

  await store.updateNoteFields(noteId, fields);
  for (const u of updated) await store.updateCardContent(u.id, u.front, u.back);
  for (const g of inserted) {
    await store.insertCard(
      createCard({
        deckId: note.deck_id,
        front: g.front,
        back: g.back,
        sourceTaskId: note.source_task_id,
        noteId: note.id,
        template: g.template,
        now,
      }),
    );
  }
  for (const id of removed) await store.deleteCard(id);
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
