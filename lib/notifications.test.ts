import { nextDailyTrigger, DEFAULT_REMINDER_HOUR } from "./notifications";
import { DateTime } from "luxon";

const LA = "America/Los_Angeles";
const at = (iso: string) => DateTime.fromISO(iso, { zone: LA }).toMillis();
const localHour = (d: Date) => DateTime.fromJSDate(d).setZone(LA).hour;

describe("nextDailyTrigger", () => {
  it("fires today when the reminder hour is still ahead", () => {
    const fire = nextDailyTrigger(at("2026-06-15T07:00"), LA, { hour: 9, minute: 0 });
    expect(DateTime.fromJSDate(fire).setZone(LA).toFormat("yyyy-LL-dd HH:mm")).toBe("2026-06-15 09:00");
  });

  it("rolls to tomorrow when the hour has passed", () => {
    const fire = nextDailyTrigger(at("2026-06-15T10:00"), LA, { hour: 9, minute: 0 });
    expect(DateTime.fromJSDate(fire).setZone(LA).toFormat("yyyy-LL-dd HH:mm")).toBe("2026-06-16 09:00");
  });

  it("rolls to tomorrow when exactly at the trigger time (strictly ahead)", () => {
    const fire = nextDailyTrigger(at("2026-06-15T09:00"), LA, { hour: 9, minute: 0 });
    expect(DateTime.fromJSDate(fire).setZone(LA).toFormat("yyyy-LL-dd")).toBe("2026-06-16");
  });

  it("defaults to the 9am reminder hour", () => {
    const fire = nextDailyTrigger(at("2026-06-15T06:00"), LA);
    expect(localHour(fire)).toBe(DEFAULT_REMINDER_HOUR);
  });

  it("throws on an invalid zone", () => {
    expect(() => nextDailyTrigger(Date.now(), "Not/AZone")).toThrow();
  });
});
