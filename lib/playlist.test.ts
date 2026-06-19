import {
  emptyPlaylistState,
  needsRefresh,
  pickForDay,
  markWatched,
  pickedVideo,
  type PlaylistState,
} from "./playlist";

const items = [
  { id: "v1", title: "One" },
  { id: "v2", title: "Two" },
  { id: "v3", title: "Three" },
];

function state(over: Partial<PlaylistState> = {}): PlaylistState {
  return { ...emptyPlaylistState("PL1"), items, fetchedDay: "2026-06-19", ...over };
}

describe("needsRefresh", () => {
  it("refreshes when empty, stale, or never fetched", () => {
    expect(needsRefresh(null, "2026-06-19")).toBe(true);
    expect(needsRefresh(state({ items: [] }), "2026-06-19")).toBe(true);
    expect(needsRefresh(state({ fetchedDay: "2026-06-18" }), "2026-06-19")).toBe(true);
  });
  it("does not refresh when fetched today with items", () => {
    expect(needsRefresh(state(), "2026-06-19")).toBe(false);
  });
});

describe("pickForDay", () => {
  it("samples an unwatched video for the day", () => {
    const next = pickForDay(state(), "2026-06-19", () => 0); // first of pool
    expect(next.pick).toEqual({ id: "v1", day: "2026-06-19" });
  });

  it("keeps an existing valid pick for the same day (same reference)", () => {
    const s = state({ pick: { id: "v2", day: "2026-06-19" } });
    expect(pickForDay(s, "2026-06-19", () => 0)).toBe(s);
  });

  it("re-picks when the day rolls over", () => {
    const s = state({ pick: { id: "v2", day: "2026-06-18" } });
    const next = pickForDay(s, "2026-06-19", () => 0);
    expect(next.pick).toEqual({ id: "v1", day: "2026-06-19" });
  });

  it("skips watched videos, and yields no pick once all are watched", () => {
    const s = state({ watchedIds: ["v1", "v2"] });
    // only v3 unwatched -> picked regardless of rng
    expect(pickForDay(s, "2026-06-19", () => 0).pick?.id).toBe("v3");

    const allSeen = state({ watchedIds: ["v1", "v2", "v3"] });
    // never replays a watched video -> no pick
    expect(pickForDay(allSeen, "2026-06-19", () => 0).pick).toBeNull();
  });

  it("replaces a pick that points at an already-watched video", () => {
    const s = state({ watchedIds: ["v2"], pick: { id: "v2", day: "2026-06-19" } });
    const next = pickForDay(s, "2026-06-19", () => 0);
    expect(next.pick?.id).not.toBe("v2");
    expect(["v1", "v3"]).toContain(next.pick?.id);
  });

  it("yields no pick for an empty playlist", () => {
    const empty = state({ items: [] });
    expect(pickForDay(empty, "2026-06-19").pick).toBeNull();
  });
});

describe("markWatched", () => {
  it("records the video and clears the pick", () => {
    const s = state({ pick: { id: "v1", day: "2026-06-19" } });
    const next = markWatched(s, "v1");
    expect(next.watchedIds).toContain("v1");
    expect(next.pick).toBeNull();
  });
  it("does not duplicate an already-watched id", () => {
    const next = markWatched(state({ watchedIds: ["v1"] }), "v1");
    expect(next.watchedIds).toEqual(["v1"]);
  });
});

describe("pickedVideo", () => {
  it("resolves the current pick to its full record", () => {
    expect(pickedVideo(state({ pick: { id: "v2", day: "2026-06-19" } }))).toEqual({
      id: "v2",
      title: "Two",
    });
  });
  it("returns null with no pick", () => {
    expect(pickedVideo(state())).toBeNull();
  });
});
