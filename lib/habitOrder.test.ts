import { moveItem, isAtEdge } from "./habitOrder";

describe("moveItem", () => {
  const list = ["a", "b", "c", "d"];

  it("moves an entry up one place", () => {
    expect(moveItem(list, 2, -1)).toEqual(["a", "c", "b", "d"]);
  });

  it("moves an entry down one place", () => {
    expect(moveItem(list, 1, 1)).toEqual(["a", "c", "b", "d"]);
  });

  it("leaves the list alone at the top", () => {
    expect(moveItem(list, 0, -1)).toEqual(list);
  });

  it("leaves the list alone at the bottom", () => {
    expect(moveItem(list, 3, 1)).toEqual(list);
  });

  it("ignores an index that isn't in the list", () => {
    expect(moveItem(list, 9, -1)).toEqual(list);
    expect(moveItem(list, -1, 1)).toEqual(list);
  });

  it("does not mutate the input", () => {
    const original = [...list];
    moveItem(list, 1, 1);
    expect(list).toEqual(original);
  });

  it("handles a single-entry list", () => {
    expect(moveItem(["only"], 0, -1)).toEqual(["only"]);
    expect(moveItem(["only"], 0, 1)).toEqual(["only"]);
  });

  it("round-trips: up then down returns the original order", () => {
    expect(moveItem(moveItem(list, 2, -1), 1, 1)).toEqual(list);
  });
});

describe("isAtEdge", () => {
  it("is true only at the ends", () => {
    expect(isAtEdge(0, 3, -1)).toBe(true);
    expect(isAtEdge(1, 3, -1)).toBe(false);
    expect(isAtEdge(2, 3, 1)).toBe(true);
    expect(isAtEdge(1, 3, 1)).toBe(false);
  });

  it("treats the only entry as stuck in both directions", () => {
    expect(isAtEdge(0, 1, -1)).toBe(true);
    expect(isAtEdge(0, 1, 1)).toBe(true);
  });
});
