import {
  parseFlashcardNote,
  easeToDifficulty,
  srScheduleToFsrsCard,
  importObsidian,
  type ObsidianExport,
  type ParsedCard,
} from "./obsidianImport";

const NOW = new Date("2026-06-17T12:00:00Z");

function seqIds(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

describe("parseFlashcardNote", () => {
  it("parses a single-line basic card with its schedule", () => {
    const cards = parseFlashcardNote(
      "#flashcardsv2\nWhat protects you?::The 4th Amendment <!--SR:!2026-08-11,211,270-->",
      "Rights",
    );
    expect(cards).toEqual<ParsedCard[]>([
      {
        front: "What protects you?",
        back: "The 4th Amendment",
        note: "Rights",
        kind: "basic",
        schedule: { due: "2026-08-11", interval: 211, ease: 270 },
      },
    ]);
  });

  it("treats a basic card with no SR comment as never-reviewed (schedule null)", () => {
    const cards = parseFlashcardNote("Front::Back", "N");
    expect(cards[0]?.schedule).toBeNull();
  });

  it("expands a reversed `:::` card into forward + reverse with mapped schedules", () => {
    const cards = parseFlashcardNote(
      "Capital of Alaska:::Juneau <!--SR:!2026-01-14,3,250!2026-03-13,2,243-->",
      "States",
    );
    expect(cards).toHaveLength(2);
    expect([cards[0]?.front, cards[0]?.back]).toEqual(["Capital of Alaska", "Juneau"]);
    expect(cards[0]?.schedule).toEqual({ due: "2026-01-14", interval: 3, ease: 250 });
    expect([cards[1]?.front, cards[1]?.back]).toEqual(["Juneau", "Capital of Alaska"]);
    expect(cards[1]?.schedule).toEqual({ due: "2026-03-13", interval: 2, ease: 243 });
  });

  it("makes one cloze card per ==highlight==, blanking the target and revealing the rest", () => {
    const cards = parseFlashcardNote(
      "people are ==vulnerable==, doing ==their best==. <!--SR:!2026-01-08,3,250!2026-02-18,16,291-->",
      "Person",
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      front: "people are [...], doing their best.",
      back: "vulnerable",
      kind: "cloze",
      schedule: { due: "2026-01-08", interval: 3, ease: 250 },
    });
    expect(cards[1]).toMatchObject({
      front: "people are vulnerable, doing [...].",
      back: "their best",
      schedule: { due: "2026-02-18", interval: 16, ease: 291 },
    });
  });

  it("maps cloze schedules positionally and treats the 2000-01-01 sentinel as new", () => {
    const cards = parseFlashcardNote(
      "==a==, ==b==, ==c== <!--SR:!2000-01-01,1,250!2025-11-29,4,270!2025-11-25,3,268-->",
      "Math",
    );
    expect(cards.map((c) => c.schedule?.due)).toEqual(["2000-01-01", "2025-11-29", "2025-11-25"]);
  });

  it("parses a multi-line `?` card (front block / separator / back block)", () => {
    const md = [
      "#flashcardsv2",
      "",
      "What two questions should an Illuminator ask?",
      "?",
      "1. How are you seeing this?",
      "2. What experiences cause that? <!--SR:!2026-04-22,27,246-->",
      "",
    ].join("\n");
    const cards = parseFlashcardNote(md, "Person");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.kind).toBe("multiline");
    expect(cards[0]?.front).toBe("What two questions should an Illuminator ask?");
    expect(cards[0]?.back).toBe("1. How are you seeing this?\n2. What experiences cause that?");
    expect(cards[0]?.schedule).toEqual({ due: "2026-04-22", interval: 27, ease: 246 });
  });

  it("does not let a multi-line block swallow an adjacent single-line card", () => {
    const md = ["A::B <!--SR:!2026-01-01,5,250-->", "Q only?", "?", "the answer", ""].join("\n");
    const cards = parseFlashcardNote(md, "N");
    expect(cards).toHaveLength(2);
    expect(cards.find((c) => c.kind === "basic")?.front).toBe("A");
    expect(cards.find((c) => c.kind === "multiline")?.front).toBe("Q only?");
  });

  it("keeps LaTeX and image embeds verbatim (no HTML-style stripping)", () => {
    const cards = parseFlashcardNote(
      "What gate?![[img.webp]]::$X=\\begin{bmatrix}0 & 1\\end{bmatrix}$ <!--SR:!2026-01-01,5,250-->",
      "Quantum",
    );
    expect(cards[0]?.front).toBe("What gate?![[img.webp]]");
    expect(cards[0]?.back).toBe("$X=\\begin{bmatrix}0 & 1\\end{bmatrix}$");
  });

  it("skips the tag line and blank lines", () => {
    expect(parseFlashcardNote("#flashcardsv2 \n\n", "N")).toEqual([]);
  });
});

