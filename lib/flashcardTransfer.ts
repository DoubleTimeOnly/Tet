import type { Deck, Card } from "../db/schema";
import { newId } from "./id";

/**
 * Portable flashcard export — decks + cards only (no tasks/reviews/streak),
 * carrying each card's full FSRS schedule so it round-trips between Tet
 * instances without losing progress. Distinct from lib/backup, which snapshots
 * the *entire* dataset and replaces it on restore; this one is shareable on its
 * own and imports by APPENDING, so it never clobbers what's already there.
 */

export const FLASHCARD_EXPORT_VERSION = 1;

export interface FlashcardExport {
  version: number;
  exported_at: number;
  decks: Deck[];
  cards: Card[];
}

export class FlashcardImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlashcardImportError";
  }
}

/** Serialize decks + their cards to a portable JSON string. */
export function exportFlashcards(
  decks: Deck[],
  cards: Card[],
  now: Date | number = Date.now(),
): string {
  const payload: FlashcardExport = {
    version: FLASHCARD_EXPORT_VERSION,
    exported_at: now instanceof Date ? now.getTime() : now,
    decks,
    cards,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Parse + validate an export blob and return decks/cards ready to APPEND.
 *
 * Ids are regenerated (deck_id remapped accordingly) so importing into an
 * instance that already holds these cards can't collide on a primary key —
 * re-importing simply makes fresh copies, matching the .apkg import contract.
 * Cards whose deck isn't in the file are dropped (nothing to attach them to).
 */
export function importFlashcards(
  json: string,
  genId: () => string = newId,
): { decks: Deck[]; cards: Card[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new FlashcardImportError(`Malformed JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new FlashcardImportError("Export is not an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== FLASHCARD_EXPORT_VERSION) {
    throw new FlashcardImportError(
      `Unsupported export version ${String(obj.version)} (expected ${FLASHCARD_EXPORT_VERSION})`,
    );
  }
  if (!Array.isArray(obj.decks) || !Array.isArray(obj.cards)) {
    throw new FlashcardImportError(`Missing or invalid "decks"/"cards" array`);
  }

  const oldToNewDeck = new Map<string, string>();
  const decks: Deck[] = (obj.decks as Deck[]).map((d) => {
    const id = genId();
    oldToNewDeck.set(d.id, id);
    return { ...d, id };
  });

  const cards: Card[] = [];
  for (const c of obj.cards as Card[]) {
    const newDeckId = oldToNewDeck.get(c.deck_id);
    if (!newDeckId) continue; // orphan: its deck wasn't in the file
    cards.push({
      ...c,
      id: genId(),
      deck_id: newDeckId,
      // notes don't travel with a flashcard-only export, so drop the owning
      // note_id (it would dangle) and treat each card as a standalone basic.
      note_id: null,
      template: 0,
      // a card's source task doesn't travel with a flashcard-only export
      source_task_id: null,
      ignored: Boolean(c.ignored),
    });
  }

  return { decks, cards };
}
