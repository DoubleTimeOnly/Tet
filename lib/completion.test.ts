import { recordCompletion, ownConditionMet } from "./completion";
import { makeTask } from "./testFixtures";
import { DateTime } from "luxon";

const LA = "America/Los_Angeles";
const noonJun15 = DateTime.fromISO("2026-06-15T12:00", { zone: LA }).toMillis();
const lateNight = DateTime.fromISO("2026-06-16T02:30", { zone: LA }).toMillis();

describe("recordCompletion — day keying", () => {
  it("keys the completion date via localDayKey (2:30am -> prior day)", () => {
    const c = recordCompletion({
      task: makeTask({ type: "flashcard", cadence: 1 }),
      evidence: { type: "flashcard", n: 1 },
      now: lateNight,
      tz: LA,
      id: "fixed",
    });
    expect(c.date).toBe("2026-06-15");
    expect(c.completed_at).toBe(lateNight);
  });

  it("falls back to a generated id when none supplied", () => {
    const c = recordCompletion({
      task: makeTask(),
      evidence: { type: "flashcard", n: 1 },
      now: noonJun15,
      tz: LA,
    });
    expect(c.id).toBeTruthy();
  });
});

describe("ownConditionMet by task type", () => {
  it("flashcard verified once n >= cadence", () => {
    const t = makeTask({ type: "flashcard", cadence: 10 });
    expect(ownConditionMet(t, { type: "flashcard", n: 9 })).toBe(false);
    expect(ownConditionMet(t, { type: "flashcard", n: 10 })).toBe(true);
  });

  it("youtube verified on manual Done (hybrid verification)", () => {
    const t = makeTask({ type: "youtube" });
    expect(ownConditionMet(t, { type: "youtube", manual: true })).toBe(true);
  });

  it("reading uses the default 0.9 target when task has no override", () => {
    const t = makeTask({ type: "reading", reading_target: null });
    expect(ownConditionMet(t, { type: "reading", readwise_fraction: 0.89 })).toBe(false);
    expect(ownConditionMet(t, { type: "reading", readwise_fraction: 0.9 })).toBe(true);
  });

  it("reading respects a per-task target override", () => {
    const t = makeTask({ type: "reading", reading_target: 0.5 });
    expect(ownConditionMet(t, { type: "reading", readwise_fraction: 0.5 })).toBe(true);
  });
});

describe("recordCompletion — makes_cards_count gate", () => {
  it("youtube watched but no cards yet -> own cond met, not verified", () => {
    const c = recordCompletion({
      task: makeTask({ type: "youtube", makes_cards_count: 2 }),
      evidence: { type: "youtube", manual: true },
      now: noonJun15,
      tz: LA,
      cardsMade: 1,
    });
    expect(c.verified).toBe(false);
  });

  it("youtube watched AND enough cards -> verified", () => {
    const c = recordCompletion({
      task: makeTask({ type: "youtube", makes_cards_count: 2 }),
      evidence: { type: "youtube", manual: true },
      now: noonJun15,
      tz: LA,
      cardsMade: 2,
    });
    expect(c.verified).toBe(true);
  });

  it("cards made but own condition unmet -> not verified", () => {
    const c = recordCompletion({
      task: makeTask({ type: "reading", makes_cards_count: 1, reading_target: 0.9 }),
      evidence: { type: "reading", readwise_fraction: 0.3 },
      now: noonJun15,
      tz: LA,
      cardsMade: 5,
    });
    expect(c.verified).toBe(false);
  });

  it("no card gate (count 0) -> verified on own condition alone", () => {
    const c = recordCompletion({
      task: makeTask({ type: "flashcard", cadence: 1, makes_cards_count: 0 }),
      evidence: { type: "flashcard", n: 1 },
      now: noonJun15,
      tz: LA,
    });
    expect(c.verified).toBe(true);
  });
});
