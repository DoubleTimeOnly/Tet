import {
  canPass,
  passExcerpt,
  excerptQueue,
  setAsidePile,
  excerptPoints,
  excerptSlice,
  planSync,
  syncCursor,
  dedupKey,
  MAX_PASSES,
  PASS_INTERVAL_DAYS,
  CARD_POINTS,
  BACKLOG_GRACE_DAYS,
} from "./excerpts";
import { startOfTetDay } from "./dayKey";
import { makeExcerpt, makeTask } from "./testFixtures";
import type { ExcerptReview } from "../db/schema";
import type { ReadwiseHighlight } from "./readwiseHighlights";

const TZ = "America/Los_Angeles";
const DAY = 24 * 60 * 60 * 1000;
// 2026-06-15 10:00 PDT
const NOW = Date.parse("2026-06-15T17:00:00Z");

function review(over: Partial<ExcerptReview> = {}): ExcerptReview {
  return { id: "r", excerpt_id: "ex-1", action: "pass", card_id: null, reviewed_at: NOW, ...over };
}

function highlight(over: Partial<ReadwiseHighlight> = {}): ReadwiseHighlight {
  return {
    id: "h1",
    text: "Text",
    note: null,
    bookTitle: "Book",
    bookAuthor: "Author",
    url: "https://readwise.io/open/h1",
    highlightedAt: NOW - DAY,
    updatedAt: NOW - DAY,
    deleted: false,
    ...over,
  };
}

describe("passExcerpt", () => {
  it("pushes due to the start of the Tet day N days out, growing each pass", () => {
    let e = makeExcerpt({ backlog: true });
    const dayStart = startOfTetDay(NOW, TZ);
    for (let i = 0; i < MAX_PASSES; i++) {
      e = passExcerpt(e, NOW, TZ);
      expect(e.pass_count).toBe(i + 1);
      expect(e.due).toBe(dayStart + PASS_INTERVAL_DAYS[i]! * DAY);
    }
    expect(e.backlog).toBe(false);
  });

  it("is capped: after MAX_PASSES the excerpt must be resolved", () => {
    const e = makeExcerpt({ pass_count: MAX_PASSES });
    expect(canPass(e)).toBe(false);
    expect(() => passExcerpt(e, NOW, TZ)).toThrow();
    expect(canPass(makeExcerpt({ pass_count: MAX_PASSES - 1 }))).toBe(true);
  });
});

describe("excerptQueue", () => {
  it("shows ready queued excerpts: fresh by due, then backlog shuffled", () => {
    const list = [
      makeExcerpt({ id: "b1", backlog: true }),
      makeExcerpt({ id: "late", due: NOW - 10 }),
      makeExcerpt({ id: "early", due: NOW - 100 }),
      makeExcerpt({ id: "b2", backlog: true }),
      makeExcerpt({ id: "future", due: NOW + 1 }),
      makeExcerpt({ id: "aside", status: "set_aside" }),
      makeExcerpt({ id: "done", status: "carded" }),
      makeExcerpt({ id: "gone", source_deleted: true }),
    ];
    const ids = excerptQueue(list, NOW).map((e) => e.id);
    expect(ids.slice(0, 2)).toEqual(["early", "late"]);
    expect(ids.slice(2).sort()).toEqual(["b1", "b2"]);
    // stable across calls and input orders
    expect(excerptQueue([...list].reverse(), NOW).map((e) => e.id)).toEqual(ids);
  });

  it("set-aside pile excludes upstream-deleted excerpts", () => {
    const pile = setAsidePile([
      makeExcerpt({ id: "a", status: "set_aside" }),
      makeExcerpt({ id: "b", status: "set_aside", source_deleted: true }),
    ]);
    expect(pile.map((e) => e.id)).toEqual(["a"]);
  });
});

describe("excerptPoints", () => {
  it("counts 1 per decision, CARD_POINTS per distinct card, 0 for un-set-aside", () => {
    const pts = excerptPoints([
      review({ id: "1", action: "pass" }),
      review({ id: "2", action: "ignore" }),
      review({ id: "3", action: "set_aside" }),
      review({ id: "4", action: "unset_aside" }),
      // a combined card: two rows, one card
      review({ id: "5", action: "card", card_id: "c1" }),
      review({ id: "6", action: "card", card_id: "c1" }),
      review({ id: "7", action: "card", card_id: "c2" }),
    ]);
    expect(pts).toBe(3 + 2 * CARD_POINTS);
  });
});

