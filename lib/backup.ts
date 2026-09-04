import type {
  Deck,
  Task,
  Card,
  Note,
  Review,
  Completion,
  Habit,
  HabitLog,
  LootCard,
} from "../db/schema";
import { backfillNotes } from "./notesBackfill";

/**
 * Complete JSON export/import — the whole instance in one file. Every table
 * round-trips: decks, cards (with FSRS schedule + ignored flag), tasks (with
 * playlist `meta` progress), reviews, completions, habits + their logs, and
 * collected loot cards. Derived state isn't stored and so isn't listed here —
 * XP/levels (lib/xp) and streaks (lib/streak) recompute from reviews +
 * completions, so a restore reconstructs them exactly.
 *
 * Importing REPLACES the local dataset (store.replaceAll), so exporting from one
 * Tet and importing into another recreates the original. No cloud, no partial
 * writes — importAll validates the whole payload before returning so a corrupt
 * file can't half-apply. (Secrets like API tokens live outside the DB and are
 * intentionally not part of the backup.)
 */

// v2 adds the notes table (sibling groups). v1 backups predate it and are
// upgraded on import by reconstructing notes from card content (backfillNotes).
// v3 adds habits + their logs, and loot cards — which no earlier version
// carried at all, so a Collection could never survive a move to a new device.
// Older backups simply restore with none of these.
export const BACKUP_VERSION = 3;

export interface BackupData {
  decks: Deck[];
  tasks: Task[];
  notes: Note[];
  cards: Card[];
  reviews: Review[];
  completions: Completion[];
  habits: Habit[];
  habitLogs: HabitLog[];
  lootCards: LootCard[];
}

export interface Backup extends BackupData {
  version: number;
  exported_at: number;
}

export class BackupImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupImportError";
  }
}

/** Serialize the full local dataset to a portable JSON string. */
export function exportAll(
  data: BackupData,
  now: Date | number = Date.now(),
): string {
  const backup: Backup = {
    version: BACKUP_VERSION,
    exported_at: now instanceof Date ? now.getTime() : now,
    decks: data.decks,
    tasks: data.tasks,
    notes: data.notes,
    cards: data.cards,
    reviews: data.reviews,
    completions: data.completions,
    habits: data.habits,
    habitLogs: data.habitLogs,
    lootCards: data.lootCards,
  };
  return JSON.stringify(backup);
}

// `notes` (absent in v1) and habits (absent before v3) are validated separately
// so old backups still import.
const TABLES: (keyof BackupData)[] = [
  "decks",
  "tasks",
  "cards",
  "reviews",
  "completions",
];

/**
 * Parse + validate a backup blob into restorable data. Throws
 * BackupImportError (never returns partial data) on malformed JSON, wrong
 * shape, or an unsupported version.
 */
export function importAll(json: string): BackupData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new BackupImportError(`Malformed JSON: ${(err as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new BackupImportError("Backup is not an object");
  }
  const obj = parsed as Record<string, unknown>;

  const SUPPORTED = [1, 2, BACKUP_VERSION];
  if (!SUPPORTED.includes(obj.version as number)) {
    throw new BackupImportError(
      `Unsupported backup version ${String(obj.version)} (expected ${SUPPORTED.join(", ")})`,
    );
  }

  for (const table of TABLES) {
    if (!Array.isArray(obj[table])) {
      throw new BackupImportError(`Missing or invalid "${table}" array`);
    }
  }

  const cards = obj.cards as Card[];
  // v1 predates notes: reconstruct sibling groups from card content so old
  // backups restore with grouping + propagating edits intact.
  if (obj.version === 1) {
    const { notes, cards: stamped } = backfillNotes(cards);
    return {
      decks: obj.decks as Deck[],
      tasks: obj.tasks as Task[],
      notes,
      cards: stamped,
      reviews: obj.reviews as Review[],
      completions: obj.completions as Completion[],
      habits: [],
      habitLogs: [],
      lootCards: [],
    };
  }

  if (!Array.isArray(obj.notes)) {
    throw new BackupImportError(`Missing or invalid "notes" array`);
  }
  return {
    decks: obj.decks as Deck[],
    tasks: obj.tasks as Task[],
    notes: obj.notes as Note[],
    cards,
    reviews: obj.reviews as Review[],
    completions: obj.completions as Completion[],
    habits: optionalTable<Habit>(obj, "habits"),
    habitLogs: optionalTable<HabitLog>(obj, "habitLogs"),
    lootCards: optionalTable<LootCard>(obj, "lootCards"),
  };
}

/** A table added after v2: absent in an older backup, but must be an array
 *  when present so a corrupt file can't half-apply. */
function optionalTable<T>(obj: Record<string, unknown>, key: string): T[] {
  const value = obj[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new BackupImportError(`Invalid "${key}" array`);
  }
  return value as T[];
}
