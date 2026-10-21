import { moveItem, isAtEdge, partitionByDone, moveWithinGroup } from "./habitOrder";

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

describe("partitionByDone", () => {
  it("puts undone first, done last, keeping order within each", () => {
    const done = new Set(["a", "c"]);
    expect(partitionByDone(["a", "b", "c", "d"], (x) => done.has(x))).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
  });

  it("leaves an all-undone or all-done list alone", () => {
    expect(partitionByDone(["a", "b"], () => false)).toEqual(["a", "b"]);
    expect(partitionByDone(["a", "b"], () => true)).toEqual(["a", "b"]);
  });
});

describe("moveWithinGroup", () => {
  // Full order a b c d e; on screen the undone group is b, d, e.
  const order = ["a", "b", "c", "d", "e"];
  const undone = ["b", "d", "e"];

  it("moves up past its on-screen neighbour, skipping the other group", () => {
    expect(moveWithinGroup(order, undone, "d", -1)).toEqual(["a", "d", "b", "c", "e"]);
  });

  it("moves down past its on-screen neighbour", () => {
    expect(moveWithinGroup(order, undone, "b", 1)).toEqual(["a", "c", "d", "b", "e"]);
  });

  it("keeps the displayed group order consistent with the arrow", () => {
    const next = moveWithinGroup(order, undone, "e", -1);
    expect(next.filter((x) => undone.includes(x))).toEqual(["b", "e", "d"]);
  });

  it("returns the same list at the group's edges or for unknown ids", () => {
    expect(moveWithinGroup(order, undone, "b", -1)).toBe(order);
    expect(moveWithinGroup(order, undone, "e", 1)).toBe(order);
    expect(moveWithinGroup(order, undone, "z", 1)).toBe(order);
  });
});
