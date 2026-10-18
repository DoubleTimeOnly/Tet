import {
  canPass,
  passExcerpt,
  excerptQueue,
  focusQueue,
  withSkipsLast,
  setAsidePile,
  excerptPoints,
  excerptSlice,
  planSources,
  backfillSources,
  moveSource,
  nextRank,
  sourceStats,
  planSync,
  syncCursor,
  dedupKey,
  MAX_PASSES,
  PASS_INTERVAL_DAYS,
  CARD_POINTS,
} from "./excerpts";
import { startOfTetDay } from "./dayKey";
import { makeExcerpt, makeSource, makeTask } from "./testFixtures";
import type { ExcerptReview } from "../db/schema";
import type { ReadwiseBook, ReadwiseHighlight } from "./readwiseHighlights";

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
    bookId: "book-1",
    text: "Text",
    note: null,
    bookTitle: "Book",
    bookAuthor: "Author",
    url: "https://readwise.io/open/h1",
    location: null,
    highlightedAt: NOW - DAY,
    updatedAt: NOW - DAY,
    deleted: false,
    ...over,
  };
}

function book(over: Partial<ReadwiseBook> = {}): ReadwiseBook {
  return {
    id: "book-1",
    title: "Book",
    author: "Author",
    category: "books",
    numHighlights: 3,
    lastHighlightAt: null,
    ...over,
  };
}

describe("passExcerpt (daily Later)", () => {
  it("pushes due to the start of the Tet day 2, then 5, then 7 days out", () => {
    expect([...PASS_INTERVAL_DAYS]).toEqual([2, 5, 7]);
    let e = makeExcerpt();
    const dayStart = startOfTetDay(NOW, TZ);
    for (let i = 0; i < MAX_PASSES; i++) {
      e = passExcerpt(e, NOW, TZ);
      expect(e.pass_count).toBe(i + 1);
      expect(e.due).toBe(dayStart + PASS_INTERVAL_DAYS[i]! * DAY);
    }
  });

  it("is capped: after MAX_PASSES the excerpt must be decided", () => {
    const e = makeExcerpt({ pass_count: MAX_PASSES });
    expect(canPass(e)).toBe(false);
    expect(() => passExcerpt(e, NOW, TZ)).toThrow();
    expect(canPass(makeExcerpt({ pass_count: MAX_PASSES - 1 }))).toBe(true);
  });
});

describe("excerptQueue (daily, block order)", () => {
  const top = makeSource({ id: "top", rank: 0 });
  const second = makeSource({ id: "second", readwise_book_id: "b2", rank: 1 });
  const off = makeSource({ id: "off", readwise_book_id: "b3", state: "unchecked" });
  const done = makeSource({ id: "done", readwise_book_id: "b4", state: "done" });
  const sources = [second, off, top, done];

  it("serves the top-ranked source in book order, then the next", () => {
    const list = [
      makeExcerpt({ id: "s2-a", source_id: "second", location: 1 }),
      makeExcerpt({ id: "top-b", source_id: "top", location: 20 }),
      makeExcerpt({ id: "top-a", source_id: "top", location: 10 }),
      makeExcerpt({ id: "top-nil", source_id: "top", location: null }),
    ];
    expect(excerptQueue(list, sources, NOW).map((e) => e.id)).toEqual([
      "top-a",
      "top-b",
      "top-nil",
      "s2-a",
    ]);
  });

  it("slots a Later excerpt back in by its source's rank, not ahead of it", () => {
    const list = [
      makeExcerpt({ id: "top-new", source_id: "top", location: 50, due: NOW }),
      makeExcerpt({ id: "s2-later", source_id: "second", location: 1, due: NOW - 5 * DAY, pass_count: 1 }),
    ];
    expect(excerptQueue(list, sources, NOW).map((e) => e.id)).toEqual(["top-new", "s2-later"]);
  });

  it("leaves out unchecked/done sources, future Laters, decided and deleted excerpts", () => {
    const list = [
      makeExcerpt({ id: "a", source_id: "off" }),
      makeExcerpt({ id: "b", source_id: "done" }),
      makeExcerpt({ id: "c", source_id: "top", due: NOW + 1 }),
      makeExcerpt({ id: "d", source_id: "top", status: "set_aside" }),
      makeExcerpt({ id: "e", source_id: "top", status: "carded" }),
      makeExcerpt({ id: "f", source_id: "top", source_deleted: true }),
      makeExcerpt({ id: "g", source_id: null }),
      makeExcerpt({ id: "ok", source_id: "top" }),
    ];
    expect(excerptQueue(list, sources, NOW).map((e) => e.id)).toEqual(["ok"]);
  });
});

