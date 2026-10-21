import { DateTime } from "luxon";
import { MemoryStore } from "../db/memoryStore";
import {
  syncExcerpts,
  checkSource,
  uncheckSource,
  hideSource,
  unhideSource,
  dismissNewSource,
  markSourceDone,
  reopenSource,
  moveSourceRank,
  ensureExcerptSources,
  decideExcerpt,
  undoExcerptDecision,
  returnToQueue,
  cardFromExcerpts,
  excerptCounts,
  EXCERPT_DECK_NAME,
} from "./excerpts";
import { getTodayView, getExcerptSlice, getFlashcardQueue } from "./learning";
import { createTask } from "./authoring";
import { exportBackup, restoreBackup } from "./backupService";
import {
  FakeReadwiseHighlightsClient,
  type ReadwiseBook,
  type ReadwiseHighlight,
} from "../lib/readwiseHighlights";
import { CARD_POINTS, MAX_PASSES, focusQueue } from "../lib/excerpts";
import { makeExcerpt } from "../lib/testFixtures";
import type { ExcerptSource } from "../db/schema";

const LA = "America/Los_Angeles";
const at = (iso: string) => DateTime.fromISO(iso, { zone: LA }).toMillis();
const NOW = at("2026-06-15T12:00");

function book(id: string, title: string): ReadwiseBook {
  return { id, title, author: "Someone", category: "books", numHighlights: 0, lastHighlightAt: null };
}

function hl(bookId: string, i: number, over: Partial<ReadwiseHighlight> = {}): ReadwiseHighlight {
  return {
    id: `${bookId}-h${i}`,
    bookId,
    text: `${bookId} highlight ${i}`,
    note: null,
    bookTitle: bookId === "A" ? "Atomic Habits" : "Bullshit Jobs",
    bookAuthor: "Someone",
    url: `https://readwise.io/open/${bookId}-h${i}`,
    location: i,
    highlightedAt: NOW - 60_000,
    updatedAt: NOW - 60_000 + i,
    deleted: false,
    ...over,
  };
}

/** Two books, A and B, with `perBook` highlights each; list refreshed, nothing checked. */
async function setup(perBook = 5) {
  const store = new MemoryStore();
  const client = new FakeReadwiseHighlightsClient(
    [book("A", "Atomic Habits"), book("B", "Bullshit Jobs")],
    Array.from({ length: perBook }, (_, i) => [hl("A", i + 1), hl("B", i + 1)]).flat(),
  );
  await syncExcerpts(store, client, NOW);
  const sources = await store.listExcerptSources();
  const src = (bookId: string) => sources.find((s) => s.readwise_book_id === bookId)!;
  return { store, client, A: src("A"), B: src("B") };
}

async function excerptTask(store: MemoryStore) {
  return (await store.listTasks()).find((t) => t.type === "excerpt")!;
}

async function source(store: MemoryStore, id: string): Promise<ExcerptSource> {
  return (await store.listExcerptSources()).find((s) => s.id === id)!;
}

