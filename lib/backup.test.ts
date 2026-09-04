import { exportAll, importAll, BackupImportError, BACKUP_VERSION, type BackupData } from "./backup";
import { makeTask, makeCard, makeCompletion } from "./testFixtures";
import type { Deck, Review } from "../db/schema";

function sampleData(): BackupData {
  const deck: Deck = { id: "d1", name: "Starter", created_at: 1 };
  const review: Review = { id: "r1", card_id: "card-1", rating: "good", reviewed_at: 5 };
  return {
    decks: [deck],
    tasks: [makeTask({ id: "t1" })],
    notes: [],
    cards: [makeCard({ id: "card-1", deck_id: "d1" })],
    reviews: [review],
    completions: [makeCompletion({ id: "comp-1", task_id: "t1" })],
    habits: [
      {
        id: "h1",
        identity: "I care about my health",
        name: "Work out",
        action: "Walk to the gym",
        prompt_note: true,
        active: true,
        created_at: 2,
      },
    ],
    habitLogs: [
      {
        id: "hl1",
        habit_id: "h1",
        date: "2026-06-19",
        action: "Walk to the gym",
        note: "felt easy",
        done_at: 7,
      },
    ],
    lootCards: [{ id: "loot-1", r: 12, g: 200, b: 87, collected_at: 9 }],
  };
}

describe("exportAll / importAll round-trip", () => {
  it("restores every table identically", () => {
    const data = sampleData();
    const restored = importAll(exportAll(data, 1000));
    expect(restored).toEqual(data);
  });

  it("stamps version and exported_at on export", () => {
    const blob = JSON.parse(exportAll(sampleData(), 1234));
    expect(blob.version).toBe(BACKUP_VERSION);
    expect(blob.exported_at).toBe(1234);
  });

  it("round-trips an empty dataset", () => {
    const empty: BackupData = { decks: [], tasks: [], notes: [], cards: [], reviews: [], completions: [], habits: [], habitLogs: [], lootCards: [] };
    expect(importAll(exportAll(empty))).toEqual(empty);
  });

  it("preserves the newer fields: playlist meta, ignored cards, watched-minutes", () => {
    const data: BackupData = {
      decks: [{ id: "d1", name: "Deck", created_at: 1 }],
      tasks: [
        makeTask({
          id: "yt",
          type: "youtube",
          // playlist progress (cached items + watched videos) lives in meta
          meta: JSON.stringify({
            playlistId: "PL1",
            items: [{ id: "v1", title: "One" }],
            fetchedDay: "2026-06-19",
            fetchedAt: 5,
            watchedIds: ["v1"],
            pick: null,
          }),
        }),
      ],
      notes: [],
      cards: [makeCard({ id: "c1", deck_id: "d1", ignored: true })],
      reviews: [{ id: "r1", card_id: "c1", rating: "good", reviewed_at: 5 }],
      completions: [
        makeCompletion({
          id: "cm1",
          task_id: "yt",
          evidence: { type: "youtube", manual: true, minutes: 12 },
        }),
      ],
      habits: [],
      habitLogs: [],
      lootCards: [],
    };
    const restored = importAll(exportAll(data, 1000));
    expect(restored).toEqual(data);
    // spot-check the fields most likely to be dropped
    expect(restored.tasks[0]!.meta).toBe(data.tasks[0]!.meta);
    expect(restored.cards[0]!.ignored).toBe(true);
    expect(restored.completions[0]!.evidence).toEqual({ type: "youtube", manual: true, minutes: 12 });
  });
});

