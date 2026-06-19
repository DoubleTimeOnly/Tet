import type {
  Deck,
  Task,
  Card,
  Review,
  Completion,
} from "../db/schema";

/**
 * Complete JSON export/import — the whole instance in one file. Every table
 * round-trips: decks, cards (with FSRS schedule + ignored flag), tasks (with
 * playlist `meta` progress), reviews, and completions. Derived state isn't
 * stored and so isn't listed here — XP/levels (lib/xp) and streaks (lib/streak)
 * recompute from reviews + completions, so a restore reconstructs them exactly.
 *
 * Importing REPLACES the local dataset (store.replaceAll), so exporting from one
 * Tet and importing into another recreates the original. No cloud, no partial
 * writes — importAll validates the whole payload before returning so a corrupt
 * file can't half-apply. (Secrets like API tokens live outside the DB and are
 * intentionally not part of the backup.)
 */

export const BACKUP_VERSION = 1;

export interface BackupData {
  decks: Deck[];
  tasks: Task[];
  cards: Card[];
  reviews: Review[];
  completions: Completion[];
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
    cards: data.cards,
    reviews: data.reviews,
    completions: data.completions,
  };
  return JSON.stringify(backup);
}

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

  if (obj.version !== BACKUP_VERSION) {
    throw new BackupImportError(
      `Unsupported backup version ${String(obj.version)} (expected ${BACKUP_VERSION})`,
    );
  }

  for (const table of TABLES) {
    if (!Array.isArray(obj[table])) {
      throw new BackupImportError(`Missing or invalid "${table}" array`);
    }
  }

  return {
    decks: obj.decks as Deck[],
    tasks: obj.tasks as Task[],
    cards: obj.cards as Card[],
    reviews: obj.reviews as Review[],
    completions: obj.completions as Completion[],
  };
}
