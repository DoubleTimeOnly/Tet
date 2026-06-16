import { MemoryStore } from "../db/memoryStore";
import { getTodayView, gradeCard, completeTask } from "./learning";
import { seedStarterDeck, createTask, addCard, createDeck, addCardFromTask, findOrCreateDeck } from "./authoring";
import { exportBackup, restoreBackup, importAnki } from "./backupService";
import { DateTime } from "luxon";
import type { AnkiNoteReader } from "../lib/ankiImport";

const LA = "America/Los_Angeles";
const day = (iso: string) => DateTime.fromISO(iso, { zone: LA }).toMillis();

describe("getTodayView (against MemoryStore)", () => {
  it("cold start before seeding is empty", async () => {
    const store = new MemoryStore();
    const view = await getTodayView(store, day("2026-06-15T12:00"), LA);
    expect(view.slice.tasks).toEqual([]);
    expect(view.slice.reviewCards).toEqual([]);
    expect(view.streak).toBe(0);
  });

  it("after seeding: surfaces the flashcard task and the seeded due cards", async () => {
    const store = new MemoryStore();
    const now = day("2026-06-15T12:00");
    await seedStarterDeck(store, now);
    const view = await getTodayView(store, now, LA);
    expect(view.slice.tasks.map((t) => t.task.title)).toEqual(["Review flashcards"]);
    expect(view.slice.reviewCards.length).toBe(3); // fresh cards due immediately
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

    // The two new cards are due; grade them, which advances FSRS + logs reviews.
    const view = await getTodayView(store, d1, LA);
    const cardIds = view.slice.reviewCards.map((c) => c.id);
    expect(cardIds.length).toBe(2);
    for (const id of cardIds) {
      const next = await gradeCard(store, id, "good", d1);
      expect(next.due).toBeGreaterThan(d1); // rescheduled into the future
    }

    // Reviewed cards are no longer due same-day.
    const after = await getTodayView(store, d1, LA);
    expect(after.slice.reviewCards.length).toBe(0);
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
    const res = await importAnki(store, reader, { deckName: "Spanish", now: day("2026-06-15T12:00") });
    expect(res).toMatchObject({ cardsImported: 2, skipped: 0 });

    const view = await getTodayView(store, day("2026-06-15T12:00"), LA);
    expect(view.slice.reviewCards.length).toBe(2);
    expect(view.slice.reviewCards.map((c) => c.front)).toContain("Hola"); // HTML stripped
  });
});
