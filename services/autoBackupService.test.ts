import { MemoryStore } from "../db/memoryStore";
import { runAutoBackup, listAutoBackups, restoreAutoBackup } from "./autoBackupService";
import type { BackupFiles } from "../adapters/backupFiles";
import { createHabit, logHabit } from "./habits";
import { seedStarterDeck } from "./authoring";
import { AUTO_BACKUP_INTERVAL_MS, MAX_AUTO_BACKUPS } from "../lib/autoBackup";
import { DateTime } from "luxon";

const LA = "America/Los_Angeles";
const at = (iso: string) => DateTime.fromISO(iso, { zone: "utc" }).toMillis();

/**
 * In-memory stand-in for the document directory. `rename` models SAF, which
 * picks the final filename itself (appending the extension from the mime type,
 * de-duplicating clashes) rather than using the one it was handed.
 */
function fakeFiles(
  seed: Record<string, string> = {},
  rename: (name: string) => string = (n) => n,
) {
  const disk = new Map(Object.entries(seed));
  const files: BackupFiles & { disk: Map<string, string> } = {
    disk,
    supported: true,
    async list() {
      return [...disk.keys()];
    },
    async read(name) {
      const text = disk.get(name);
      if (text === undefined) throw new Error(`no such file ${name}`);
      return text;
    },
    async write(name, text) {
      const actual = rename(name);
      disk.set(actual, text);
      return actual;
    },
    async remove(name) {
      disk.delete(name);
    },
    async describe() {
      return "fake folder";
    },
    async hasFolder() {
      return true;
    },
    async chooseFolder() {
      return true;
    },
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
    const files = { ...fakeFiles(), supported: false };
    expect((await runAutoBackup(store, files, now)).wrote).toBe(false);
  });

  it("never throws when the filesystem fails — the app must still open", async () => {
    const store = new MemoryStore();
    const files = fakeFiles();
    files.write = async () => {
      throw new Error("disk full");
    };

    // Reported, not thrown, and not swallowed: Settings needs to be able to
    // tell "nothing due" apart from "every snapshot is failing".
    await expect(runAutoBackup(store, files, now)).resolves.toEqual({
      wrote: false,
      pruned: [],
      error: "disk full",
    });
  });

  it("forces a snapshot even when one isn't due", async () => {
    const store = new MemoryStore();
    const fresh = at("2026-09-04T11:00:00"); // an hour old
    const files = fakeFiles({ [`tet-auto-2026-09-04T110000.json`]: "{}" });

    expect((await runAutoBackup(store, files, now)).wrote).toBe(false);

    const forced = await runAutoBackup(store, files, now, { force: true });
    expect(forced.wrote).toBe(true);
    expect(files.disk.size).toBe(2);
    expect(fresh).toBeLessThan(now);
  });

  it("reports a forced failure rather than claiming success", async () => {
    const store = new MemoryStore();
    const files = fakeFiles();
    files.write = async () => {
      throw new Error("permission denied");
    };

    const res = await runAutoBackup(store, files, now, { force: true });
    expect(res.wrote).toBe(false);
    expect(res.error).toBe("permission denied");
  });

  describe("when the filesystem renames the file (SAF)", () => {
    // SAF appends the extension from the mime type and de-duplicates clashes,
    // so the name we ask for is not necessarily the name on disk.
    it("reports the name actually written, not the one requested", async () => {
      const store = new MemoryStore();
      const files = fakeFiles({}, (n) => n.replace(".json", " (1).json"));

      const res = await runAutoBackup(store, files, now);

      expect(res.name).toBe("tet-auto-2026-09-04T120000 (1).json");
      expect([...files.disk.keys()]).toEqual(["tet-auto-2026-09-04T120000 (1).json"]);
    });

    it("still schedules and lists when no extension is appended", async () => {
      const store = new MemoryStore();
      // A provider that doesn't know application/json appends nothing.
      const files = fakeFiles({}, (n) => n.replace(".json", ""));

      const first = await runAutoBackup(store, files, now);
      expect(first.wrote).toBe(true);

      // The snapshot must be visible to the Settings list...
      expect((await listAutoBackups(files)).map((f) => f.name)).toEqual([
        "tet-auto-2026-09-04T120000",
      ]);
      // ...and must count against the schedule, or every open writes another
      // file that can never be listed or pruned.
      expect((await runAutoBackup(store, files, now)).wrote).toBe(false);
      expect(files.disk.size).toBe(1);
    });

    it("prunes renamed files against the cap", async () => {
      const store = new MemoryStore();
      const seed: Record<string, string> = {};
      for (let i = 0; i < MAX_AUTO_BACKUPS; i++) {
        const day = String(i + 1).padStart(2, "0");
        seed[`tet-auto-2026-08-${day}T120000`] = "{}";
      }
      const files = fakeFiles(seed, (n) => n.replace(".json", ""));

      const res = await runAutoBackup(store, files, now);

      expect(res.pruned).toEqual(["tet-auto-2026-08-01T120000"]);
      expect(files.disk.size).toBe(MAX_AUTO_BACKUPS);
    });
  });
});

describe("listAutoBackups", () => {
  it("surfaces an unreadable directory instead of showing an empty list", async () => {
    const files = fakeFiles();
    files.list = async () => {
      throw new Error("permission revoked");
    };

    await expect(listAutoBackups(files)).rejects.toThrow("permission revoked");
  });

  it("is empty, not an error, where storage isn't available (web)", async () => {
    await expect(listAutoBackups({ ...fakeFiles(), supported: false })).resolves.toEqual([]);
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
      promptItems: [], promptPractices: [], promptDraws: [],
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
    expect(await listAutoBackups({ ...fakeFiles(), supported: false })).toEqual([]);
  });
});