describe("sources: nothing syncs until checked", () => {
  it("first refresh lists sources unchecked and fetches no highlights", async () => {
    const { store, client, A, B } = await setup();
    expect([A.state, B.state]).toEqual(["unchecked", "unchecked"]);
    expect(await store.listExcerpts()).toEqual([]);
    expect(client.calls).toEqual([]);
    expect(await store.listTasks()).toEqual([]);
  });

  it("checking a source fetches only its highlights and creates the daily task", async () => {
    const { store, client, A } = await setup(3);
    const r = await checkSource(store, client, A.id, NOW);
    expect(r.added).toBe(3);
    expect(client.calls).toEqual([{ bookIds: ["A"], updatedAfter: null }]);
    expect((await store.listExcerpts()).every((e) => e.source_id === A.id)).toBe(true);
    expect(await excerptTask(store)).toMatchObject({ title: "Review excerpts", cadence: 10 });
  });

  it("later syncs flag new books, and fetch checked sources incrementally", async () => {
    const { store, client, A } = await setup(2);
    await checkSource(store, client, A.id, NOW);
    client.books.push(book("C", "Clean Code"));
    client.highlights.push(hl("A", 9), hl("B", 9));
    const r = await syncExcerpts(store, client, NOW + 1000);
    expect(r).toEqual({ added: 1, updated: 0, removed: 0, newSources: 1 });
    expect(client.calls.at(-1)).toEqual({ bookIds: ["A"], updatedAfter: NOW - 60_000 + 2 });
    const c = (await store.listExcerptSources()).find((s) => s.readwise_book_id === "C")!;
    expect(c.state).toBe("new");

    await dismissNewSource(store, c.id);
    expect((await source(store, c.id)).state).toBe("unchecked");
  });

  it("unchecking stops syncing and takes undecided excerpts out of the queue, losslessly", async () => {
    const { store, client, A } = await setup(2);
    await checkSource(store, client, A.id, NOW);
    const task = await excerptTask(store);
    await uncheckSource(store, A.id);
    expect((await getExcerptSlice(store, task, NOW, LA)).readyCount).toBe(0);
    client.highlights.push(hl("A", 9));
    await syncExcerpts(store, client, NOW + 1);
    expect(await store.listExcerpts()).toHaveLength(2);

    // recheck resumes from its cursor and picks up what it missed
    await checkSource(store, client, A.id, NOW + 2);
    expect(await store.listExcerpts()).toHaveLength(3);
    expect((await getExcerptSlice(store, task, NOW + 2, LA)).readyCount).toBe(3);
  });

  it("hidden sources stay hidden through refreshes; unhide returns them unchecked", async () => {
    const { store, client, B } = await setup(1);
    await hideSource(store, B.id);
    client.books[1] = { ...client.books[1]!, numHighlights: 50 };
    await syncExcerpts(store, client, NOW + 1);
    expect((await source(store, B.id)).state).toBe("hidden");
    await unhideSource(store, B.id);
    expect((await source(store, B.id)).state).toBe("unchecked");
  });
});

describe("Reader links", () => {
  it("re-links excerpts synced before Reader links, once, then goes back to incremental", async () => {
    const { store, client, A } = await setup(2);
    client.books[0] = { ...client.books[0]!, category: "articles" };
    await checkSource(store, client, A.id, NOW); // syncs with the old highlights-page links
    expect((await store.listExcerpts()).map((e) => e.url)).toEqual([
      "https://readwise.io/open/A-h1",
      "https://readwise.io/open/A-h2",
    ]);

    // Readwise's export now carries Reader links (updated_at unchanged).
    client.highlights = client.highlights.map((h) => ({ ...h, url: `https://read.readwise.io/read/${h.id}` }));
    const r = await syncExcerpts(store, client, NOW + 1000);
    expect(r.updated).toBe(2);
    expect(client.calls.at(-1)).toEqual({ bookIds: ["A"], updatedAfter: null });
    expect((await store.listExcerpts()).every((e) => e.url?.startsWith("https://read.readwise.io/"))).toBe(true);

    await syncExcerpts(store, client, NOW + 2000);
    expect(client.calls.at(-1)!.updatedAfter).not.toBeNull();
  });
});

describe("daily queue: block order by source rank", () => {
  it("works through the top source before the next, in book order", async () => {
    const { store, client, A, B } = await setup(3);
    await checkSource(store, client, B.id, NOW);
    await checkSource(store, client, A.id, NOW);
    const task = await excerptTask(store);
    let q = (await getExcerptSlice(store, task, NOW, LA)).queue.map((e) => e.readwise_id);
    expect(q).toEqual(["B-h1", "B-h2", "B-h3", "A-h1", "A-h2", "A-h3"]);

    await moveSourceRank(store, A.id, "up");
    q = (await getExcerptSlice(store, task, NOW, LA)).queue.map((e) => e.readwise_id);
    expect(q.slice(0, 3)).toEqual(["A-h1", "A-h2", "A-h3"]);
  });
});