describe("easeToDifficulty", () => {
  it("maps the SM-2 default ease (2.5) near the FSRS midpoint", () => {
    expect(easeToDifficulty(250)).toBeCloseTo(4, 1);
  });
  it("is monotonic: lower ease -> higher difficulty", () => {
    expect(easeToDifficulty(130)).toBeGreaterThan(easeToDifficulty(250));
    expect(easeToDifficulty(250)).toBeGreaterThan(easeToDifficulty(310));
  });
  it("clamps into [1, 10]", () => {
    expect(easeToDifficulty(100)).toBeLessThanOrEqual(10);
    expect(easeToDifficulty(500)).toBeGreaterThanOrEqual(1);
  });
});

describe("srScheduleToFsrsCard", () => {
  it("preserves due date and seeds stability from interval, difficulty from ease", () => {
    const card = srScheduleToFsrsCard({ due: "2026-08-11", interval: 211, ease: 270 }, NOW);
    expect(card).not.toBeNull();
    expect(card!.state).toBe(2); // Review
    expect(card!.stability).toBe(211);
    expect(card!.difficulty).toBeCloseTo(easeToDifficulty(270), 5);
    expect(card!.due.getFullYear()).toBe(2026);
    expect(card!.scheduled_days).toBe(211);
  });
  it("returns null for the never-reviewed sentinel date", () => {
    expect(srScheduleToFsrsCard({ due: "2000-01-01", interval: 1, ease: 250 }, NOW)).toBeNull();
  });
});

describe("importObsidian", () => {
  const exportData: ObsidianExport = {
    source: "test",
    exportedAt: NOW.toISOString(),
    deckName: "Obsidian Flashcards",
    cards: [
      { front: "F1", back: "B1", note: "n", kind: "basic", schedule: { due: "2026-08-11", interval: 211, ease: 270 } },
      { front: "F2", back: "B2", note: "n", kind: "basic", schedule: null },
      { front: "F3", back: "B3", note: "n", kind: "cloze", schedule: { due: "2000-01-01", interval: 1, ease: 250 } },
    ],
  };

  it("builds one deck and a card per parsed card", () => {
    const { deck, cards } = importObsidian(exportData, {
      now: NOW,
      deckId: "deck-1",
      idFactory: seqIds("card"),
    });
    expect(deck).toEqual({ id: "deck-1", name: "Obsidian Flashcards", created_at: NOW.getTime() });
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => c.deck_id === "deck-1")).toBe(true);
  });

  it("seeds scheduled cards in review state and starts the rest fresh", () => {
    const { cards, scheduled, fresh } = importObsidian(exportData, { now: NOW });
    expect(scheduled).toBe(1);
    expect(fresh).toBe(2); // null schedule + sentinel both start new

    const seeded = cards[0]!;
    expect(seeded.state_label).toBe("review");
    expect(seeded.due).toBe(srScheduleToFsrsCard({ due: "2026-08-11", interval: 211, ease: 270 }, NOW)!.due.getTime());
    expect(JSON.parse(seeded.fsrs_state).stability).toBe(211);

    expect(cards[1]?.state_label).toBe("new");
    expect(cards[2]?.state_label).toBe("new");
    expect(cards[1]?.due).toBe(NOW.getTime());
  });

  it("produces fsrs_state a fresh ts-fsrs scheduler can grade without throwing", () => {
    // Guards the hand-built review-state object against ts-fsrs's expectations.
    const { cards } = importObsidian(exportData, { now: NOW });
    const { fsrs, Rating } = require("ts-fsrs");
    const scheduler = fsrs();
    const revived = JSON.parse(cards[0]!.fsrs_state);
    expect(() => scheduler.next(revived, NOW, Rating.Good)).not.toThrow();
  });
});
