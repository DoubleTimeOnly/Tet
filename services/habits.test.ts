import { MemoryStore } from "../db/memoryStore";
import { createHabit, updateHabit, archiveHabit, logHabit, moveHabit } from "./habits";
import { exportBackup, restoreBackup } from "./backupService";
import { DateTime } from "luxon";

const LA = "America/Los_Angeles";
const at = (iso: string) => DateTime.fromISO(iso, { zone: LA }).toMillis();

const GYM = {
  identity: "I care about my health",
  name: "Work out",
  action: "Walk to the gym",
};

describe("createHabit / listHabits", () => {
  it("round-trips a habit through the store", async () => {
    const store = new MemoryStore();
    const habit = await createHabit(store, { ...GYM, promptNote: true }, 100);

    expect(await store.listHabits()).toEqual([
      {
        id: habit.id,
        identity: "I care about my health",
        name: "Work out",
        action: "Walk to the gym",
        prompt_note: true,
        active: true,
        sort_order: 0,
        created_at: 100,
      },
    ]);
  });

  it("defaults the note prompt off and trims the text fields", async () => {
    const store = new MemoryStore();
    const habit = await createHabit(store, {
      identity: "  I keep a tidy home  ",
      name: "  Tidy up  ",
      action: "  Put one item back where it belongs  ",
    });
    expect(habit.prompt_note).toBe(false);
    expect(habit.identity).toBe("I keep a tidy home");
    expect(habit.name).toBe("Tidy up");
    expect(habit.action).toBe("Put one item back where it belongs");
  });

  it("lists in creation order until reordered", async () => {
    const store = new MemoryStore();
    await createHabit(store, { ...GYM, name: "First" }, 100);
    await createHabit(store, { ...GYM, name: "Second" }, 200);
    expect((await store.listHabits()).map((h) => h.name)).toEqual(["First", "Second"]);
  });

  it("puts a new habit at the bottom rather than displacing the top", async () => {
    const store = new MemoryStore();
    const a = await createHabit(store, { ...GYM, name: "A" }, 100);
    const b = await createHabit(store, { ...GYM, name: "B" }, 200);
    await moveHabit(store, b.id, -1); // B now first

    await createHabit(store, { ...GYM, name: "C" }, 300);

    expect((await store.listHabits()).map((h) => h.name)).toEqual(["B", "A", "C"]);
    expect(a.sort_order).toBe(0);
    expect(b.sort_order).toBe(1);
  });
});

describe("moveHabit", () => {
  const three = async () => {
    const store = new MemoryStore();
    const a = await createHabit(store, { ...GYM, name: "A" }, 100);
    const b = await createHabit(store, { ...GYM, name: "B" }, 200);
    const c = await createHabit(store, { ...GYM, name: "C" }, 300);
    return { store, a, b, c };
  };
  const names = async (store: MemoryStore) =>
    (await store.listHabits({ activeOnly: true })).map((h) => h.name);

  it("moves a habit up", async () => {
    const { store, c } = await three();
    await moveHabit(store, c.id, -1);
    expect(await names(store)).toEqual(["A", "C", "B"]);
  });

  it("moves a habit down", async () => {
    const { store, a } = await three();
    await moveHabit(store, a.id, 1);
    expect(await names(store)).toEqual(["B", "A", "C"]);
  });

  it("is a no-op at the top", async () => {
    const { store, a } = await three();
    await moveHabit(store, a.id, -1);
    expect(await names(store)).toEqual(["A", "B", "C"]);
  });

  it("is a no-op at the bottom", async () => {
    const { store, c } = await three();
    await moveHabit(store, c.id, 1);
    expect(await names(store)).toEqual(["A", "B", "C"]);
  });

  it("ignores an unknown habit", async () => {
    const { store } = await three();
    await moveHabit(store, "nope", -1);
    expect(await names(store)).toEqual(["A", "B", "C"]);
  });

  it("keeps positions dense so repeated moves stay correct", async () => {
    const { store, a } = await three();
    await moveHabit(store, a.id, 1);
    await moveHabit(store, a.id, 1);
    expect(await names(store)).toEqual(["B", "C", "A"]);
    expect((await store.listHabits()).map((h) => h.sort_order)).toEqual([0, 1, 2]);
  });

  it("survives a round-trip through backup", async () => {
    const { store, c } = await three();
    await moveHabit(store, c.id, -1);

    const restored = new MemoryStore();
    await restoreBackup(restored, await exportBackup(store, 1000));

    expect((await restored.listHabits()).map((h) => h.name)).toEqual(["A", "C", "B"]);
  });

  it("orders the visible list even when an archived habit sits between", async () => {
    const { store, a, b, c } = await three();
    await archiveHabit(store, b.id);
    await moveHabit(store, c.id, -1);
    expect(await names(store)).toEqual(["C", "A"]);
    // the archived one keeps its own position and is simply not shown
    expect((await store.getHabit(b.id))!.active).toBe(false);
    expect(a.id).toBeTruthy();
  });
});