describe("triage decisions", () => {
  async function checkedA(perBook = 5) {
    const ctx = await setup(perBook);
    await checkSource(ctx.store, ctx.client, ctx.A.id, NOW);
    return { ...ctx, task: await excerptTask(ctx.store) };
  }

  it("ignore / later / set aside update the excerpt and count toward today", async () => {
    const { store, task } = await checkedA(5);
    const [a, b, c] = (await getExcerptSlice(store, task, NOW, LA)).queue;

    await decideExcerpt(store, a!.id, "ignore", NOW, LA);
    await decideExcerpt(store, b!.id, "pass", NOW, LA);
    await decideExcerpt(store, c!.id, "set_aside", NOW, LA);

    expect((await store.getExcerpt(a!.id))!.status).toBe("ignored");
    const later = (await store.getExcerpt(b!.id))!;
    expect(later).toMatchObject({ status: "queued", pass_count: 1 });
    expect(later.due).toBeGreaterThan(NOW);
    expect((await store.getExcerpt(c!.id))!.status).toBe("set_aside");

    const slice = await getExcerptSlice(store, task, NOW, LA);
    expect(slice.pointsToday).toBe(3);
    expect(slice.goal).toBe(5);
    expect(slice.queue).toHaveLength(2);
    expect(slice.setAsideCount).toBe(1);
  });

  it("a Later excerpt comes back after 2, 5, 7 days, then must be decided", async () => {
    const { store, task } = await checkedA(1);
    const [e] = (await getExcerptSlice(store, task, NOW, LA)).queue;
    let t = NOW;
    for (let i = 0; i < MAX_PASSES; i++) {
      await decideExcerpt(store, e!.id, "pass", t, LA);
      const due = (await store.getExcerpt(e!.id))!.due;
      expect((await getExcerptSlice(store, task, due - 1, LA)).readyCount).toBe(0);
      t = due + 1;
      expect((await getExcerptSlice(store, task, t, LA)).readyCount).toBe(1);
    }
    expect(t - NOW).toBeLessThan(15 * 24 * 60 * 60 * 1000);
    await expect(decideExcerpt(store, e!.id, "pass", t, LA)).rejects.toThrow();
  });

  it("undo restores the excerpt and stops the decision counting", async () => {
    const { store, task } = await checkedA(2);
    const [a] = (await getExcerptSlice(store, task, NOW, LA)).queue;
    const undo = await decideExcerpt(store, a!.id, "ignore", NOW, LA);
    await undoExcerptDecision(store, undo);
    expect((await store.getExcerpt(a!.id))!.status).toBe("queued");
    expect((await getExcerptSlice(store, task, NOW, LA)).pointsToday).toBe(0);
  });

  it("return-to-queue takes an excerpt out of the pile uncarded, for no points", async () => {
    const { store, task } = await checkedA(2);
    const [a] = (await getExcerptSlice(store, task, NOW, LA)).queue;
    await decideExcerpt(store, a!.id, "set_aside", NOW, LA);
    await returnToQueue(store, a!.id, NOW + 1);
    expect((await store.getExcerpt(a!.id))!).toMatchObject({ status: "queued", due: NOW + 1 });
    expect((await getExcerptSlice(store, task, NOW + 2, LA)).pointsToday).toBe(1);
  });
});

describe("focus mode", () => {
  it("covers every undecided excerpt of the source, Laters included, regardless of check state", async () => {
    const { store, client, A } = await setup(4);
    await checkSource(store, client, A.id, NOW);
    const [first, second] = focusQueue(await store.listExcerpts(), A.id);
    await decideExcerpt(store, first!.id, "pass", NOW, LA); // due in 2 days
    await decideExcerpt(store, second!.id, "set_aside", NOW, LA);
    await markSourceDone(store, A.id, "leave", NOW);

    const focus = focusQueue(await store.listExcerpts(), A.id).map((e) => e.readwise_id);
    expect(focus).toEqual(["A-h1", "A-h3", "A-h4"]);
  });
});

