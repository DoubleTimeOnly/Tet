import { DateTime } from "luxon";
import { MemoryStore } from "../db/memoryStore";
import {
  syncExcerpts,
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
import { FakeReadwiseHighlightsClient, type ReadwiseHighlight } from "../lib/readwiseHighlights";
import { CARD_POINTS, MAX_PASSES } from "../lib/excerpts";

const LA = "America/Los_Angeles";
const at = (iso: string) => DateTime.fromISO(iso, { zone: LA }).toMillis();
const NOW = at("2026-06-15T12:00");

function hl(i: number, over: Partial<ReadwiseHighlight> = {}): ReadwiseHighlight {
  return {
    id: `h${i}`,
    text: `Highlight ${i}`,
    note: null,
    bookTitle: i % 2 ? "Book A" : "Book B",
    bookAuthor: "Someone",
    url: `https://readwise.io/open/h${i}`,
    highlightedAt: NOW - 60_000,
    updatedAt: NOW - 60_000 + i,
    deleted: false,
    ...over,
  };
}

async function setup(count = 5) {
  const store = new MemoryStore();
  const client = new FakeReadwiseHighlightsClient(
    Array.from({ length: count }, (_, i) => hl(i + 1)),
  );
  await syncExcerpts(store, client, NOW);
  const task = (await store.listTasks()).find((t) => t.type === "excerpt")!;
  return { store, client, task };
}

describe("syncExcerpts", () => {
  it("imports highlights and creates the daily excerpt task once", async () => {
    const { store, client, task } = await setup(3);
    expect(task).toMatchObject({ title: "Review excerpts", cadence: 10, active: true });
    expect(await store.listExcerpts()).toHaveLength(3);

    // second sync asks only for what's newer, and adds nothing twice
    client.highlights.push(hl(4));
    const r = await syncExcerpts(store, client, NOW + 1000);
    expect(r).toEqual({ added: 1, updated: 0, removed: 0 });
    expect(client.calls[1]).toBe(NOW - 60_000 + 3);
    expect(await store.listExcerpts()).toHaveLength(4);
    expect((await store.listTasks()).filter((t) => t.type === "excerpt")).toHaveLength(1);
  });

  it("doesn't recreate an excerpt task the user removed", async () => {
    const { store, client, task } = await setup(1);
    await store.setTaskActive(task.id, false);
    client.highlights.push(hl(2));
    await syncExcerpts(store, client, NOW + 1000);
    expect((await store.listTasks()).filter((t) => t.type === "excerpt")).toHaveLength(1);
  });

  it("drops a highlight deleted upstream from the queue, but keeps a carded one's card", async () => {
    const { store, client } = await setup(2);
    const [a, b] = await store.listExcerpts();
    const card = await cardFromExcerpts(store, [a!.id], "Q", "A", NOW, LA);

    client.highlights = [
      hl(1, { deleted: true, updatedAt: NOW + 5 }),
      hl(2, { deleted: true, updatedAt: NOW + 5 }),
    ];
    const r = await syncExcerpts(store, client, NOW + 10);
    expect(r.updated).toBe(2);
    const after = await store.listExcerpts();
    expect(after.every((e) => e.source_deleted)).toBe(true);
    expect((await excerptCounts(store, NOW + 10)).ready).toBe(0);
    expect(await store.getCard(card.id)).not.toBeNull();
    expect((await store.listExcerptsForCard(card.id))[0]!.id).toBe(a!.id);
    void b;
  });
});

describe("triage decisions", () => {
  it("ignore / pass / set aside update the excerpt and count toward today", async () => {
    const { store, task } = await setup(5);
    const [a, b, c] = (await getExcerptSlice(store, task, NOW, LA)).queue;

    await decideExcerpt(store, a!.id, "ignore", NOW, LA);
    await decideExcerpt(store, b!.id, "pass", NOW, LA);
    await decideExcerpt(store, c!.id, "set_aside", NOW, LA);

    expect((await store.getExcerpt(a!.id))!.status).toBe("ignored");
    const passed = (await store.getExcerpt(b!.id))!;
    expect(passed.status).toBe("queued");
    expect(passed.pass_count).toBe(1);
    expect(passed.due).toBeGreaterThan(NOW);
    expect((await store.getExcerpt(c!.id))!.status).toBe("set_aside");

    const slice = await getExcerptSlice(store, task, NOW, LA);
    expect(slice.pointsToday).toBe(3);
    // 5 imported, 3 handled: goal caps to 3 + 2 ready
    expect(slice.goal).toBe(5);
    expect(slice.queue).toHaveLength(2);
    expect(slice.setAsideCount).toBe(1);
  });

  it("a passed excerpt comes back after its interval, until the cap", async () => {
    const { store, task } = await setup(1);
    const [e] = (await getExcerptSlice(store, task, NOW, LA)).queue;
    let t = NOW;
    for (let i = 0; i < MAX_PASSES; i++) {
      await decideExcerpt(store, e!.id, "pass", t, LA);
      const due = (await store.getExcerpt(e!.id))!.due;
      expect((await getExcerptSlice(store, task, due - 1, LA)).readyCount).toBe(0);
      t = due + 1;
      expect((await getExcerptSlice(store, task, t, LA)).readyCount).toBe(1);
    }
    await expect(decideExcerpt(store, e!.id, "pass", t, LA)).rejects.toThrow();
  });

  it("undo restores the excerpt and stops the decision counting", async () => {
    const { store, task } = await setup(2);
    const [a] = (await getExcerptSlice(store, task, NOW, LA)).queue;
    const undo = await decideExcerpt(store, a!.id, "ignore", NOW, LA);
    await undoExcerptDecision(store, undo);
    expect((await store.getExcerpt(a!.id))!.status).toBe("queued");
    expect((await getExcerptSlice(store, task, NOW, LA)).pointsToday).toBe(0);
  });

  it("return-to-queue takes an excerpt out of the pile uncarded, for no points", async () => {
    const { store, task } = await setup(2);
    const [a] = (await getExcerptSlice(store, task, NOW, LA)).queue;
    await decideExcerpt(store, a!.id, "set_aside", NOW, LA);
    await returnToQueue(store, a!.id, NOW + 1);
    expect((await store.getExcerpt(a!.id))!).toMatchObject({ status: "queued", due: NOW + 1 });
    expect((await getExcerptSlice(store, task, NOW + 2, LA)).pointsToday).toBe(1);
  });
});

describe("cardFromExcerpts", () => {
  it("writes one front/back card that joins flashcard review and links its excerpts", async () => {
    const { store, task } = await setup(4);
    const [a, b, c] = (await getExcerptSlice(store, task, NOW, LA)).queue;
    await decideExcerpt(store, a!.id, "set_aside", NOW, LA);
    await decideExcerpt(store, b!.id, "set_aside", NOW, LA);

    const card = await cardFromExcerpts(store, [a!.id, b!.id], " Front ", " Back ", NOW, LA);
    expect(card).toMatchObject({ front: "Front", back: "Back", note_id: null });
    const deck = (await store.listDecks()).find((d) => d.id === card.deck_id)!;
    expect(deck.name).toBe(EXCERPT_DECK_NAME);
    expect((await store.listExcerptsForCard(card.id)).map((e) => e.id).sort()).toEqual(
      [a!.id, b!.id].sort(),
    );
    for (const id of [a!.id, b!.id]) {
      expect((await store.getExcerpt(id))!.status).toBe("carded");
    }

    // 2 set-asides + one combined card
    const slice = await getExcerptSlice(store, task, NOW, LA);
    expect(slice.pointsToday).toBe(2 + CARD_POINTS);
    expect(slice.setAsideCount).toBe(0);
    expect(slice.queue.map((e) => e.id)).not.toContain(a!.id);
    void c;

    // the new card is due in an all-decks flashcard review
    const reviewTask = await createTask(store, { type: "flashcard", title: "Review", cadence: 30 }, NOW);
    const fc = await getFlashcardQueue(store, reviewTask, NOW, LA);
    expect(fc.queue.map((x) => x.id)).toContain(card.id);
  });

  it("requires both sides", async () => {
    const { store, task } = await setup(1);
    const [a] = (await getExcerptSlice(store, task, NOW, LA)).queue;
    await expect(cardFromExcerpts(store, [a!.id], "Q", "  ", NOW, LA)).rejects.toThrow();
  });
});

describe("excerpt task on Today", () => {
  it("shows progress, credits the day at the goal, and earns XP", async () => {
    const { store, task } = await setup(12);
    let view = await getTodayView(store, NOW, LA);
    const item = view.slice.tasks.find((t) => t.task.id === task.id)!;
    expect(item.excerpts?.goal).toBe(10);
    expect(item.count).toBe(10);

    // 1 card (3 points) + 7 triage decisions = 10
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
    const ring = view.allTaskProgress.find((p) => p.task.id === task.id)!;
    expect(ring).toMatchObject({ filledSegments: 10, totalSegments: 10 });
  });
});

describe("backup", () => {
  it("round-trips excerpts, their history and card links", async () => {
    const { store, task } = await setup(3);
    const [a, b] = (await getExcerptSlice(store, task, NOW, LA)).queue;
    await decideExcerpt(store, a!.id, "pass", NOW, LA);
    const card = await cardFromExcerpts(store, [b!.id], "Q", "A", NOW, LA);

    const json = await exportBackup(store, NOW);
    const restored = new MemoryStore();
    await restoreBackup(restored, json);
    expect(await restored.listExcerpts()).toEqual(await store.listExcerpts());
    expect(await restored.listExcerptReviewsSince(0)).toEqual(await store.listExcerptReviewsSince(0));
    expect((await restored.listExcerptsForCard(card.id)).map((e) => e.id)).toEqual([b!.id]);
  });
});
