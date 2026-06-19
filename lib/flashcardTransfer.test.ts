import {
  exportFlashcards,
  importFlashcards,
  FlashcardImportError,
  FLASHCARD_EXPORT_VERSION,
} from "./flashcardTransfer";
import { makeCard } from "./testFixtures";
import type { Deck } from "../db/schema";

const deck: Deck = { id: "d1", name: "Quantum", created_at: 100 };

function seqIds() {
  let n = 0;
  return () => `new-${n++}`;
}

describe("flashcard export/import round-trip", () => {
  it("preserves content + schedule but remaps ids and rewires deck_id", () => {
    const card = makeCard({ id: "c1", deck_id: "d1", front: "$X$?", back: "NOT", due: 5, fsrs_state: '{"s":1}' });
    const json = exportFlashcards([deck], [card], 1234);

    const { decks, cards } = importFlashcards(json, seqIds());
    expect(decks).toHaveLength(1);
    expect(cards).toHaveLength(1);

    // ids are fresh, deck_id points at the new deck
    expect(decks[0]!.id).toBe("new-0");
    expect(cards[0]!.id).toBe("new-1");
    expect(cards[0]!.deck_id).toBe("new-0");

    // content + schedule survive
    expect(cards[0]!.front).toBe("$X$?");
    expect(cards[0]!.back).toBe("NOT");
    expect(cards[0]!.due).toBe(5);
    expect(cards[0]!.fsrs_state).toBe('{"s":1}');
    // names preserved
    expect(decks[0]!.name).toBe("Quantum");
  });

  it("carries the ignored flag across", () => {
    const card = makeCard({ id: "c1", deck_id: "d1", ignored: true });
    const { cards } = importFlashcards(exportFlashcards([deck], [card]), seqIds());
    expect(cards[0]!.ignored).toBe(true);
  });

  it("drops cards whose deck isn't in the file", () => {
    const orphan = makeCard({ id: "c1", deck_id: "missing" });
    const { cards } = importFlashcards(exportFlashcards([deck], [orphan]), seqIds());
    expect(cards).toEqual([]);
  });

  it("rejects malformed JSON", () => {
    expect(() => importFlashcards("{not json")).toThrow(FlashcardImportError);
  });

  it("rejects an unsupported version", () => {
    const bad = JSON.stringify({ version: FLASHCARD_EXPORT_VERSION + 1, decks: [], cards: [] });
    expect(() => importFlashcards(bad)).toThrow(/Unsupported export version/);
  });

  it("rejects a payload missing the arrays", () => {
    expect(() => importFlashcards(JSON.stringify({ version: FLASHCARD_EXPORT_VERSION }))).toThrow(
      /Missing or invalid/,
    );
  });
});
