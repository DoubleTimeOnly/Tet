import { siblingKey, burySiblings } from "./siblings";
import { makeCard } from "./testFixtures";

describe("siblingKey", () => {
  it("groups by note_id when cards belong to a note", () => {
    const a = makeCard({ id: "a", note_id: "n1", front: "x", back: "1" });
    const b = makeCard({ id: "b", note_id: "n1", front: "y", back: "2" });
    const c = makeCard({ id: "c", note_id: "n2", front: "z", back: "3" });
    expect(siblingKey(a)).toBe(siblingKey(b));
    expect(siblingKey(a)).not.toBe(siblingKey(c));
  });

  it("groups the clozes of one line (==a== not ==b==)", () => {
    // buildCloze output for "==a== not ==b==":
    const c0 = makeCard({ id: "c0", front: "[...] not b", back: "a" });
    const c1 = makeCard({ id: "c1", front: "a not [...]", back: "b" });
    expect(siblingKey(c0)).toBe(siblingKey(c1));
  });

  it("groups the two directions of a reversed pair", () => {
    const fwd = makeCard({ id: "f", front: "perro", back: "dog" });
    const rev = makeCard({ id: "r", front: "dog", back: "perro" });
    expect(siblingKey(fwd)).toBe(siblingKey(rev));
  });

  it("keeps unrelated cards in distinct groups", () => {
    const a = makeCard({ id: "a", front: "perro", back: "dog" });
    const b = makeCard({ id: "b", front: "gato", back: "cat" });
    expect(siblingKey(a)).not.toBe(siblingKey(b));
  });

  it("scopes by deck so identical text in different decks isn't merged", () => {
    const a = makeCard({ id: "a", deck_id: "d1", front: "perro", back: "dog" });
    const b = makeCard({ id: "b", deck_id: "d2", front: "perro", back: "dog" });
    expect(siblingKey(a)).not.toBe(siblingKey(b));
  });

  it("splices the answer literally, not as a replacement pattern", () => {
    const c = makeCard({ id: "c", front: "price is [...] today", back: "$5" });
    expect(siblingKey(c)).toBe("cloze:deck-1:price is $5 today");
  });
});

describe("burySiblings", () => {
  it("keeps the first of a group and defers the rest, preserving order", () => {
    const cards = [
      makeCard({ id: "c0", front: "[...] not b", back: "a" }),
      makeCard({ id: "c1", front: "a not [...]", back: "b" }),
      makeCard({ id: "solo", front: "gato", back: "cat" }),
    ];
    const { kept, deferred } = burySiblings(cards);
    expect(kept.map((c) => c.id)).toEqual(["c0", "solo"]);
    expect(deferred.map((c) => c.id)).toEqual(["c1"]);
  });

  it("no siblings -> nothing deferred", () => {
    const cards = [
      makeCard({ id: "a", front: "perro", back: "dog" }),
      makeCard({ id: "b", front: "gato", back: "cat" }),
    ];
    const { kept, deferred } = burySiblings(cards);
    expect(kept).toHaveLength(2);
    expect(deferred).toEqual([]);
  });
});
