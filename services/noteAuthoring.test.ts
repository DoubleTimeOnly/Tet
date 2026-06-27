import { MemoryStore } from "../db/memoryStore";
import { addNote, updateNote, createDeck } from "./authoring";
import { gradeCard } from "./learning";
import { makeFields } from "../lib/notes";
import { burySiblings } from "../lib/siblings";

/**
 * End-to-end (against MemoryStore): a cloze note generates sibling cards, an
 * edit to its shared text propagates to every sibling without disturbing their
 * schedules, and the siblings stay buried together.
 */
async function freshDeck() {
  const store = new MemoryStore();
  await store.init();
  const deck = await createDeck(store, "Deck", 0);
  return { store, deck };
}

describe("cloze note authoring + edit propagation", () => {
  it("generates one card per span sharing a note_id", async () => {
    const { store, deck } = await freshDeck();
    const { note, cards } = await addNote(store, {
      deckId: deck.id,
      kind: "cloze",
      fields: makeFields("cloze", { text: "==a== not ==b==" }),
    });
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.front)).toEqual(["[...] not b", "a not [...]"]);
    expect(cards.every((c) => c.note_id === note.id)).toBe(true);

    // siblings bury together: only the first surfaces, the other defers.
    const { kept, deferred } = burySiblings(await store.listDueCards(Date.now()));
    expect(kept).toHaveLength(1);
    expect(deferred).toHaveLength(1);
  });

  it("propagates a shared-text edit to all siblings, preserving schedules", async () => {
    const { store, deck } = await freshDeck();
    const { note } = await addNote(store, {
      deckId: deck.id,
      kind: "cloze",
      fields: makeFields("cloze", { text: "==a== not ==b==" }),
    });

    // Review one sibling so it carries a distinct, non-new schedule.
    const before = await store.listCardsByNote(note.id);
    const graded = await gradeCard(store, before[0]!.id, "good", 1000);

    // Edit the note's shared sentence; both siblings should re-render.
    await updateNote(store, note.id, makeFields("cloze", { text: "==a== really not ==b==" }), 2000);

    const after = await store.listCardsByNote(note.id);
    expect(after).toHaveLength(2);
    expect(after.map((c) => c.front).sort()).toEqual(
      ["[...] really not b", "a really not [...]"].sort(),
    );
    // The graded card kept its id and its advanced schedule (not reset to new).
    const stillGraded = after.find((c) => c.id === graded.id)!;
    expect(stillGraded.fsrs_state).toBe(graded.fsrs_state);
    expect(stillGraded.state_label).not.toBe("new");
  });

  it("adds a card when a new blank is introduced", async () => {
    const { store, deck } = await freshDeck();
    const { note } = await addNote(store, {
      deckId: deck.id,
      kind: "cloze",
      fields: makeFields("cloze", { text: "==a== not ==b==" }),
    });
    await updateNote(store, note.id, makeFields("cloze", { text: "==a== not ==b== or ==c==" }), 2000);
    const after = await store.listCardsByNote(note.id);
    expect(after).toHaveLength(3);
    expect(after.some((c) => c.back === "c")).toBe(true);
  });
});

describe("reversed note authoring", () => {
  it("creates both directions under one note", async () => {
    const { store, deck } = await freshDeck();
    const { cards } = await addNote(store, {
      deckId: deck.id,
      kind: "reversed",
      fields: makeFields("reversed", { front: "perro", back: "dog" }),
    });
    expect(cards.map((c) => [c.front, c.back])).toEqual([
      ["perro", "dog"],
      ["dog", "perro"],
    ]);
  });
});