describe("focusQueue / withSkipsLast", () => {
  it("covers every undecided excerpt of one source, Laters included, in book order", () => {
    const list = [
      makeExcerpt({ id: "later", source_id: "s", location: 5, due: NOW + 5 * DAY, pass_count: 1 }),
      makeExcerpt({ id: "first", source_id: "s", location: 1 }),
      makeExcerpt({ id: "aside", source_id: "s", status: "set_aside" }),
      makeExcerpt({ id: "other", source_id: "t" }),
    ];
    expect(focusQueue(list, "s").map((e) => e.id)).toEqual(["first", "later"]);
  });

  it("moves skipped excerpts to the end, in skip order", () => {
    const q = ["a", "b", "c", "d"].map((id) => makeExcerpt({ id }));
    expect(withSkipsLast(q, ["b", "a"]).map((e) => e.id)).toEqual(["c", "d", "b", "a"]);
    // a skipped excerpt that has since been decided just drops out
    expect(withSkipsLast(q.slice(1), ["a"]).map((e) => e.id)).toEqual(["b", "c", "d"]);
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
  const sources = [makeSource()];
  const ready = Array.from({ length: 20 }, (_, i) => makeExcerpt({ id: `e${i}`, location: i }));
  const passes = (n: number) =>
    Array.from({ length: n }, (_, i) => review({ id: `p${i}`, excerpt_id: `done${i}` }));

  it("caps the queue to the remaining goal", () => {
    const s = excerptSlice(task, ready, sources, passes(4), NOW);
    expect(s.goal).toBe(10);
    expect(s.pointsToday).toBe(4);
    expect(s.remaining).toBe(6);
    expect(s.queue.map((e) => e.id)).toEqual(["e0", "e1", "e2", "e3", "e4", "e5"]);
    expect(s.readyCount).toBe(20);
    expect(s.done).toBe(false);
  });

  it("caps the goal to what's available and auto-completes an empty queue", () => {
    expect(excerptSlice(task, ready.slice(0, 3), sources, [], NOW).goal).toBe(3);
    const empty = excerptSlice(task, ready, [], [], NOW); // nothing checked
    expect(empty.goal).toBe(0);
    expect(empty.done).toBe(true);
  });

  it("keeps a capped goal steady when a card earns more than one point", () => {
    const four = ready.slice(0, 4);
    expect(excerptSlice(task, four, sources, [], NOW).goal).toBe(4);
    const carded = review({ action: "card", excerpt_id: "e0", card_id: "c" });
    const after = excerptSlice(task, four.slice(1), sources, [carded], NOW);
    expect(after.goal).toBe(4);
    expect(after.pointsToday).toBe(CARD_POINTS);
    expect(after.remaining).toBe(1);
  });

  it("counts new sources awaiting a decision", () => {
    const s = excerptSlice(task, [], [makeSource(), makeSource({ id: "n", state: "new" })], [], NOW);
    expect(s.newSourceCount).toBe(1);
  });
});

describe("planSources", () => {
  let n = 0;
  const ids = () => `src-new-${++n}`;
  beforeEach(() => {
    n = 0;
  });

  it("first refresh: everything unchecked (nothing syncs until chosen)", () => {
    const plan = planSources([], [book(), book({ id: "book-2", title: "Other" })], NOW, { newId: ids });
    expect(plan.inserts.map((s) => s.state)).toEqual(["unchecked", "unchecked"]);
    expect(plan.newCount).toBe(0);
  });

  it("later refreshes flag unknown books as new and leave known states alone", () => {
    const hidden = makeSource({ id: "h", readwise_book_id: "book-1", state: "hidden", num_highlights: 1 });
    const plan = planSources(
      [hidden],
      [book({ numHighlights: 9 }), book({ id: "book-2", title: "Fresh" })],
      NOW,
      { newId: ids },
    );
    expect(plan.inserts).toEqual([expect.objectContaining({ title: "Fresh", state: "new" })]);
    expect(plan.newCount).toBe(1);
    expect(plan.updates).toEqual([expect.objectContaining({ id: "h", state: "hidden", num_highlights: 9 })]);
  });

  it("adopts a legacy (title-only) source's book id instead of duplicating it", () => {
    const legacy = makeSource({ id: "leg", readwise_book_id: null, title: "Atomic  Habits" });
    const plan = planSources([legacy], [book({ id: "77", title: "atomic habits" })], NOW, { newId: ids });
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([expect.objectContaining({ id: "leg", readwise_book_id: "77", state: "checked" })]);
  });

  it("writes nothing when nothing changed", () => {
    const s = makeSource({ readwise_book_id: "book-1", title: "Book", author: "Author", category: "books", num_highlights: 3 });
    expect(planSources([s], [book()], NOW)).toEqual({ inserts: [], updates: [], newCount: 0 });
  });
});

describe("source ranking and stats", () => {
  const a = makeSource({ id: "a", rank: 0 });
  const b = makeSource({ id: "b", readwise_book_id: "b", rank: 1 });
  const c = makeSource({ id: "c", readwise_book_id: "c", rank: 5 });

  it("moves a source up or down and keeps ranks dense", () => {
    expect(moveSource([a, b, c], "c", "up").map((s) => [s.id, s.rank])).toEqual([
      ["a", 0],
      ["c", 1],
      ["b", 2],
    ]);
    // top can't go higher
    expect(moveSource([a, b], "a", "up").map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("puts a newly checked source at the bottom", () => {
    expect(nextRank([a, c, makeSource({ id: "x", state: "unchecked", rank: 99 })])).toBe(6);
    expect(nextRank([])).toBe(0);
  });

  it("tallies excerpts per source", () => {
    const stats = sourceStats([
      makeExcerpt({ id: "1", source_id: "a" }),
      makeExcerpt({ id: "2", source_id: "a", status: "carded" }),
      makeExcerpt({ id: "3", source_id: "a", status: "ignored" }),
      makeExcerpt({ id: "4", source_id: "a", status: "set_aside" }),
      makeExcerpt({ id: "5", source_id: "a", source_deleted: true }),
    ]);
    expect(stats.get("a")).toEqual({ undecided: 1, setAside: 1, carded: 1, ignored: 1 });
  });
});

describe("backfillSources", () => {
  it("gives orphaned excerpts one checked source per book title", () => {
    const existing = makeSource({ id: "known", title: "Known" });
    const plan = backfillSources(
      [
        makeExcerpt({ id: "1", source_id: null, book_title: "Known" }),
        makeExcerpt({ id: "2", source_id: null, book_title: "Lost" }),
        makeExcerpt({ id: "3", source_id: null, book_title: "lost" }),
        makeExcerpt({ id: "4", source_id: "known" }),
      ],
      [existing],
      NOW,
      { newId: () => "made" },
    );
    expect(plan.sources).toEqual([
      expect.objectContaining({ id: "made", title: "Lost", state: "checked", readwise_book_id: null, rank: 1 }),
    ]);
    expect(plan.excerpts.map((e) => [e.id, e.source_id])).toEqual([
      ["1", "known"],
      ["2", "made"],
      ["3", "made"],
    ]);
  });
});

describe("planSync", () => {
  const src = makeSource({ id: "src", readwise_book_id: "book-1" });
  const map = new Map([["book-1", src]]);
  let n = 0;
  const ids = () => `new-${++n}`;
  beforeEach(() => {
    n = 0;
  });

  it("inserts new highlights of known sources as queued, due now, with book position", () => {
    const plan = planSync([], [highlight({ location: 12 }), highlight({ id: "x", bookId: "elsewhere" })], map, NOW, {
      newId: ids,
    });
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({
      id: "new-1",
      readwise_id: "h1",
      source_id: "src",
      location: 12,
      status: "queued",
      due: NOW,
    });
  });

  it("never inserts the same highlight twice", () => {
    const existing = [makeExcerpt({ readwise_id: "h1", text: "Text", book_title: "Book", source_id: "src" })];
    expect(planSync(existing, [highlight(), highlight()], map, NOW).inserts).toHaveLength(0);
    // the same text in the same book from a second source is skipped too
    expect(planSync(existing, [highlight({ id: "h2", text: "  text " })], map, NOW).inserts).toHaveLength(0);
    // duplicates within one batch
    expect(planSync([], [highlight({ id: "a" }), highlight({ id: "b" })], map, NOW).inserts).toHaveLength(1);
  });

  it("updates an edited highlight in place, keeping status and Later count", () => {
    const existing = [
      makeExcerpt({ id: "e", readwise_id: "h1", source_id: "src", text: "Old", status: "carded", pass_count: 2 }),
    ];
    const plan = planSync(existing, [highlight({ text: "New", note: "mine", updatedAt: NOW })], map, NOW);
    expect(plan.updates).toEqual([
      expect.objectContaining({ id: "e", text: "New", note: "mine", status: "carded", pass_count: 2 }),
    ]);
    expect(planSync(plan.updates, [highlight({ text: "New", note: "mine", updatedAt: NOW })], map, NOW).updates).toEqual([]);
  });

  it("marks deleted highlights, keeping the text, and skips deleted new ones", () => {
    const existing = [makeExcerpt({ id: "e", readwise_id: "h1", source_id: "src", text: "Keep" })];
    const plan = planSync(
      existing,
      [highlight({ deleted: true, text: "" }), highlight({ id: "never", deleted: true })],
      map,
      NOW,
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.removed).toBe(1);
    expect(plan.updates[0]).toMatchObject({ id: "e", source_deleted: true, text: "Keep" });
  });

  it("folds an edit of a highlight inserted in the same batch into the insert", () => {
    const plan = planSync([], [highlight({ text: "v1" }), highlight({ text: "v2", updatedAt: NOW })], map, NOW);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]!.text).toBe("v2");
    expect(plan.updates).toHaveLength(0);
  });
});

describe("syncCursor / dedupKey", () => {
  it("is the newest stored updated_at for that source, or null", () => {
    const list = [
      makeExcerpt({ source_id: "a", source_updated_at: 5 }),
      makeExcerpt({ source_id: "a", source_updated_at: 9 }),
      makeExcerpt({ source_id: "b", source_updated_at: 50 }),
    ];
    expect(syncCursor(list, "a")).toBe(9);
    expect(syncCursor(list, "c")).toBeNull();
  });

  it("normalises case and whitespace", () => {
    expect(dedupKey("Book", "A  b\nc")).toBe(dedupKey("book ", "a b c"));
  });
});
