import {
  generateCards,
  reconcileNoteCards,
  reconstructClozeText,
  countClozeSpans,
} from "./notes";
import { makeCard } from "./testFixtures";
import type { Note } from "../db/schema";

function makeNote(over: Partial<Note> = {}): Note {
  return {
    id: "n1",
    deck_id: "deck-1",
    kind: "basic",
    fields: JSON.stringify({ front: "f", back: "b" }),
    source_task_id: null,
    created_at: 0,
    ...over,
  };
}

describe("generateCards", () => {
  it("basic -> one card", () => {
    expect(generateCards(makeNote())).toEqual([{ template: 0, front: "f", back: "b" }]);
  });

  it("reversed -> both directions", () => {
    const note = makeNote({ kind: "reversed", fields: JSON.stringify({ front: "perro", back: "dog" }) });
    expect(generateCards(note)).toEqual([
      { template: 0, front: "perro", back: "dog" },
      { template: 1, front: "dog", back: "perro" },
    ]);
  });

  it("cloze -> one card per span, blanking each in turn", () => {
    const note = makeNote({ kind: "cloze", fields: JSON.stringify({ text: "==a== not ==b==" }) });
    expect(generateCards(note)).toEqual([
      { template: 0, front: "[...] not b", back: "a" },
      { template: 1, front: "a not [...]", back: "b" },
    ]);
  });
});

describe("countClozeSpans", () => {
  it("counts ==spans==", () => {
    expect(countClozeSpans("the ==x== and ==y==")).toBe(2);
    expect(countClozeSpans("no spans")).toBe(0);
  });
});

describe("reconcileNoteCards", () => {
  it("updates a surviving cloze in place (keeps id -> keeps schedule)", () => {
    const note = makeNote({
      id: "n1",
      kind: "cloze",
      fields: JSON.stringify({ text: "==a== really not ==b==" }),
    });
    const existing = [
      makeCard({ id: "c0", note_id: "n1", template: 0, front: "[...] not b", back: "a" }),
      makeCard({ id: "c1", note_id: "n1", template: 1, front: "a not [...]", back: "b" }),
    ];
    const { updated, inserted, removed } = reconcileNoteCards(note, existing);
    expect(removed).toEqual([]);
    expect(inserted).toEqual([]);
    // matched by span text (back), so both ids survive with refreshed fronts
    expect(updated).toEqual([
      { id: "c0", template: 0, front: "[...] really not b", back: "a" },
      { id: "c1", template: 1, front: "a really not [...]", back: "b" },
    ]);
  });

  it("inserts a new cloze and keeps the existing one's schedule", () => {
    const note = makeNote({
      id: "n1",
      kind: "cloze",
      fields: JSON.stringify({ text: "==a== not ==b== or ==c==" }),
    });
    const existing = [
      makeCard({ id: "c0", note_id: "n1", template: 0, front: "[...] not b", back: "a" }),
      makeCard({ id: "c1", note_id: "n1", template: 1, front: "a not [...]", back: "b" }),
    ];
    const { updated, inserted, removed } = reconcileNoteCards(note, existing);
    expect(updated.map((u) => u.id)).toEqual(["c0", "c1"]);
    expect(removed).toEqual([]);
    expect(inserted).toEqual([{ template: 2, front: "a not b or [...]", back: "c" }]);
  });

  it("removes a card whose span was deleted", () => {
    const note = makeNote({ id: "n1", kind: "cloze", fields: JSON.stringify({ text: "==a== only" }) });
    const existing = [
      makeCard({ id: "c0", note_id: "n1", template: 0, front: "[...] only", back: "a" }),
      makeCard({ id: "c1", note_id: "n1", template: 1, front: "a [...]", back: "only" }),
    ];
    const { updated, removed } = reconcileNoteCards(note, existing);
    expect(updated.map((u) => u.id)).toEqual(["c0"]);
    expect(removed).toEqual(["c1"]);
  });

  it("reversed matches by template role", () => {
    const note = makeNote({ id: "n1", kind: "reversed", fields: JSON.stringify({ front: "perro!", back: "dog" }) });
    const existing = [
      makeCard({ id: "c0", note_id: "n1", template: 0, front: "perro", back: "dog" }),
      makeCard({ id: "c1", note_id: "n1", template: 1, front: "dog", back: "perro" }),
    ];
    const { updated, inserted, removed } = reconcileNoteCards(note, existing);
    expect(inserted).toEqual([]);
    expect(removed).toEqual([]);
    expect(updated).toEqual([
      { id: "c0", template: 0, front: "perro!", back: "dog" },
      { id: "c1", template: 1, front: "dog", back: "perro!" },
    ]);
  });
});

describe("reconstructClozeText (inverse of buildCloze)", () => {
  it("rebuilds ==spans== from generated cloze cards", () => {
    const cards = generateCards(
      makeNote({ kind: "cloze", fields: JSON.stringify({ text: "==a== not ==b==" }) }),
    );
    expect(reconstructClozeText(cards)).toBe("==a== not ==b==");
  });

  it("returns null when a card has no blank to invert", () => {
    expect(reconstructClozeText([{ front: "no blank here", back: "x" }])).toBeNull();
  });
});
