import { MemoryStore } from "../db/memoryStore";
import { getTodayView, gradeCard, completeTask, getFlashcardQueue } from "./learning";
import { seedStarterDeck, createTask, addCard, createDeck, addCardFromTask, findOrCreateDeck, updateTask } from "./authoring";
import { exportBackup, restoreBackup, importAnki } from "./backupService";
import { DateTime } from "luxon";
import type { AnkiNoteReader } from "../lib/ankiImport";

const LA = "America/Los_Angeles";
const day = (iso: string) => DateTime.fromISO(iso, { zone: LA }).toMillis();

/** The single flashcard task item from a Today view (the seeded reviewer). */
const flashcardItem = (view: Awaited<ReturnType<typeof getTodayView>>) =>
  view.slice.tasks.find((t) => t.task.type === "flashcard");

describe("getTodayView (against MemoryStore)", () => {
  it("cold start before seeding is empty", async () => {
    const store = new MemoryStore();
    const view = await getTodayView(store, day("2026-06-15T12:00"), LA);
    expect(view.slice.tasks).toEqual([]);
    expect(view.streak).toBe(0);
  });

  it("after seeding: surfaces the flashcard task with the seeded due cards", async () => {
    const store = new MemoryStore();
    const now = day("2026-06-15T12:00");
    await seedStarterDeck(store, now);
    const view = await getTodayView(store, now, LA);
    expect(view.slice.tasks.map((t) => t.task.title)).toEqual(["Review flashcards"]);
    expect(flashcardItem(view)?.flashcards?.queue.length).toBe(3); // fresh cards due
  });
});

describe("daily flashcard quota persists across re-entry", () => {
  it("remembers reviews done today and empties the task at the goal", async () => {
    const store = new MemoryStore();
    const now = day("2026-06-15T12:00");
    const deck = await createDeck(store, "D", now);
    // 8 cards due now; a flashcard task with a daily goal (cadence) of 5.
    for (let i = 0; i < 8; i++) {
      await addCard(store, { deckId: deck.id, front: `q${i}`, back: `a${i}` }, now);
    }
    const task = await createTask(store, { type: "flashcard", title: "Review", cadence: 5 }, now);

    // Goal of 5: the queue starts at 5 (not all 8 due cards).
    let view = await getTodayView(store, now, LA);
    expect(flashcardItem(view)?.flashcards?.queue.length).toBe(5);
    expect(flashcardItem(view)?.flashcards?.reviewedToday).toBe(0);

    // Review 2 cards, then "leave" (drop the view) and "re-enter".
    for (const id of flashcardItem(view)!.flashcards!.queue.slice(0, 2).map((c) => c.id)) {
      await gradeCard(store, id, "good", now, LA);
    }
    view = await getTodayView(store, now, LA);
    expect(flashcardItem(view)?.flashcards?.reviewedToday).toBe(2); // remembered
    expect(flashcardItem(view)?.flashcards?.queue.length).toBe(3); // 5 goal - 2 done

    // Finish the day's goal: task is auto-credited and drops out.
    for (const id of flashcardItem(view)!.flashcards!.queue.map((c) => c.id)) {
      await gradeCard(store, id, "good", now, LA);
    }
    view = await getTodayView(store, now, LA);
    expect(view.slice.tasks.map((t) => t.task.id)).not.toContain(task.id); // done

    // The completion was recorded, keeping the streak alive.
    const completions = await store.listCompletionsForDay("2026-06-15");
    expect(completions.some((c) => c.task_id === task.id && c.verified)).toBe(true);

    // A new day resets the quota and re-surfaces remaining due cards.
    const tomorrow = day("2026-06-16T12:00");
    const next = await getTodayView(store, tomorrow, LA);
    expect(flashcardItem(next)?.flashcards?.reviewedToday).toBe(0);
  });

  it("scopes the daily goal to the task's deck", async () => {
    const store = new MemoryStore();
    const now = day("2026-06-15T12:00");
    const deckA = await createDeck(store, "A", now);
    const deckB = await createDeck(store, "B", now);
    for (let i = 0; i < 4; i++) {
      await addCard(store, { deckId: deckA.id, front: `a${i}`, back: "x" }, now);
      await addCard(store, { deckId: deckB.id, front: `b${i}`, back: "x" }, now);
    }
    const task = await createTask(
      store,
      { type: "flashcard", title: "Deck A only", cadence: 10, sourceRef: deckA.id },
      now,
    );

    // The queue only contains deck-A cards.
    const fc = await getFlashcardQueue(store, task, now, LA);
    expect(fc.queue).toHaveLength(4);
    expect(fc.queue.every((c) => c.deck_id === deckA.id)).toBe(true);

    // Reviewing deck-B cards (via an all-decks task) doesn't advance deck-A's goal.
    const bCards = (await store.listAllCards()).filter((c) => c.deck_id === deckB.id);
    for (const c of bCards) await gradeCard(store, c.id, "good", now, LA);
    const after = await getFlashcardQueue(store, task, now, LA);
    expect(after.reviewedToday).toBe(0);
  });
});

