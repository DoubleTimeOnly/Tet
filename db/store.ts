import type { Deck, Task, Card, Review, Completion } from "./schema";
import type { BackupData } from "../lib/backup";

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
  /** Persist a task's opaque JSON state blob (e.g. YouTube playlist cache). */
  updateTaskMeta(id: string, meta: string | null): Promise<void>;
  listTasks(opts?: { activeOnly?: boolean }): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;

  // cards
  insertCard(card: Card): Promise<void>;
  /** Persist a card's scheduling after grade() — fsrs_state/due/state_label. */
  updateCardScheduling(card: Card): Promise<void>;
  /** Edit a card's question/answer text (review-time correction). */
  updateCardContent(id: string, front: string, back: string): Promise<void>;
  /** Soft-delete / restore: ignored cards are skipped by listDueCards. */
  setCardIgnored(id: string, ignored: boolean): Promise<void>;
  getCard(id: string): Promise<Card | null>;
  /** Non-ignored cards with due <= nowMs, oldest-first, optionally limited. */
  listDueCards(nowMs: number, limit?: number): Promise<Card[]>;
  /** Every card across all decks (Library views, export). */
  listAllCards(): Promise<Card[]>;
  countCardsBySourceTask(taskId: string): Promise<number>;

  // reviews
  insertReview(review: Review): Promise<void>;
  /** Total graded reviews — each is one flashcard reviewed (XP source). */
  countReviews(): Promise<number>;

  // completions
  insertCompletion(completion: Completion): Promise<void>;
  listCompletionsForDay(dayKey: string): Promise<Completion[]>;
  /** All completions (callers bound the window, e.g. streak). */
  listCompletions(): Promise<Completion[]>;

  // bulk (backup / anki import)
  exportAll(): Promise<BackupData>;
  /** Atomic replace of the entire dataset (backup restore). */
  replaceAll(data: BackupData): Promise<void>;
  /** Append a deck + its cards (anki import) without touching the rest. */
  insertMany(decks: Deck[], cards: Card[]): Promise<void>;
}
