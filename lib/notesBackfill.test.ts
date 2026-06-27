import { backfillNotes } from "./notesBackfill";
import { makeCard } from "./testFixtures";

function seqIds(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

describe("backfillNotes", () => {
  it("reconstructs a cloze note and stamps its cards by span order", () => {
    const cards = [
      makeCard({ id: "c0", deck_id: "d1", front: "[...] not b", back: "a", fsrs_state: '{"reps":3}' }),
      makeCard({ id: "c1", deck_id: "d1", front: "a not [...]", back: "b" }),
    ];
    const { notes, cards: out } = backfillNotes(cards, seqIds("n"));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.kind).toBe("cloze");
    expect(JSON.parse(notes[0]!.fields)).toEqual({ text: "==a== not ==b==" });
    expect(out.map((c) => [c.note_id, c.template])).toEqual([
      ["n-0", 0],
      ["n-0", 1],
    ]);
    // schedules untouched
    expect(out[0]!.fsrs_state).toBe('{"reps":3}');
  });

  it("makes a reversed note from a swapped pair", () => {
    const cards = [
      makeCard({ id: "f", deck_id: "d1", front: "perro", back: "dog" }),
      makeCard({ id: "r", deck_id: "d1", front: "dog", back: "perro" }),
    ];
    const { notes, cards: out } = backfillNotes(cards, seqIds("n"));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.kind).toBe("reversed");
    expect(JSON.parse(notes[0]!.fields)).toEqual({ front: "perro", back: "dog" });
    expect(out.every((c) => c.note_id === "n-0")).toBe(true);
  });

  it("leaves a basic singleton note-less", () => {
    const cards = [makeCard({ id: "s", deck_id: "d1", front: "gato", back: "cat" })];
    const { notes, cards: out } = backfillNotes(cards, seqIds("n"));
    expect(notes).toEqual([]);
    expect(out[0]!.note_id).toBeNull();
  });

  it("is idempotent — cards that already have a note_id are untouched", () => {
    const cards = [makeCard({ id: "c", deck_id: "d1", note_id: "existing", front: "[...] x", back: "a" })];
    const { notes, cards: out } = backfillNotes(cards, seqIds("n"));
    expect(notes).toEqual([]);
    expect(out[0]!.note_id).toBe("existing");
  });
});
