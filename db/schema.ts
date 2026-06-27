/**
 * Tet v1 data model — raw expo-sqlite (no Drizzle in v1).
 *
 * Source of truth for the resolved schema in the eng-review design doc.
 * `fsrs_state` holds the full ts-fsrs object; `due`/`state_label` are
 * denormalized INDEXED columns kept in sync by the single writer in
 * lib/fsrs.ts (Lane C) so the daily-due query never scans the JSON blob.
 *
 * Shared dependency for Lane A (completion) and Lane C (fsrs, ankiImport,
 * backup). Land schema changes here sequentially to avoid migration conflicts.
 */

export type TaskType = "flashcard" | "youtube" | "reading";
export type Rating = "again" | "hard" | "good" | "easy";
export type CardState = "new" | "learning" | "review";

/**
 * A note's shape. `basic` -> 1 card; `reversed` -> 2 cards (both directions);
 * `cloze` -> 1 card per `==span==`. The note owns the shared source text; its
 * cards are generated from it (see lib/notes.generateCards), so editing a note
 * regenerates every sibling.
 */
export type NoteKind = "basic" | "reversed" | "cloze";

export interface Deck {
  id: string;
  name: string;
  created_at: number;
}

export interface Task {
  id: string;
  type: TaskType;
  title: string;
  /** url for youtube, Readwise document id for reading, null for flashcard. */
  source_ref: string | null;
  /** Per-day slice count the builder sets (e.g. 10 cards/day, 1 video/day). */
  cadence: number;
  /** Follow-up gate: task isn't done until this many cards cite it as source. */
  makes_cards_count: number;
  /**
   * Reading completion threshold on Readwise `reading_progress` (0..1).
   * Per-task override of the ~0.9 default; null for non-reading tasks.
   */
  reading_target: number | null;
  active: boolean;
  created_at: number;
  /**
   * Opaque per-task JSON state. Currently holds a YouTube playlist task's cached
   * items / watched videos / daily pick (see lib/playlist). Null for everything
   * else. Kept as a TEXT blob so task-type-specific state needs no new columns.
   */
  meta: string | null;
}

/**
 * A flashcard "instance": shared source text plus a kind, from which the
 * individual review Cards are generated. Multi-cloze and reversed cards belong
 * to one note so an edit to the shared text propagates to every sibling. Plain
 * basic cards (and Anki / transfer imports) stay note-less — their Card carries
 * its own front/back and note_id is null.
 */
export interface Note {
  id: string;
  deck_id: string;
  kind: NoteKind;
  /**
   * Shared source as JSON. cloze -> `{ text: "==a== not ==b==" }`;
   * basic/reversed -> `{ front, back }`. A TEXT blob (like tasks.meta) so new
   * kinds need no new columns.
   */
  fields: string;
  source_task_id: string | null;
  created_at: number;
}

export interface Card {
  id: string;
  deck_id: string;
  front: string;
  back: string;
  /**
   * Owning note (sibling group), or null for a standalone basic card. When set,
   * front/back are a regenerated CACHE of the note's source for this template —
   * never edit them directly; edit the note (see services/authoring.updateNote).
   */
  note_id: string | null;
  /** Which generated sibling within the note: cloze span index, or reversed 0/1. */
  template: number;
  source_task_id: string | null;
  created_at: number;
  /** Full ts-fsrs card object (JSON). SOURCE OF TRUTH for scheduling. */
  fsrs_state: string;
  /** Denormalized from fsrs_state — epoch ms, INDEXED for the daily query. */
  due: number;
  state_label: CardState;
  /**
   * Soft-delete: an ignored card is excluded from review (listDueCards) but kept
   * in the table so it can be recovered or carried in an export. Defaults false.
   */
  ignored: boolean;
}

export interface Review {
  id: string;
  card_id: string;
  rating: Rating;
  reviewed_at: number;
}

export type CompletionEvidence =
  | { type: "flashcard"; n: number }
  // `minutes` is the video's duration, captured from the player at watch time
  // and used for XP (1 XP/min). Optional: completions written before the
  // gamification feature won't carry it, so readers must default to 0.
  | { type: "youtube"; manual: true; minutes?: number }
  | { type: "reading"; readwise_fraction: number };

export interface Completion {
  id: string;
  task_id: string;
  /** local-day key via lib/dayKey.localDayKey — "YYYY-MM-DD". */
  date: string;
  verified: boolean;
  evidence: CompletionEvidence;
  completed_at: number;
}

/**
 * DDL applied at startup. `due` is indexed because computeToday's hot path is
 * "cards due on/before now"; everything else is keyed by id or task_id.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS decks (
  id         TEXT PRIMARY KEY NOT NULL,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('flashcard','youtube','reading')),
  title             TEXT NOT NULL,
  source_ref        TEXT,
  cadence           INTEGER NOT NULL DEFAULT 1,
  makes_cards_count INTEGER NOT NULL DEFAULT 0,
  reading_target    REAL,
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL,
  meta              TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id             TEXT PRIMARY KEY NOT NULL,
  deck_id        TEXT NOT NULL REFERENCES decks(id),
  kind           TEXT NOT NULL CHECK (kind IN ('basic','reversed','cloze')),
  fields         TEXT NOT NULL,
  source_task_id TEXT REFERENCES tasks(id),
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id             TEXT PRIMARY KEY NOT NULL,
  deck_id        TEXT NOT NULL REFERENCES decks(id),
  front          TEXT NOT NULL,
  back           TEXT NOT NULL,
  note_id        TEXT REFERENCES notes(id),
  template       INTEGER NOT NULL DEFAULT 0,
  source_task_id TEXT REFERENCES tasks(id),
  created_at     INTEGER NOT NULL,
  fsrs_state     TEXT NOT NULL,
  due            INTEGER NOT NULL,
  state_label    TEXT NOT NULL CHECK (state_label IN ('new','learning','review')),
  ignored        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due);
CREATE INDEX IF NOT EXISTS idx_cards_source_task ON cards(source_task_id);
CREATE INDEX IF NOT EXISTS idx_cards_note ON cards(note_id);

CREATE TABLE IF NOT EXISTS reviews (
  id          TEXT PRIMARY KEY NOT NULL,
  card_id     TEXT NOT NULL REFERENCES cards(id),
  rating      TEXT NOT NULL CHECK (rating IN ('again','hard','good','easy')),
  reviewed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS completions (
  id           TEXT PRIMARY KEY NOT NULL,
  task_id      TEXT NOT NULL REFERENCES tasks(id),
  date         TEXT NOT NULL,
  verified     INTEGER NOT NULL DEFAULT 0,
  evidence     TEXT NOT NULL,
  completed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_completions_task_date ON completions(task_id, date);
`;