describe("full loop: read -> make cards -> review later", () => {
  it("completes the youtube make-cards gate then reviews on a later day", async () => {
    const store = new MemoryStore();
    const d1 = day("2026-06-15T10:00");
    const deck = await createDeck(store, "From videos", d1);
    const task = await createTask(
      store,
      { type: "youtube", title: "Watch lecture", sourceRef: "https://youtu.be/x", makesCardsCount: 2 },
      d1,
    );

    // Watched but no cards yet -> not verified (gate open).
    let completion = await completeTask(store, task, { type: "youtube", manual: true }, d1, LA);
    expect(completion.verified).toBe(false);

    // Make 2 cards citing the task, then completing verifies.
    await addCard(store, { deckId: deck.id, front: "q1", back: "a1", sourceTaskId: task.id }, d1);
    await addCard(store, { deckId: deck.id, front: "q2", back: "a2", sourceTaskId: task.id }, d1);
    completion = await completeTask(store, task, { type: "youtube", manual: true }, d1, LA);
    expect(completion.verified).toBe(true);

    // Add a flashcard task (all decks) so the made cards get surfaced to review.
    const fcTask = await createTask(store, { type: "flashcard", title: "Review", cadence: 30 }, d1);
    const fc = await getFlashcardQueue(store, fcTask, d1, LA);
    const cardIds = fc.queue.map((c) => c.id);
    expect(cardIds.length).toBe(2);
    for (const id of cardIds) {
      const next = await gradeCard(store, id, "good", d1, LA);
      expect(next.due).toBeGreaterThan(d1); // rescheduled into the future
    }

    // Reviewed cards are no longer due same-day.
    const after = await getFlashcardQueue(store, fcTask, d1, LA);
    expect(after.queue.length).toBe(0);
  });
});

describe("addCardFromTask (make cards after watching)", () => {
  it("lands cards in a per-task deck and satisfies the make-cards gate", async () => {
    const store = new MemoryStore();
    const now = day("2026-06-15T10:00");
    const task = await createTask(
      store,
      { type: "youtube", title: "Lecture", sourceRef: "https://youtu.be/x", makesCardsCount: 2 },
      now,
    );

    // Watched, gate still open.
    let completion = await completeTask(store, task, { type: "youtube", manual: true }, now, LA);
    expect(completion.verified).toBe(false);

    // Author two cards straight from the task — no deck setup needed.
    await addCardFromTask(store, task, "q1", "a1", now);
    await addCardFromTask(store, task, "q2", "a2", now);

    expect(await store.countCardsBySourceTask(task.id)).toBe(2);
    const deck = await findOrCreateDeck(store, "From: Lecture", now);
    const snap = await store.exportAll();
    expect(snap.cards.every((c) => c.deck_id === deck.id && c.source_task_id === task.id)).toBe(true);

    // Now completing verifies.
    completion = await completeTask(store, task, { type: "youtube", manual: true }, now, LA);
    expect(completion.verified).toBe(true);
  });
});