describe("done sources", () => {
  it("'leave' keeps undecided excerpts (out of the queue); 'ignore' resolves them without points", async () => {
    const { store, client, A, B } = await setup(3);
    await checkSource(store, client, A.id, NOW);
    await checkSource(store, client, B.id, NOW);
    const task = await excerptTask(store);

    await markSourceDone(store, A.id, "leave", NOW);
    expect(await source(store, A.id)).toMatchObject({ state: "done", done_at: NOW });
    const slice = await getExcerptSlice(store, task, NOW, LA);
    expect(slice.queue.every((e) => e.source_id === B.id)).toBe(true);
    expect(focusQueue(await store.listExcerpts(), A.id)).toHaveLength(3);

    await markSourceDone(store, B.id, "ignore", NOW);
    const bExcerpts = (await store.listExcerpts()).filter((e) => e.source_id === B.id);
    expect(bExcerpts.every((e) => e.status === "ignored")).toBe(true);
    expect((await getExcerptSlice(store, task, NOW, LA)).pointsToday).toBe(0);

    // done sources aren't synced
    client.highlights.push(hl("A", 9));
    await syncExcerpts(store, client, NOW + 1);
    expect((await store.listExcerpts()).filter((e) => e.source_id === A.id)).toHaveLength(3);

    // reopening checks it again (bottom of the order) and catches up
    await reopenSource(store, client, A.id, NOW + 2);
    expect(await source(store, A.id)).toMatchObject({ state: "checked", done_at: null });
    expect((await store.listExcerpts()).filter((e) => e.source_id === A.id)).toHaveLength(4);
  });
});

describe("upstream edits and deletions", () => {
  it("drops a deleted highlight from the queue, but keeps a carded one's card", async () => {
    const { store, client, A } = await setup(2);
    await checkSource(store, client, A.id, NOW);
    const [a] = focusQueue(await store.listExcerpts(), A.id);
    const card = await cardFromExcerpts(store, [a!.id], "Q", "A", NOW, LA);

    client.highlights = client.highlights.map((h) =>
      h.bookId === "A" ? { ...h, deleted: true, updatedAt: NOW + 5 } : h,
    );
    const r = await syncExcerpts(store, client, NOW + 10);
    expect(r.updated).toBe(2);
    expect((await excerptCounts(store, NOW + 10)).ready).toBe(0);
    expect(await store.getCard(card.id)).not.toBeNull();
    expect((await store.listExcerptsForCard(card.id))[0]!.source_deleted).toBe(true);
  });
});

describe("cardFromExcerpts", () => {
  it("writes one front/back card that joins flashcard review and links its excerpts", async () => {
    const { store, client, A } = await setup(4);
    await checkSource(store, client, A.id, NOW);
    const task = await excerptTask(store);
    const [a, b] = (await getExcerptSlice(store, task, NOW, LA)).queue;
    await decideExcerpt(store, a!.id, "set_aside", NOW, LA);
    await decideExcerpt(store, b!.id, "set_aside", NOW, LA);

    const card = await cardFromExcerpts(store, [a!.id, b!.id], " Front ", " Back ", NOW, LA);
    expect(card).toMatchObject({ front: "Front", back: "Back", note_id: null });
    const deck = (await store.listDecks()).find((d) => d.id === card.deck_id)!;
    expect(deck.name).toBe(EXCERPT_DECK_NAME);
    expect((await store.listExcerptsForCard(card.id)).map((e) => e.id).sort()).toEqual([a!.id, b!.id].sort());

    const slice = await getExcerptSlice(store, task, NOW, LA);
    expect(slice.pointsToday).toBe(2 + CARD_POINTS);
    expect(slice.setAsideCount).toBe(0);

    const reviewTask = await createTask(store, { type: "flashcard", title: "Review", cadence: 30 }, NOW);
    const fc = await getFlashcardQueue(store, reviewTask, NOW, LA);
    expect(fc.queue.map((x) => x.id)).toContain(card.id);
  });

  it("requires both sides", async () => {
    const { store, client, A } = await setup(1);
    await checkSource(store, client, A.id, NOW);
    const [a] = focusQueue(await store.listExcerpts(), A.id);
    await expect(cardFromExcerpts(store, [a!.id], "Q", "  ", NOW, LA)).rejects.toThrow();
  });
});

