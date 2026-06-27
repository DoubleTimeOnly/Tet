import { localDayKey, previousDayKey, startOfTetDay, DAY_START_HOUR } from "./dayKey";
import { DateTime } from "luxon";

/** Build an epoch-ms instant from wall-clock components in a zone. */
function at(tz: string, iso: string): number {
  const dt = DateTime.fromISO(iso, { zone: tz });
  if (!dt.isValid) throw new Error(`bad fixture: ${iso} @ ${tz}`);
  return dt.toMillis();
}

const LA = "America/Los_Angeles";
const LON = "Europe/London";

describe("localDayKey — 4am boundary", () => {
  it("02:30 local counts as the previous day", () => {
    expect(localDayKey(at(LA, "2026-03-10T02:30"), LA)).toBe("2026-03-09");
  });

  it("04:00 local exactly is that day (boundary is inclusive of 4am)", () => {
    expect(localDayKey(at(LA, "2026-03-10T04:00"), LA)).toBe("2026-03-10");
  });

  it("03:59 local is still the previous day", () => {
    expect(localDayKey(at(LA, "2026-03-10T03:59"), LA)).toBe("2026-03-09");
  });

  it("midday local is that day", () => {
    expect(localDayKey(at(LA, "2026-03-10T12:00"), LA)).toBe("2026-03-10");
  });

  it("23:59 local is still that day (before next 4am)", () => {
    expect(localDayKey(at(LA, "2026-03-10T23:59"), LA)).toBe("2026-03-10");
  });
});

describe("localDayKey — DST transitions", () => {
  // US spring-forward 2026: 02:00 -> 03:00 on Mar 8. 01:30 (<4) is prev day.
  it("spring-forward morning before 4am is the previous day", () => {
    expect(localDayKey(at(LA, "2026-03-08T01:30"), LA)).toBe("2026-03-07");
  });

  it("spring-forward: 04:00 after the skip is that day", () => {
    expect(localDayKey(at(LA, "2026-03-08T04:00"), LA)).toBe("2026-03-08");
  });

  // US fall-back 2026: 02:00 -> 01:00 on Nov 1. The repeated 01:30 (<4) is
  // still the previous day on both passes.
  it("fall-back repeated hour before 4am stays the previous day", () => {
    expect(localDayKey(at(LA, "2026-11-01T01:30"), LA)).toBe("2026-10-31");
  });

  it("fall-back afternoon is that day", () => {
    expect(localDayKey(at(LA, "2026-11-01T12:00"), LA)).toBe("2026-11-01");
  });
});

describe("localDayKey — zone changes (same instant, different zone)", () => {
  it("an instant maps to different day keys in SFO vs LON", () => {
    // 2026-03-10 22:00 in LA == 2026-03-11 05:00 in London.
    const instant = at(LA, "2026-03-10T22:00");
    expect(localDayKey(instant, LA)).toBe("2026-03-10");
    expect(localDayKey(instant, LON)).toBe("2026-03-11");
  });

  it("traveler crossing SFO->LON: pre-4am London still prior day", () => {
    // 2026-03-10 19:30 LA == 2026-03-11 02:30 London (before 4am) -> Mar 10.
    const instant = at(LA, "2026-03-10T19:30");
    expect(localDayKey(instant, LON)).toBe("2026-03-10");
  });
});

describe("localDayKey — input forms & validation", () => {
  it("accepts a Date and an epoch-ms number equivalently", () => {
    const ms = at(LA, "2026-06-15T10:00");
    expect(localDayKey(new Date(ms), LA)).toBe(localDayKey(ms, LA));
  });

  it("throws on an invalid zone", () => {
    expect(() => localDayKey(Date.now(), "Not/AZone")).toThrow();
  });

  it("exposes the 4am constant", () => {
    expect(DAY_START_HOUR).toBe(4);
  });
});

describe("previousDayKey", () => {
  it("steps back one calendar day", () => {
    expect(previousDayKey("2026-03-10")).toBe("2026-03-09");
  });

  it("crosses month boundaries", () => {
    expect(previousDayKey("2026-03-01")).toBe("2026-02-28");
  });

  it("crosses a leap-day boundary", () => {
    expect(previousDayKey("2024-03-01")).toBe("2024-02-29");
  });
});

describe("startOfTetDay", () => {
  const LA = "America/Los_Angeles";

  it("returns the 04:00 boundary of the current Tet day", () => {
    const now = DateTime.fromISO("2026-06-15T12:00", { zone: LA }).toMillis();
    const expected = DateTime.fromISO("2026-06-15T04:00", { zone: LA }).toMillis();
    expect(startOfTetDay(now, LA)).toBe(expected);
  });

  it("before 4am belongs to the prior calendar day's boundary", () => {
    const now = DateTime.fromISO("2026-06-15T02:30", { zone: LA }).toMillis();
    const expected = DateTime.fromISO("2026-06-14T04:00", { zone: LA }).toMillis();
    expect(startOfTetDay(now, LA)).toBe(expected);
  });

  it("a review at the boundary counts as today (>= start)", () => {
    const now = DateTime.fromISO("2026-06-15T12:00", { zone: LA }).toMillis();
    const start = startOfTetDay(now, LA);
    expect(now).toBeGreaterThanOrEqual(start);
  });
});