describe("streak across days", () => {
  it("counts consecutive days with a verified completion", async () => {
    const store = new MemoryStore();
    const task = await createTask(store, { type: "flashcard", title: "Review", cadence: 1 }, day("2026-06-13T09:00"));
    for (const d of ["2026-06-13T09:00", "2026-06-14T09:00", "2026-06-15T09:00"]) {
      await completeTask(store, task, { type: "flashcard", n: 1 }, day(d), LA);
    }
    const view = await getTodayView(store, day("2026-06-15T12:00"), LA);
    expect(view.streak).toBe(3);
  });
});

describe("updateTask (edit task parameters)", () => {
  it("edits a flashcard task's deck and cadence", async () => {
    const store = new MemoryStore();
    const now = day("2026-06-15T12:00");
    const deck = await createDeck(store, "Spanish", now);
    const task = await createTask(store, { type: "flashcard", title: "Review", cadence: 10 }, now);

    await updateTask(store, task.id, { sourceRef: deck.id, cadence: 25 });

    const updated = await store.getTask(task.id);
    expect(updated?.source_ref).toBe(deck.id);
    expect(updated?.cadence).toBe(25);
  });

  it("changing a youtube task's URL clears its cached playlist state", async () => {
    const store = new MemoryStore();
    const now = day("2026-06-15T12:00");
    const task = await createTask(
      store,
      { type: "youtube", title: "Playlist", sourceRef: "https://youtube.com/playlist?list=AAA" },
      now,
    );
    await store.updateTaskMeta(task.id, JSON.stringify({ playlistId: "AAA" }));

    await updateTask(store, task.id, { sourceRef: "https://youtube.com/playlist?list=BBB" });

    const updated = await store.getTask(task.id);
    expect(updated?.source_ref).toBe("https://youtube.com/playlist?list=BBB");
    expect(updated?.meta).toBeNull(); // stale playlist cache cleared
  });

  it("leaves unspecified fields untouched", async () => {
    const store = new MemoryStore();
    const now = day("2026-06-15T12:00");
    const task = await createTask(store, { type: "flashcard", title: "Keep", cadence: 7 }, now);
    await updateTask(store, task.id, { cadence: 12 });
    const updated = await store.getTask(task.id);
    expect(updated?.title).toBe("Keep");
    expect(updated?.cadence).toBe(12);
  });
});

describe("backup round-trip + anki import (Store-backed)", () => {
  it("export then restore reproduces the dataset", async () => {
    const store = new MemoryStore();
    const now = day("2026-06-15T12:00");
    await seedStarterDeck(store, now);
    const blob = await exportBackup(store, now);

    const fresh = new MemoryStore();
    await restoreBackup(fresh, blob);
    expect(await fresh.exportAll()).toEqual(await store.exportAll());
  });

  it("imports an .apkg as a fresh deck of due cards", async () => {
    const store = new MemoryStore();
    const reader: AnkiNoteReader = {
      readNotes: async () => [
        { fields: ["<b>Hola</b>", "Hello"] },
        { fields: ["Adios", "Goodbye"] },
      ],
    };
    const now = day("2026-06-15T12:00");
    const res = await importAnki(store, reader, { deckName: "Spanish", now });
    expect(res).toMatchObject({ cardsImported: 2, skipped: 0 });

    // A flashcard task (all decks) surfaces the imported cards for review.
    const task = await createTask(store, { type: "flashcard", title: "Review", cadence: 30 }, now);
    const fc = await getFlashcardQueue(store, task, now, LA);
    expect(fc.queue.length).toBe(2);
    expect(fc.queue.map((c) => c.front)).toContain("Hola"); // HTML stripped
  });
});
