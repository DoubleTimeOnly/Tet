import { computeToday } from "./dailySlice";
import { makeTask, makeCard, makeCompletion } from "./testFixtures";
import { DateTime } from "luxon";

const LA = "America/Los_Angeles";
const now = DateTime.fromISO("2026-06-15T12:00", { zone: LA }).toMillis();

describe("computeToday — tasks", () => {
  it("empty state: no tasks, no cards -> empty slice (day-1 cold start)", () => {
    const slice = computeToday({ tasks: [], cards: [], completions: [], now, tz: LA });
    expect(slice.dayKey).toBe("2026-06-15");
    expect(slice.tasks).toEqual([]);
    expect(slice.reviewCards).toEqual([]);
    expect(slice.reviewOverflow).toEqual([]);
  });

  it("surfaces active tasks with their cadence as the count", () => {
    const slice = computeToday({
      tasks: [makeTask({ id: "t1", cadence: 10 }), makeTask({ id: "t2", type: "youtube", cadence: 1 })],
      cards: [],
      completions: [],
      now,
      tz: LA,
    });
    expect(slice.tasks.map((i) => [i.task.id, i.count])).toEqual([
      ["t1", 10],
      ["t2", 1],
    ]);
  });

  it("excludes inactive tasks", () => {
    const slice = computeToday({
      tasks: [makeTask({ id: "t1", active: false })],
      cards: [],
      completions: [],
      now,
      tz: LA,
    });
    expect(slice.tasks).toEqual([]);
  });

  it("post-completion shrink: a task verified today drops out", () => {
    const slice = computeToday({
      tasks: [makeTask({ id: "t1" }), makeTask({ id: "t2" })],
      cards: [],
      completions: [makeCompletion({ task_id: "t1", date: "2026-06-15", verified: true })],
      now,
      tz: LA,
    });
    expect(slice.tasks.map((i) => i.task.id)).toEqual(["t2"]);
  });

  it("an unverified completion does NOT remove the task from the slice", () => {
    const slice = computeToday({
      tasks: [makeTask({ id: "t1" })],
      cards: [],
      completions: [makeCompletion({ task_id: "t1", date: "2026-06-15", verified: false })],
      now,
      tz: LA,
    });
    expect(slice.tasks.map((i) => i.task.id)).toEqual(["t1"]);
  });

  it("a completion from a different day does not shrink today", () => {
    const slice = computeToday({
      tasks: [makeTask({ id: "t1" })],
      cards: [],
      completions: [makeCompletion({ task_id: "t1", date: "2026-06-14", verified: true })],
      now,
      tz: LA,
    });
    expect(slice.tasks.map((i) => i.task.id)).toEqual(["t1"]);
  });
});

describe("computeToday — review cap & overflow", () => {
  // Distinct fronts so these exercise the cap, not sibling burying (identical
  // content would collapse into one group).
  const dueCards = (n: number) =>
    Array.from({ length: n }, (_, i) => makeCard({ id: `c${i}`, front: `q${i}`, due: i }));

  it("only due cards (due <= now) are eligible", () => {
    const slice = computeToday({
      tasks: [],
      cards: [makeCard({ id: "past", due: now - 1 }), makeCard({ id: "future", due: now + 1 })],
      completions: [],
      now,
      tz: LA,
    });
    expect(slice.reviewCards.map((c) => c.id)).toEqual(["past"]);
  });

  it("surfaces at most cap cards, overflow rolls (oldest-first)", () => {
    const slice = computeToday({ tasks: [], cards: dueCards(35), completions: [], now, tz: LA, cap: 30 });
    expect(slice.reviewCards).toHaveLength(30);
    expect(slice.reviewOverflow).toHaveLength(5);
    // oldest (smallest due) surfaced first; overflow is the newest 5.
    expect(slice.reviewCards[0]?.id).toBe("c0");
    expect(slice.reviewOverflow.map((c) => c.id)).toEqual(["c30", "c31", "c32", "c33", "c34"]);
  });

  it("under the cap: everything surfaces, no overflow", () => {
    const slice = computeToday({ tasks: [], cards: dueCards(5), completions: [], now, tz: LA, cap: 30 });
    expect(slice.reviewCards).toHaveLength(5);
    expect(slice.reviewOverflow).toEqual([]);
  });

  it("defaults the cap to 30 when unspecified", () => {
    const slice = computeToday({ tasks: [], cards: dueCards(31), completions: [], now, tz: LA });
    expect(slice.reviewCards).toHaveLength(30);
    expect(slice.reviewOverflow).toHaveLength(1);
  });
});

describe("computeToday — sibling burying", () => {
  it("surfaces only one cloze of a sibling group today; the rest roll over", () => {
    const slice = computeToday({
      tasks: [],
      cards: [
        makeCard({ id: "c0", front: "[...] not b", back: "a", due: now - 2 }),
        makeCard({ id: "c1", front: "a not [...]", back: "b", due: now - 1 }),
        makeCard({ id: "solo", front: "gato", back: "cat", due: now - 3 }),
      ],
      completions: [],
      now,
      tz: LA,
    });
    expect(slice.reviewCards.map((c) => c.id)).toEqual(["solo", "c0"]);
    expect(slice.reviewOverflow.map((c) => c.id)).toEqual(["c1"]);
  });
});
