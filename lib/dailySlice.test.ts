import { computeToday, flashcardSlice } from "./dailySlice";
import { makeTask, makeCard, makeCompletion } from "./testFixtures";
import { DateTime } from "luxon";

const LA = "America/Los_Angeles";
const now = DateTime.fromISO("2026-06-15T12:00", { zone: LA }).toMillis();

// Distinct fronts so cards exercise the cap, not sibling burying (identical
// content would collapse into one group).
const dueCards = (n: number, deck = "deck-1") =>
  Array.from({ length: n }, (_, i) =>
    makeCard({ id: `c${i}`, front: `q${i}`, due: i, deck_id: deck }),
  );

describe("computeToday — tasks", () => {
  it("empty state: no tasks, no cards -> empty slice (day-1 cold start)", () => {
    const slice = computeToday({ tasks: [], cards: [], completions: [], now, tz: LA });
    expect(slice.dayKey).toBe("2026-06-15");
    expect(slice.tasks).toEqual([]);
  });

  it("surfaces active tasks with their cadence as the count", () => {
    const slice = computeToday({
      tasks: [
        makeTask({ id: "t1", type: "youtube", cadence: 3 }),
        makeTask({ id: "t2", type: "youtube", cadence: 1 }),
      ],
      cards: [],
      completions: [],
      now,
      tz: LA,
    });
    expect(slice.tasks.map((i) => [i.task.id, i.count])).toEqual([
      ["t1", 3],
      ["t2", 1],
    ]);
  });

  it("excludes inactive tasks", () => {
    const slice = computeToday({
      tasks: [makeTask({ id: "t1", type: "youtube", active: false })],
      cards: [],
      completions: [],
      now,
      tz: LA,
    });
    expect(slice.tasks).toEqual([]);
  });

  it("post-completion shrink: a non-flashcard task verified today drops out", () => {
    const slice = computeToday({
      tasks: [
        makeTask({ id: "t1", type: "youtube" }),
        makeTask({ id: "t2", type: "youtube" }),
      ],
      cards: [],
      completions: [makeCompletion({ task_id: "t1", date: "2026-06-15", verified: true })],
      now,
      tz: LA,
    });
    expect(slice.tasks.map((i) => i.task.id)).toEqual(["t2"]);
  });

  it("an unverified completion does NOT remove the task from the slice", () => {
    const slice = computeToday({
      tasks: [makeTask({ id: "t1", type: "youtube" })],
      cards: [],
      completions: [makeCompletion({ task_id: "t1", date: "2026-06-15", verified: false })],
      now,
      tz: LA,
    });
    expect(slice.tasks.map((i) => i.task.id)).toEqual(["t1"]);
  });

  it("a completion from a different day does not shrink today", () => {
    const slice = computeToday({
      tasks: [makeTask({ id: "t1", type: "youtube" })],
      cards: [],
      completions: [makeCompletion({ task_id: "t1", date: "2026-06-14", verified: true })],
      now,
      tz: LA,
    });
    expect(slice.tasks.map((i) => i.task.id)).toEqual(["t1"]);
  });
});

describe("flashcardSlice — daily goal & deck scope", () => {
  it("surfaces up to the cadence (goal) when nothing reviewed yet", () => {
    const task = makeTask({ cadence: 30 });
    const fc = flashcardSlice(task, dueCards(50), 0);
    expect(fc.goal).toBe(30);
    expect(fc.queue).toHaveLength(30);
    expect(fc.overflow).toHaveLength(20);
    expect(fc.remaining).toBe(30);
    expect(fc.done).toBe(false);
  });

  it("surfaces only the remaining goal (cadence - reviewedToday)", () => {
    const task = makeTask({ cadence: 30 });
    const fc = flashcardSlice(task, dueCards(50), 5);
    expect(fc.queue).toHaveLength(25);
    expect(fc.reviewedToday).toBe(5);
    expect(fc.remaining).toBe(25);
  });

  it("once the goal is met the queue empties and done flips true", () => {
    const task = makeTask({ cadence: 30 });
    const fc = flashcardSlice(task, dueCards(50), 30);
    expect(fc.queue).toHaveLength(0);
    expect(fc.done).toBe(true);
  });

  it("over-shooting the goal clamps remaining to zero", () => {
    const fc = flashcardSlice(makeTask({ cadence: 30 }), dueCards(10), 42);
    expect(fc.remaining).toBe(0);
    expect(fc.queue).toHaveLength(0);
    expect(fc.done).toBe(true);
  });

  it("scopes the queue to the task's deck (source_ref)", () => {
    const task = makeTask({ cadence: 30, source_ref: "deck-A" });
    const cards = [...dueCards(3, "deck-A"), ...dueCards(4, "deck-B")];
    const fc = flashcardSlice(task, cards, 0);
    expect(fc.queue.every((c) => c.deck_id === "deck-A")).toBe(true);
    expect(fc.queue).toHaveLength(3);
  });

  it("source_ref null reviews all decks", () => {
    const task = makeTask({ cadence: 30, source_ref: null });
    const cards = [...dueCards(3, "deck-A"), ...dueCards(4, "deck-B")];
    const fc = flashcardSlice(task, cards, 0);
    expect(fc.queue).toHaveLength(7);
  });
});

describe("computeToday — flashcard tasks", () => {
  it("uses reviewedDeckIds to scope progress per deck", () => {
    const slice = computeToday({
      tasks: [makeTask({ id: "t1", cadence: 10, source_ref: "deck-A" })],
      cards: dueCards(20, "deck-A"),
      completions: [],
      now,
      tz: LA,
      // 3 reviews today in deck-A, plus one in another deck that shouldn't count.
      reviewedDeckIds: ["deck-A", "deck-A", "deck-A", "deck-B"],
    });
    const item = slice.tasks.find((i) => i.task.id === "t1")!;
    expect(item.flashcards?.reviewedToday).toBe(3);
    expect(item.count).toBe(7); // 10 goal - 3 done
    expect(item.flashcards?.queue).toHaveLength(7);
  });

  it("drops a flashcard task once its goal is met", () => {
    const slice = computeToday({
      tasks: [makeTask({ id: "t1", cadence: 5 })],
      cards: dueCards(20),
      completions: [],
      now,
      tz: LA,
      reviewedDeckIds: Array(5).fill("deck-1"),
    });
    expect(slice.tasks.map((i) => i.task.id)).not.toContain("t1");
  });
});

describe("flashcardSlice — sibling burying", () => {
  it("surfaces only one cloze of a sibling group today; the rest roll over", () => {
    const task = makeTask({ cadence: 30 });
    const cards = [
      makeCard({ id: "c0", front: "[...] not b", back: "a", due: now - 2 }),
      makeCard({ id: "c1", front: "a not [...]", back: "b", due: now - 1 }),
      makeCard({ id: "solo", front: "gato", back: "cat", due: now - 3 }),
    ];
    const fc = flashcardSlice(task, [...cards].sort((a, b) => a.due - b.due), 0);
    expect(fc.queue.map((c) => c.id)).toEqual(["solo", "c0"]);
    expect(fc.overflow.map((c) => c.id)).toEqual(["c1"]);
  });
});