describe("v1 backup upgrade", () => {
  it("reconstructs notes from cloze siblings in a v1 (notes-less) backup", () => {
    const blob = JSON.stringify({
      version: 1,
      exported_at: 1,
      decks: [{ id: "d1", name: "Deck", created_at: 1 }],
      tasks: [],
      cards: [
        makeCard({ id: "c0", deck_id: "d1", front: "[...] not b", back: "a" }),
        makeCard({ id: "c1", deck_id: "d1", front: "a not [...]", back: "b" }),
      ],
      reviews: [],
      completions: [],
    });
    const restored = importAll(blob);
    expect(restored.notes).toHaveLength(1);
    expect(restored.notes[0]!.kind).toBe("cloze");
    expect(JSON.parse(restored.notes[0]!.fields)).toEqual({ text: "==a== not ==b==" });
    // both cards now point at the reconstructed note, schedules untouched
    expect(restored.cards.every((c) => c.note_id === restored.notes[0]!.id)).toBe(true);
  });
});

describe("loot cards (the Collection)", () => {
  // Regression: loot cards were absent from the backup entirely through v2, so
  // a Collection could not survive a move to a new device. They are a v3 table
  // now — this pins that they are both written and read back.
  it("round-trips the Collection", () => {
    const data = sampleData();
    const blob = exportAll(data, 1000);
    expect(JSON.parse(blob).lootCards).toEqual(data.lootCards);
    expect(importAll(blob).lootCards).toEqual(data.lootCards);
  });

  it("keeps every colour channel and the collected timestamp intact", () => {
    const data = sampleData();
    // 0 and 255 are the values a truthiness bug would silently drop.
    data.lootCards = [
      { id: "l0", r: 0, g: 0, b: 0, collected_at: 0 },
      { id: "l1", r: 255, g: 255, b: 255, collected_at: 1750000000000 },
    ];
    expect(importAll(exportAll(data, 1000)).lootCards).toEqual(data.lootCards);
  });

  it("still rejects a lootCards table that isn't an array", () => {
    const blob = JSON.stringify({
      version: BACKUP_VERSION,
      decks: [],
      tasks: [],
      notes: [],
      cards: [],
      reviews: [],
      completions: [],
      lootCards: {},
    });
    expect(() => importAll(blob)).toThrow(/lootCards/);
  });
});

describe("v2 backup upgrade (pre-habits)", () => {
  it("imports a v2 blob with empty habit tables rather than rejecting it", () => {
    const blob = JSON.stringify({
      version: 2,
      exported_at: 1,
      decks: [],
      tasks: [],
      notes: [],
      cards: [],
      reviews: [],
      completions: [],
    });
    const restored = importAll(blob);
    expect(restored.habits).toEqual([]);
    expect(restored.habitLogs).toEqual([]);
    expect(restored.lootCards).toEqual([]);
  });

  it("still rejects a habits table that isn't an array", () => {
    const blob = JSON.stringify({
      version: BACKUP_VERSION,
      decks: [],
      tasks: [],
      notes: [],
      cards: [],
      reviews: [],
      completions: [],
      habits: {},
    });
    expect(() => importAll(blob)).toThrow(/habits/);
  });
});

describe("importAll validation (no partial-write corruption)", () => {
  it("rejects malformed JSON", () => {
    expect(() => importAll("{not json")).toThrow(BackupImportError);
  });

  it("rejects a non-object payload", () => {
    expect(() => importAll("42")).toThrow(BackupImportError);
  });

  it("rejects an unsupported version", () => {
    const blob = JSON.stringify({ version: 999, decks: [], tasks: [], cards: [], reviews: [], completions: [] });
    expect(() => importAll(blob)).toThrow(/Unsupported backup version/);
  });

  it("rejects a missing table", () => {
    const blob = JSON.stringify({ version: BACKUP_VERSION, decks: [], tasks: [], cards: [], reviews: [] });
    expect(() => importAll(blob)).toThrow(/completions/);
  });

  it("rejects a table that isn't an array", () => {
    const blob = JSON.stringify({ version: BACKUP_VERSION, decks: {}, tasks: [], cards: [], reviews: [], completions: [] });
    expect(() => importAll(blob)).toThrow(/decks/);
  });
});
