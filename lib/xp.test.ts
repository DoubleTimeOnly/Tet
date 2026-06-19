import { barSize, levelForXp, totalXp, youtubeMinutes } from "./xp";
import { makeCompletion } from "./testFixtures";

describe("totalXp", () => {
  it("flashcards: 1 XP per review", () => {
    expect(totalXp({ reviews: 30, completions: [] })).toBe(30);
  });

  it("youtube: 1 XP per minute, summed across completions", () => {
    const completions = [
      makeCompletion({ id: "a", evidence: { type: "youtube", manual: true, minutes: 15 } }),
      makeCompletion({ id: "b", evidence: { type: "youtube", manual: true, minutes: 5 } }),
    ];
    expect(totalXp({ reviews: 0, completions })).toBe(20);
  });

  it("combines reviews and youtube minutes", () => {
    const completions = [
      makeCompletion({ id: "a", evidence: { type: "youtube", manual: true, minutes: 10 } }),
    ];
    expect(totalXp({ reviews: 30, completions })).toBe(40);
  });

  it("pre-feature youtube completions (no minutes) contribute 0", () => {
    const completions = [
      makeCompletion({ id: "a", evidence: { type: "youtube", manual: true } }),
    ];
    expect(youtubeMinutes(completions[0]!)).toBe(0);
    expect(totalXp({ reviews: 0, completions })).toBe(0);
  });

  it("flashcard and reading completions add no youtube minutes", () => {
    const completions = [
      makeCompletion({ id: "a", evidence: { type: "flashcard", n: 5 } }),
      makeCompletion({ id: "b", evidence: { type: "reading", readwise_fraction: 0.95 } }),
    ];
    expect(totalXp({ reviews: 0, completions })).toBe(0);
  });
});

describe("barSize", () => {
  it("100 XP for levels 1-9, 200 for 10-19, 300 for 20-29", () => {
    expect(barSize(1)).toBe(100);
    expect(barSize(9)).toBe(100);
    expect(barSize(10)).toBe(200);
    expect(barSize(19)).toBe(200);
    expect(barSize(20)).toBe(300);
  });
});

describe("levelForXp", () => {
  it("starts at level 1 with no XP", () => {
    expect(levelForXp(0)).toEqual({ level: 1, xpIntoLevel: 0, xpForLevel: 100, totalXp: 0 });
  });

  it("mid-bar progress within level 1", () => {
    expect(levelForXp(30)).toEqual({ level: 1, xpIntoLevel: 30, xpForLevel: 100, totalXp: 30 });
  });

  it("exactly one bar advances to level 2", () => {
    expect(levelForXp(100)).toEqual({ level: 2, xpIntoLevel: 0, xpForLevel: 100, totalXp: 100 });
  });

  it("levels 1-9 each cost 100, so 900 XP reaches level 10", () => {
    // 9 bars of 100 consumed = level 10, where the next bar jumps to 200.
    expect(levelForXp(900)).toEqual({ level: 10, xpIntoLevel: 0, xpForLevel: 200, totalXp: 900 });
  });

  it("carries leftover XP into the next bar", () => {
    // 900 (to reach lvl 10) + 250 = 1 full 200-bar (lvl 11) + 50 into lvl 11's 200-bar.
    expect(levelForXp(1150)).toEqual({ level: 11, xpIntoLevel: 50, xpForLevel: 200, totalXp: 1150 });
  });
});