describe("logHabit", () => {
  it("writes the Tet local-day key, not the UTC date", async () => {
    const store = new MemoryStore();
    const habit = await createHabit(store, GYM);
    // 22:00 in LA is already the next UTC day, but it's still the same Tet day.
    const log = await logHabit(store, habit, {}, at("2026-06-15T22:00"), LA);
    expect(log.date).toBe("2026-06-15");
  });

  it("counts a 2am session against the previous day (4am boundary)", async () => {
    const store = new MemoryStore();
    const habit = await createHabit(store, GYM);
    const log = await logHabit(store, habit, {}, at("2026-06-16T02:00"), LA);
    expect(log.date).toBe("2026-06-15");
  });

  it("allows unlimited logs in one day, each its own row", async () => {
    const store = new MemoryStore();
    const habit = await createHabit(store, GYM);
    await logHabit(store, habit, {}, at("2026-06-15T09:00"), LA);
    await logHabit(store, habit, {}, at("2026-06-15T13:00"), LA);
    await logHabit(store, habit, {}, at("2026-06-15T18:00"), LA);

    expect(await store.listHabitLogs(habit.id)).toHaveLength(3);
    expect(await store.listHabitLogsForDay("2026-06-15")).toHaveLength(3);
  });

  it("stores a note when given one and null when skipped or blank", async () => {
    const store = new MemoryStore();
    const habit = await createHabit(store, GYM);
    const withNote = await logHabit(
      store,
      habit,
      { note: "  legs were heavy  " },
      at("2026-06-15T09:00"),
      LA,
    );
    const skipped = await logHabit(store, habit, { note: null }, at("2026-06-15T10:00"), LA);
    const blank = await logHabit(store, habit, { note: "   " }, at("2026-06-15T11:00"), LA);

    expect(withNote.note).toBe("legs were heavy");
    expect(skipped.note).toBeNull();
    expect(blank.note).toBeNull();
  });

  it("returns the log newest-first, honouring a limit", async () => {
    const store = new MemoryStore();
    const habit = await createHabit(store, GYM);
    await logHabit(store, habit, { note: "first" }, at("2026-06-15T09:00"), LA);
    await logHabit(store, habit, { note: "second" }, at("2026-06-15T13:00"), LA);
    await logHabit(store, habit, { note: "third" }, at("2026-06-16T09:00"), LA);

    expect((await store.listHabitLogs(habit.id)).map((l) => l.note)).toEqual([
      "third",
      "second",
      "first",
    ]);
    expect((await store.listHabitLogs(habit.id, 1)).map((l) => l.note)).toEqual(["third"]);
  });

  it("keeps one habit's logs out of another's", async () => {
    const store = new MemoryStore();
    const gym = await createHabit(store, GYM);
    const tidy = await createHabit(store, { ...GYM, name: "Tidy up", action: "Put one item back" });
    await logHabit(store, gym, {}, at("2026-06-15T09:00"), LA);
    await logHabit(store, tidy, {}, at("2026-06-15T10:00"), LA);

    expect(await store.listHabitLogs(gym.id)).toHaveLength(1);
    expect(await store.listHabitLogs(tidy.id)).toHaveLength(1);
  });
});

