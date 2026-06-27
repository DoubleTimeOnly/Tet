import type { Deck, Task, Card, Note, Review, Completion } from "./schema";
import type { BackupData } from "../lib/backup";

/** Editable task parameters (everything a user can change after creation). */
export interface TaskParams {
  title: string;
  source_ref: string | null;
  cadence: number;
  makes_cards_count: number;
  reading_target: number | null;
}

/**
 * Persistence boundary. The app logic and services depend only on this
 * interface, never on expo-sqlite directly, so:
 *   - SqliteStore backs the native dev build,
 *   - MemoryStore backs `expo start --web` and node tests (the whole
 *     read->make->review loop is exercised headlessly against it).
 */
export interface Store {
  init(): Promise<void>;

  // decks
  insertDeck(deck: Deck): Promise<void>;
  listDecks(): Promise<Deck[]>;

  // tasks
  insertTask(task: Task): Promise<void>;
  setTaskActive(id: string, active: boolean): Promise<void>;
  /** Edit a task's user-facing parameters (title, source, cadence, gates). */
  updateTaskParams(id: string, params: TaskParams): Promise<void>;
  /** Persist a task's opaque JSON state blob (e.g. YouTube playlist cache). */
  updateTaskMeta(id: string, meta: string | null): Promise<void>;
  listTasks(opts?: { activeOnly?: boolean }): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;

  // notes (sibling groups: shared source text -> generated cards)
  insertNote(note: Note): Promise<void>;
  getNote(id: string): Promise<Note | null>;
  /** Persist a note's edited shared source (callers regenerate its cards). */
  updateNoteFields(id: string, fields: string): Promise<void>;
  /** Every note (backup / export). */
  listNotes(): Promise<Note[]>;

  // cards
  insertCard(card: Card): Promise<void>;
  /** Persist a card's scheduling after grade() — fsrs_state/due/state_label. */
  updateCardScheduling(card: Card): Promise<void>;
  /** Edit a card's question/answer text (review-time correction). */
  updateCardContent(id: string, front: string, back: string): Promise<void>;
  /** Hard-delete a card (note regeneration dropping a removed sibling). */
  deleteCard(id: string): Promise<void>;
  /** Soft-delete / restore: ignored cards are skipped by listDueCards. */
  setCardIgnored(id: string, ignored: boolean): Promise<void>;
  getCard(id: string): Promise<Card | null>;
  /** A note's cards (for regeneration after an edit). */
  listCardsByNote(noteId: string): Promise<Card[]>;
  /** Non-ignored cards with due <= nowMs, oldest-first, optionally limited. */
  listDueCards(nowMs: number, limit?: number): Promise<Card[]>;
  /** Every card across all decks (Library views, export). */
  listAllCards(): Promise<Card[]>;
  countCardsBySourceTask(taskId: string): Promise<number>;

  // reviews
  insertReview(review: Review): Promise<void>;
  /** Total graded reviews — each is one flashcard reviewed (XP source). */
  countReviews(): Promise<number>;
  /** Reviews graded at/after `sinceMs` — used to count today's reviews. */
  countReviewsSince(sinceMs: number): Promise<number>;
  /** Reviews graded at/after `sinceMs` (rows), to attribute them to decks. */
  listReviewsSince(sinceMs: number): Promise<Review[]>;

  // completions
  insertCompletion(completion: Completion): Promise<void>;
  listCompletionsForDay(dayKey: string): Promise<Completion[]>;
  /** All completions (callers bound the window, e.g. streak). */
  listCompletions(): Promise<Completion[]>;

  // bulk (backup / anki import)
  exportAll(): Promise<BackupData>;
  /** Atomic replace of the entire dataset (backup restore). */
  replaceAll(data: BackupData): Promise<void>;
  /** Append decks + their notes + cards (imports) without touching the rest. */
  insertMany(decks: Deck[], cards: Card[], notes?: Note[]): Promise<void>;
}
