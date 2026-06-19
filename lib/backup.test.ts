import { exportAll, importAll, BackupImportError, BACKUP_VERSION, type BackupData } from "./backup";
import { makeTask, makeCard, makeCompletion } from "./testFixtures";
import type { Deck, Review } from "../db/schema";

function sampleData(): BackupData {
  const deck: Deck = { id: "d1", name: "Starter", created_at: 1 };
  const review: Review = { id: "r1", card_id: "card-1", rating: "good", reviewed_at: 5 };
  return {
    decks: [deck],
    tasks: [makeTask({ id: "t1" })],
    cards: [makeCard({ id: "card-1", deck_id: "d1" })],
    reviews: [review],
    completions: [makeCompletion({ id: "comp-1", task_id: "t1" })],
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
    const empty: BackupData = { decks: [], tasks: [], cards: [], reviews: [], completions: [] };
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
      cards: [makeCard({ id: "c1", deck_id: "d1", ignored: true })],
      reviews: [{ id: "r1", card_id: "c1", rating: "good", reviewed_at: 5 }],
      completions: [
        makeCompletion({
          id: "cm1",
          task_id: "yt",
          evidence: { type: "youtube", manual: true, minutes: 12 },
        }),
      ],
    };
    const restored = importAll(exportAll(data, 1000));
    expect(restored).toEqual(data);
    // spot-check the fields most likely to be dropped
    expect(restored.tasks[0]!.meta).toBe(data.tasks[0]!.meta);
    expect(restored.cards[0]!.ignored).toBe(true);
    expect(restored.completions[0]!.evidence).toEqual({ type: "youtube", manual: true, minutes: 12 });
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
