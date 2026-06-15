import { currentStreak } from "./streak";
import { makeCompletion } from "./testFixtures";
import { DateTime } from "luxon";

const LA = "America/Los_Angeles";
const now = DateTime.fromISO("2026-06-15T12:00", { zone: LA }).toMillis();

/** Verified completions on the given day keys. */
function days(...dayKeys: string[]) {
  return dayKeys.map((d, i) =>
    makeCompletion({ id: `c${i}`, date: d, verified: true }),
  );
}

describe("currentStreak", () => {
  it("no completions -> 0", () => {
    expect(currentStreak({ completions: [], now, tz: LA })).toBe(0);
  });

  it("counts consecutive verified days ending today", () => {
    const completions = days("2026-06-13", "2026-06-14", "2026-06-15");
    expect(currentStreak({ completions, now, tz: LA })).toBe(3);
  });

  it("grace: today not done yet but yesterday was -> streak survives", () => {
    const completions = days("2026-06-13", "2026-06-14");
    expect(currentStreak({ completions, now, tz: LA })).toBe(2);
  });

  it("a gap breaks the streak (fixed-cadence miss breaks at 4am)", () => {
    // missed 2026-06-14 entirely; only today + an older island.
    const completions = days("2026-06-12", "2026-06-15");
    expect(currentStreak({ completions, now, tz: LA })).toBe(1);
  });

  it("two days idle (today and yesterday empty) -> 0", () => {
    const completions = days("2026-06-12", "2026-06-13");
    expect(currentStreak({ completions, now, tz: LA })).toBe(0);
  });

  it("unverified completions don't count toward the streak", () => {
    const completions = [
      makeCompletion({ id: "a", date: "2026-06-15", verified: false }),
      makeCompletion({ id: "b", date: "2026-06-14", verified: false }),
    ];
    expect(currentStreak({ completions, now, tz: LA })).toBe(0);
  });

  it("any one verified task per day keeps the streak (FSRS carryover = no extra obligation)", () => {
    // Only flashcard reviews each day; due-card backlog is irrelevant here.
    const completions = days("2026-06-14", "2026-06-15");
    expect(currentStreak({ completions, now, tz: LA })).toBe(2);
  });

  it("multiple completions on the same day count once", () => {
    const completions = [
      makeCompletion({ id: "a", task_id: "t1", date: "2026-06-15", verified: true }),
      makeCompletion({ id: "b", task_id: "t2", date: "2026-06-15", verified: true }),
      ...days("2026-06-14"),
    ];
    expect(currentStreak({ completions, now, tz: LA })).toBe(2);
  });

  it("respects the bounded window", () => {
    // 5 consecutive days ending today, but window only looks back 3.
    const completions = days(
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
      "2026-06-15",
    );
    expect(currentStreak({ completions, now, tz: LA, windowDays: 3 })).toBe(3);
  });
});
