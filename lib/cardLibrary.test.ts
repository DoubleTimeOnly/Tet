import {
  cardCategory,
  categoryCounts,
  sourceGroups,
  matchesQuery,
  buildTaskMap,
} from "./cardLibrary";
import { makeCard, makeTask } from "./testFixtures";

const tasks = [
  makeTask({ id: "yt1", type: "youtube", title: "Video A" }),
  makeTask({ id: "yt2", type: "youtube", title: "Video B" }),
  makeTask({ id: "rd1", type: "reading", title: "Doc One" }),
  makeTask({ id: "fc1", type: "flashcard", title: "Daily review" }),
];
const taskById = buildTaskMap(tasks);

describe("cardCategory", () => {
  it("buckets a source-less card as obsidian", () => {
    expect(cardCategory(makeCard({ source_task_id: null }), taskById)).toBe("obsidian");
  });
  it("buckets a youtube-sourced card as youtube", () => {
    expect(cardCategory(makeCard({ source_task_id: "yt1" }), taskById)).toBe("youtube");
  });
  it("buckets a reading-sourced card as readwise", () => {
    expect(cardCategory(makeCard({ source_task_id: "rd1" }), taskById)).toBe("readwise");
  });
  it("falls back to obsidian for a missing or flashcard source task", () => {
    expect(cardCategory(makeCard({ source_task_id: "gone" }), taskById)).toBe("obsidian");
    expect(cardCategory(makeCard({ source_task_id: "fc1" }), taskById)).toBe("obsidian");
  });
});

describe("categoryCounts", () => {
  it("tallies each bucket", () => {
    const cards = [
      makeCard({ id: "a", source_task_id: null }),
      makeCard({ id: "b", source_task_id: "yt1" }),
      makeCard({ id: "c", source_task_id: "yt2" }),
      makeCard({ id: "d", source_task_id: "rd1" }),
    ];
    expect(categoryCounts(cards, taskById)).toEqual({ obsidian: 1, youtube: 2, readwise: 1 });
  });
});

describe("sourceGroups", () => {
  it("groups youtube cards by source video, sorted by title", () => {
    const cards = [
      makeCard({ id: "a", source_task_id: "yt2" }),
      makeCard({ id: "b", source_task_id: "yt1" }),
      makeCard({ id: "c", source_task_id: "yt1" }),
    ];
    expect(sourceGroups(cards, taskById, "youtube")).toEqual([
      { taskId: "yt1", title: "Video A", count: 2 },
      { taskId: "yt2", title: "Video B", count: 1 },
    ]);
  });
  it("groups readwise cards into per-document sub-decks", () => {
    const cards = [makeCard({ id: "a", source_task_id: "rd1" })];
    expect(sourceGroups(cards, taskById, "readwise")).toEqual([
      { taskId: "rd1", title: "Doc One", count: 1 },
    ]);
  });
});

describe("matchesQuery", () => {
  const card = makeCard({ front: "What is a Qubit?", back: "Quantum bit" });
  it("matches front or back, case-insensitively", () => {
    expect(matchesQuery(card, "qubit")).toBe(true);
    expect(matchesQuery(card, "quantum")).toBe(true);
    expect(matchesQuery(card, "xyz")).toBe(false);
  });
  it("matches everything on an empty query", () => {
    expect(matchesQuery(card, "  ")).toBe(true);
  });
});
