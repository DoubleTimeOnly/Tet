import { MemoryStore } from "../db/memoryStore";
import { seedObsidianFlashcards } from "./seedObsidian";

const NOW = new Date("2026-06-17T12:00:00Z");

describe("seedObsidianFlashcards", () => {
  it("imports the bundled export into a single deck with every card", async () => {
    const store = new MemoryStore();
    await store.init();

    const { deckId, count, scheduled, fresh } = await seedObsidianFlashcards(store, NOW);

    expect(count).toBeGreaterThan(300);
    expect(scheduled + fresh).toBe(count);

    const decks = await store.listDecks();
    expect(decks).toHaveLength(1);
    expect(decks[0]?.id).toBe(deckId);
    expect(decks[0]?.name).toBe("Obsidian Flashcards");

    // Preserved schedules => most cards are due in the future, not all "today".
    const dueToday = await store.listDueCards(NOW.getTime());
    expect(dueToday.length).toBeLessThan(count);
  });

  it("seeds cards whose stored fsrs_state ts-fsrs can grade", async () => {
    const store = new MemoryStore();
    await store.init();
    await seedObsidianFlashcards(store, NOW);

    const { fsrs, Rating } = require("ts-fsrs");
    const scheduler = fsrs();
    const due = await store.listDueCards(NOW.getTime(), 5);
    for (const card of due) {
      expect(() => scheduler.next(JSON.parse(card.fsrs_state), NOW, Rating.Good)).not.toThrow();
    }
  });
});