describe("excerptSlice", () => {
  const task = makeTask({ type: "excerpt", cadence: 10 });
  const ready = Array.from({ length: 20 }, (_, i) => makeExcerpt({ id: `e${i}` }));
  const passes = (n: number) =>
    Array.from({ length: n }, (_, i) => review({ id: `p${i}`, excerpt_id: `done${i}` }));

  it("caps the queue to the remaining goal", () => {
    const s = excerptSlice(task, ready, passes(4), NOW);
    expect(s.goal).toBe(10);
    expect(s.pointsToday).toBe(4);
    expect(s.remaining).toBe(6);
    expect(s.queue).toHaveLength(6);
    expect(s.readyCount).toBe(20);
    expect(s.done).toBe(false);
  });

  it("caps the goal to what's available and auto-completes an empty queue", () => {
    expect(excerptSlice(task, ready.slice(0, 3), [], NOW).goal).toBe(3);
    const empty = excerptSlice(task, [], [], NOW);
    expect(empty.goal).toBe(0);
    expect(empty.done).toBe(true);
  });

  it("keeps a capped goal steady when a card earns more than one point", () => {
    // 4 excerpts available: goal 4. Card one (3 points) -> 3 left, goal stays 4.
    const four = ready.slice(0, 4);
    expect(excerptSlice(task, four, [], NOW).goal).toBe(4);
    const carded = review({ action: "card", excerpt_id: "e0", card_id: "c" });
    const after = excerptSlice(task, four.slice(1), [carded], NOW);
    expect(after.goal).toBe(4);
    expect(after.pointsToday).toBe(CARD_POINTS);
    expect(after.remaining).toBe(1);
  });

  it("is done once points reach the goal (a card can overshoot)", () => {
    const s = excerptSlice(task, ready, passes(11), NOW);
    expect(s.done).toBe(true);
    expect(s.queue).toHaveLength(0);
  });
});

describe("planSync", () => {
  let n = 0;
  const ids = () => `new-${++n}`;
  beforeEach(() => {
    n = 0;
  });

  it("inserts new highlights as queued, due now", () => {
    const plan = planSync([makeExcerpt({ readwise_id: "x" })], [highlight()], NOW, { newId: ids });
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({
      id: "new-1",
      readwise_id: "h1",
      status: "queued",
      due: NOW,
      backlog: false,
      book_title: "Book",
    });
  });

  it("flags old highlights as backlog on the first import only", () => {
    const old = highlight({ id: "old", highlightedAt: NOW - (BACKLOG_GRACE_DAYS + 1) * DAY });
    const recent = highlight({ id: "recent", text: "Other", highlightedAt: NOW - DAY });
    const first = planSync([], [old, recent], NOW, { newId: ids });
    expect(first.inserts.find((e) => e.readwise_id === "old")!.backlog).toBe(true);
    expect(first.inserts.find((e) => e.readwise_id === "recent")!.backlog).toBe(false);

    const later = planSync([makeExcerpt({ readwise_id: "x" })], [old], NOW, { newId: ids });
    expect(later.inserts[0]!.backlog).toBe(false);
  });

  it("never inserts the same highlight twice", () => {
    const existing = [makeExcerpt({ readwise_id: "h1", text: "Text", book_title: "Book" })];
    const plan = planSync(existing, [highlight(), highlight()], NOW);
    expect(plan.inserts).toHaveLength(0);
    // and the same text in the same book from a second source is skipped too
    const dup = planSync(existing, [highlight({ id: "h2", text: "  text " })], NOW);
    expect(dup.inserts).toHaveLength(0);
    // duplicates within one batch
    const batch = planSync([], [highlight({ id: "a" }), highlight({ id: "b" })], NOW);
    expect(batch.inserts).toHaveLength(1);
  });

  it("updates an edited highlight in place, keeping status and pass count", () => {
    const existing = [
      makeExcerpt({ id: "e", readwise_id: "h1", text: "Old", status: "carded", pass_count: 2 }),
    ];
    const plan = planSync(existing, [highlight({ text: "New", note: "mine", updatedAt: NOW })], NOW);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toEqual([
      expect.objectContaining({ id: "e", text: "New", note: "mine", status: "carded", pass_count: 2 }),
    ]);
    // unchanged -> no write
    expect(planSync(plan.updates, [highlight({ text: "New", note: "mine", updatedAt: NOW })], NOW).updates).toEqual([]);
  });

  it("marks deleted highlights, keeping the text, and skips deleted new ones", () => {
    const existing = [makeExcerpt({ id: "e", readwise_id: "h1", text: "Keep" })];
    const plan = planSync(
      existing,
      [highlight({ deleted: true, text: "" }), highlight({ id: "never", deleted: true })],
      NOW,
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.removed).toBe(1);
    expect(plan.updates[0]).toMatchObject({ id: "e", source_deleted: true, text: "Keep" });
  });

  it("folds an edit of a highlight inserted in the same batch into the insert", () => {
    const plan = planSync([], [highlight({ text: "v1" }), highlight({ text: "v2", updatedAt: NOW })], NOW);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]!.text).toBe("v2");
    expect(plan.updates).toHaveLength(0);
  });
});

describe("syncCursor / dedupKey", () => {
  it("is the newest stored updated_at, or null when empty", () => {
    expect(syncCursor([])).toBeNull();
    expect(
      syncCursor([makeExcerpt({ source_updated_at: 5 }), makeExcerpt({ source_updated_at: 9 })]),
    ).toBe(9);
  });

  it("normalises case and whitespace", () => {
    expect(dedupKey("Book", "A  b\nc")).toBe(dedupKey("book ", "a b c"));
  });
});
