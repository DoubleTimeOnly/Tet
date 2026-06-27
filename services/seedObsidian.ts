import { importObsidian, type ObsidianExport } from "../lib/obsidianImport";
import type { Store } from "../db/store";
import exportJson from "../data/obsidian-flashcards.json";

/**
 * One-shot import of the bundled Obsidian flashcard export into a Store,
 * preserving each card's schedule (Lane C / obsidianImport). This is the
 * "import function" — it is NOT wired to run automatically; call it once from a
 * dev action / settings button to initialize the flashcard deck, e.g.:
 *
 *   const { count } = await seedObsidianFlashcards(store);
 *
 * Cards land in a single "Obsidian Flashcards" deck via store.insertMany, which
 * appends without touching existing data. Calling it again creates a second
 * deck, so guard on an empty/first-run condition if you wire it to a button.
 */
export interface SeedObsidianResult {
  deckId: string;
  count: number;
  scheduled: number;
  fresh: number;
}

export async function seedObsidianFlashcards(
  store: Store,
  now?: Date | number,
): Promise<SeedObsidianResult> {
  const data = exportJson as ObsidianExport;
  const { deck, cards, notes, scheduled, fresh } = importObsidian(data, { now });
  await store.insertMany([deck], cards, notes);
  return { deckId: deck.id, count: cards.length, scheduled, fresh };
}