describe("excerpt task on Today", () => {
  it("shows progress, credits the day at the goal, earns XP, and flags new sources", async () => {
    const { store, client, A } = await setup(12);
    await checkSource(store, client, A.id, NOW);
    client.books.push(book("C", "Clean Code"));
    await syncExcerpts(store, client, NOW);
    const task = await excerptTask(store);

    let view = await getTodayView(store, NOW, LA);
    const item = view.slice.tasks.find((t) => t.task.id === task.id)!;
    expect(item.excerpts).toMatchObject({ goal: 10, newSourceCount: 1 });

    // 1 card (3 points) + 7 Laters = 10
    const queue = item.excerpts!.queue;
    await cardFromExcerpts(store, [queue[0]!.id], "Q", "A", NOW, LA);
    for (const e of queue.slice(1, 8)) await decideExcerpt(store, e.id, "pass", NOW, LA);

    view = await getTodayView(store, NOW, LA);
    expect(view.slice.tasks.find((t) => t.task.id === task.id)).toBeUndefined();
    const done = (await store.listCompletionsForDay("2026-06-15")).filter(
      (c) => c.task_id === task.id && c.verified,
    );
    expect(done).toHaveLength(1);
    expect(done[0]!.evidence).toEqual({ type: "excerpt", points: 10, goal: 10 });
    expect(view.streak).toBe(1);
    expect(view.xp.totalXp).toBe(10);
  });
});

describe("legacy excerpts (imported before sources existed)", () => {
  it("get a checked source per book, which a refresh then matches by title", async () => {
    const store = new MemoryStore();
    await store.insertExcerpts([
      makeExcerpt({ id: "x1", readwise_id: "A-h1", source_id: null, book_title: "Atomic Habits" }),
      makeExcerpt({ id: "x2", readwise_id: "A-h2", source_id: null, book_title: "Atomic Habits" }),
    ]);
    await ensureExcerptSources(store, NOW);
    const [legacy] = await store.listExcerptSources();
    expect(legacy).toMatchObject({ title: "Atomic Habits", state: "checked", readwise_book_id: null });
    expect((await store.listExcerpts()).every((e) => e.source_id === legacy!.id)).toBe(true);

    const client = new FakeReadwiseHighlightsClient([book("A", "Atomic Habits")], [hl("A", 1), hl("A", 2), hl("A", 3)]);
    await syncExcerpts(store, client, NOW);
    const sources = await store.listExcerptSources();
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ id: legacy!.id, readwise_book_id: "A", state: "checked" });
    // the two it had are matched by id; the third is new
    expect(await store.listExcerpts()).toHaveLength(3);
  });
});

describe("backup", () => {
  it("round-trips sources, excerpts, their history and card links", async () => {
    const { store, client, A } = await setup(3);
    await checkSource(store, client, A.id, NOW);
    const task = await excerptTask(store);
    const [a, b] = (await getExcerptSlice(store, task, NOW, LA)).queue;
    await decideExcerpt(store, a!.id, "pass", NOW, LA);
    const card = await cardFromExcerpts(store, [b!.id], "Q", "A", NOW, LA);

    const json = await exportBackup(store, NOW);
    const restored = new MemoryStore();
    await restoreBackup(restored, json);
    expect(await restored.listExcerptSources()).toEqual(await store.listExcerptSources());
    expect(await restored.listExcerpts()).toEqual(await store.listExcerpts());
    expect(await restored.listExcerptReviewsSince(0)).toEqual(await store.listExcerptReviewsSince(0));
    expect((await restored.listExcerptsForCard(card.id)).map((e) => e.id)).toEqual([b!.id]);
  });
});