describe("updateHabit", () => {
  it("merges a patch over the current row", async () => {
    const store = new MemoryStore();
    const habit = await createHabit(store, GYM);
    const next = await updateHabit(store, habit.id, { action: "Work out for 5 minutes" });

    expect(next.action).toBe("Work out for 5 minutes");
    expect(next.name).toBe("Work out");
    expect(next.identity).toBe("I care about my health");
    expect((await store.getHabit(habit.id))!.action).toBe("Work out for 5 minutes");
  });

  it("leaves older logs reading the action they were done with", async () => {
    const store = new MemoryStore();
    const habit = await createHabit(store, GYM);
    await logHabit(store, habit, {}, at("2026-06-15T09:00"), LA);

    const scaled = await updateHabit(store, habit.id, { action: "Work out for 5 minutes" });
    await logHabit(store, scaled, {}, at("2026-06-16T09:00"), LA);

    // newest first: the new action, then the original — history stays truthful.
    expect((await store.listHabitLogs(habit.id)).map((l) => l.action)).toEqual([
      "Work out for 5 minutes",
      "Walk to the gym",
    ]);
  });

  it("can turn the note prompt on and off", async () => {
    const store = new MemoryStore();
    const habit = await createHabit(store, GYM);
    expect((await updateHabit(store, habit.id, { promptNote: true })).prompt_note).toBe(true);
    expect((await updateHabit(store, habit.id, { promptNote: false })).prompt_note).toBe(false);
  });

  it("throws for an unknown habit", async () => {
    const store = new MemoryStore();
    await expect(updateHabit(store, "nope", { name: "x" })).rejects.toThrow(/no habit nope/);
  });
});

describe("archiveHabit", () => {
  it("drops the habit from the active list but keeps it and its logs", async () => {
    const store = new MemoryStore();
    const habit = await createHabit(store, GYM);
    await logHabit(store, habit, { note: "done" }, at("2026-06-15T09:00"), LA);

    await archiveHabit(store, habit.id);

    expect(await store.listHabits({ activeOnly: true })).toEqual([]);
    expect(await store.listHabits()).toHaveLength(1);
    expect(await store.listHabitLogs(habit.id)).toHaveLength(1);
  });
});

describe("backup round-trip", () => {
  // Goes through the real Settings path (exportBackup -> JSON -> restoreBackup)
  // rather than store.exportAll/replaceAll, so the serialize + validate layer
  // in lib/backup is exercised too.
  it("carries habits and their logs through a JSON export and restore", async () => {
    const source = new MemoryStore();
    const habit = await createHabit(source, { ...GYM, promptNote: true }, 100);
    await logHabit(source, habit, { note: "rainy" }, at("2026-06-15T09:00"), LA);
    await logHabit(source, habit, {}, at("2026-06-15T18:00"), LA);
    const edited = await updateHabit(source, habit.id, { action: "Work out for 5 minutes" });
    await logHabit(source, edited, {}, at("2026-06-16T09:00"), LA);

    const json = await exportBackup(source, 1000);

    const restored = new MemoryStore();
    await restoreBackup(restored, json);

    expect(await restored.listHabits()).toEqual(await source.listHabits());
    expect(await restored.listHabitLogs(habit.id)).toEqual(await source.listHabitLogs(habit.id));
    // The per-log action snapshots survive, so edited history stays truthful.
    expect((await restored.listHabitLogs(habit.id)).map((l) => l.action)).toEqual([
      "Work out for 5 minutes",
      "Walk to the gym",
      "Walk to the gym",
    ]);
    // Notes and the note-prompt setting survive too.
    expect((await restored.listHabitLogs(habit.id)).map((l) => l.note)).toEqual([
      null,
      null,
      "rainy",
    ]);
    expect((await restored.getHabit(habit.id))!.prompt_note).toBe(true);
  });

  it("restores an archived habit as archived, logs intact", async () => {
    const source = new MemoryStore();
    const habit = await createHabit(source, GYM, 100);
    await logHabit(source, habit, {}, at("2026-06-15T09:00"), LA);
    await archiveHabit(source, habit.id);

    const restored = new MemoryStore();
    await restoreBackup(restored, await exportBackup(source, 1000));

    expect(await restored.listHabits({ activeOnly: true })).toEqual([]);
    expect(await restored.listHabitLogs(habit.id)).toHaveLength(1);
  });

  it("restoring a pre-habits (v2) backup clears habits rather than failing", async () => {
    const store = new MemoryStore();
    const habit = await createHabit(store, GYM, 100);
    await logHabit(store, habit, {}, at("2026-06-15T09:00"), LA);

    // A backup taken before habits existed: no habits/habitLogs keys at all.
    const v2 = JSON.stringify({
      version: 2,
      exported_at: 1,
      decks: [],
      tasks: [],
      notes: [],
      cards: [],
      reviews: [],
      completions: [],
    });
    await restoreBackup(store, v2);

    expect(await store.listHabits()).toEqual([]);
    expect(await store.listHabitLogs(habit.id)).toEqual([]);
  });
});
