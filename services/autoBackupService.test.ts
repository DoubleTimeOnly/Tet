import { MemoryStore } from "../db/memoryStore";
import { runAutoBackup, listAutoBackups, restoreAutoBackup } from "./autoBackupService";
import type { BackupFiles } from "../adapters/backupFiles";
import { createHabit, logHabit } from "./habits";
import { seedStarterDeck } from "./authoring";
import { AUTO_BACKUP_INTERVAL_MS, MAX_AUTO_BACKUPS } from "../lib/autoBackup";
import { DateTime } from "luxon";

const LA = "America/Los_Angeles";
const at = (iso: string) => DateTime.fromISO(iso, { zone: "utc" }).toMillis();

/** In-memory stand-in for the document directory. */
function fakeFiles(seed: Record<string, string> = {}) {
  const disk = new Map(Object.entries(seed));
  const files: BackupFiles & { disk: Map<string, string> } = {
    disk,
    available: true,
    async list() {
      return [...disk.keys()];
    },
    async read(name) {
      const text = disk.get(name);
      if (text === undefined) throw new Error(`no such file ${name}`);
      return text;
    },
    async write(name, text) {
      disk.set(name, text);
    },
    async remove(name) {
      disk.delete(name);
    },
    uriFor: (name) => name,
  };
  return files;
}

describe("runAutoBackup", () => {
  const now = at("2026-09-04T12:00:00");

  it("writes a snapshot on a first open", async () => {
    const store = new MemoryStore();
    await seedStarterDeck(store, now);
    const files = fakeFiles();

    const res = await runAutoBackup(store, files, now);

    expect(res.wrote).toBe(true);
    expect(res.name).toBe("tet-auto-2026-09-04T120000.json");
    expect(files.disk.size).toBe(1);
  });

  it("skips when the last snapshot is younger than 24h", async () => {
    const store = new MemoryStore();
    const files = fakeFiles();
    await runAutoBackup(store, files, now);

    const res = await runAutoBackup(store, files, now + AUTO_BACKUP_INTERVAL_MS - 1000);

    expect(res.wrote).toBe(false);
    expect(files.disk.size).toBe(1);
  });

  it("writes again once a day has passed", async () => {
    const store = new MemoryStore();
    const files = fakeFiles();
    await runAutoBackup(store, files, now);

    const res = await runAutoBackup(store, files, now + AUTO_BACKUP_INTERVAL_MS);

    expect(res.wrote).toBe(true);
    expect(files.disk.size).toBe(2);
  });

  it("opening many times in one day writes exactly one snapshot", async () => {
    const store = new MemoryStore();
    const files = fakeFiles();
    for (let i = 0; i < 10; i++) {
      await runAutoBackup(store, files, now + i * 60_000);
    }
    expect(files.disk.size).toBe(1);
  });

  it("keeps at most MAX_AUTO_BACKUPS, dropping the oldest", async () => {
    const store = new MemoryStore();
    const files = fakeFiles();
    for (let day = 0; day < MAX_AUTO_BACKUPS + 5; day++) {
      await runAutoBackup(store, files, now + day * AUTO_BACKUP_INTERVAL_MS);
    }

    expect(files.disk.size).toBe(MAX_AUTO_BACKUPS);
    // the survivors are the newest ones
    const kept = await listAutoBackups(files);
    expect(kept[0]!.at).toBe(now + (MAX_AUTO_BACKUPS + 4) * AUTO_BACKUP_INTERVAL_MS);
    expect(kept).toHaveLength(MAX_AUTO_BACKUPS);
  });

  it("leaves files that aren't ours alone", async () => {
    const store = new MemoryStore();
    const files = fakeFiles({ "tet-backup.json": "{}", "notes.txt": "hi" });
    for (let day = 0; day < MAX_AUTO_BACKUPS + 3; day++) {
      await runAutoBackup(store, files, now + day * AUTO_BACKUP_INTERVAL_MS);
    }
    expect(files.disk.has("tet-backup.json")).toBe(true);
    expect(files.disk.has("notes.txt")).toBe(true);
  });

  it("is a no-op where storage isn't available (web)", async () => {
    const store = new MemoryStore();
    const files = { ...fakeFiles(), available: false };
    expect((await runAutoBackup(store, files, now)).wrote).toBe(false);
  });

  it("never throws when the filesystem fails — the app must still open", async () => {
    const store = new MemoryStore();
    const files = fakeFiles();
    files.write = async () => {
      throw new Error("disk full");
    };

    await expect(runAutoBackup(store, files, now)).resolves.toEqual({
      wrote: false,
      pruned: [],
    });
  });
});

describe("restoreAutoBackup", () => {
  const now = at("2026-09-04T12:00:00");

  it("brings back the dataset as it was when the snapshot was taken", async () => {
    const store = new MemoryStore();
    const habit = await createHabit(store, {
      identity: "I care about my health",
      name: "Work out",
      action: "Walk to the gym",
    });
    await logHabit(store, habit, { note: "went" }, now, LA);
    const before = await store.exportAll();

    const files = fakeFiles();
    const res = await runAutoBackup(store, files, now);

    // Damage the instance the way an old manual restore would.
    await store.replaceAll({
      decks: [], tasks: [], notes: [], cards: [], reviews: [],
      completions: [], habits: [], habitLogs: [], lootCards: [],
    });
    expect(await store.listHabits()).toEqual([]);

    await restoreAutoBackup(store, files, res.name!);

    expect(await store.exportAll()).toEqual(before);
    expect((await store.listHabitLogs(habit.id))[0]!.note).toBe("went");
  });

  it("throws for a snapshot that isn't there (a real user action, not silent)", async () => {
    const store = new MemoryStore();
    await expect(restoreAutoBackup(store, fakeFiles(), "tet-auto-2020-01-01T000000.json"))
      .rejects.toThrow();
  });
});

describe("listAutoBackups", () => {
  it("returns newest first and ignores foreign files", async () => {
    const now = at("2026-09-04T12:00:00");
    const store = new MemoryStore();
    const files = fakeFiles({ "tet-backup.json": "{}" });
    await runAutoBackup(store, files, now);
    await runAutoBackup(store, files, now + AUTO_BACKUP_INTERVAL_MS);

    const list = await listAutoBackups(files);
    expect(list).toHaveLength(2);
    expect(list[0]!.at).toBeGreaterThan(list[1]!.at);
  });

  it("is empty where storage isn't available", async () => {
    expect(await listAutoBackups({ ...fakeFiles(), available: false })).toEqual([]);
  });
});
