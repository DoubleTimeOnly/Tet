import {
  AUTO_BACKUP_INTERVAL_MS,
  MAX_AUTO_BACKUPS,
  backupFilename,
  parseBackupTime,
  sortNewestFirst,
  shouldBackup,
  staleBackups,
  stripExtension,
  filenameFromUri,
} from "./autoBackup";
import { DateTime } from "luxon";

const utc = (iso: string) => DateTime.fromISO(iso, { zone: "utc" }).toMillis();

describe("backupFilename / parseBackupTime", () => {
  it("round-trips an instant through the filename", () => {
    const now = utc("2026-09-04T18:30:00");
    const name = backupFilename(now);
    expect(name).toBe("tet-auto-2026-09-04T183000.json");
    expect(parseBackupTime(name)).toBe(now);
  });

  it("names sort chronologically as plain strings", () => {
    const names = [
      backupFilename(utc("2026-09-04T09:00:00")),
      backupFilename(utc("2026-01-31T23:59:00")),
      backupFilename(utc("2026-09-04T10:00:00")),
    ];
    expect([...names].sort()).toEqual([
      "tet-auto-2026-01-31T235900.json",
      "tet-auto-2026-09-04T090000.json",
      "tet-auto-2026-09-04T100000.json",
    ]);
  });

  it("ignores files that aren't ours", () => {
    expect(parseBackupTime("tet-backup.json")).toBeNull();
    expect(parseBackupTime("tet-flashcards.json")).toBeNull();
    expect(parseBackupTime("notes.txt")).toBeNull();
    expect(parseBackupTime("tet-auto-nonsense.json")).toBeNull();
    expect(parseBackupTime("tet-auto-2026-13-45T999999.json")).toBeNull();
  });
});

describe("stripExtension (SAF createFileAsync wants no extension)", () => {
  it("drops the .json", () => {
    expect(stripExtension("tet-auto-2026-09-04T183000.json")).toBe(
      "tet-auto-2026-09-04T183000",
    );
  });

  it("leaves a name that has no extension alone", () => {
    expect(stripExtension("tet-auto-2026-09-04T183000")).toBe("tet-auto-2026-09-04T183000");
  });

  it("round-trips with backupFilename", () => {
    const now = utc("2026-09-04T18:30:00");
    expect(`${stripExtension(backupFilename(now))}.json`).toBe(backupFilename(now));
  });
});

describe("filenameFromUri (SAF lists document uris, not names)", () => {
  it("pulls the name out of a percent-encoded SAF document uri", () => {
    const uri =
      "content://com.android.externalstorage.documents/document/" +
      "primary%3ADownload%2FTet%2Ftet-auto-2026-09-04T120000.json";
    expect(filenameFromUri(uri)).toBe("tet-auto-2026-09-04T120000.json");
  });

  it("handles a uri whose id ends at the volume colon", () => {
    const uri = "content://com.android.externalstorage.documents/document/primary%3Anotes.json";
    expect(filenameFromUri(uri)).toBe("notes.json");
  });

  it("handles a plain file uri", () => {
    expect(filenameFromUri("file:///data/user/0/com.tet/files/backups/a.json")).toBe("a.json");
  });

  it("feeds parseBackupTime so a SAF listing schedules correctly", () => {
    const now = utc("2026-09-04T12:00:00");
    const uri =
      "content://com.android.externalstorage.documents/document/" +
      `primary%3ATet%2F${backupFilename(now)}`;
    expect(parseBackupTime(filenameFromUri(uri))).toBe(now);
  });

  it("survives a malformed escape rather than throwing", () => {
    expect(() => filenameFromUri("content://x/%E0%A4%A")).not.toThrow();
  });
});

describe("sortNewestFirst", () => {
  it("orders newest first and drops foreign files", () => {
    const files = sortNewestFirst([
      "tet-auto-2026-09-01T120000.json",
      "README.md",
      "tet-auto-2026-09-03T120000.json",
      "tet-backup.json",
      "tet-auto-2026-09-02T120000.json",
    ]);
    expect(files.map((f) => f.name)).toEqual([
      "tet-auto-2026-09-03T120000.json",
      "tet-auto-2026-09-02T120000.json",
      "tet-auto-2026-09-01T120000.json",
    ]);
  });

  it("is empty for a directory with nothing of ours in it", () => {
    expect(sortNewestFirst(["tet-backup.json"])).toEqual([]);
  });
});

describe("shouldBackup (once a day)", () => {
  const now = utc("2026-09-04T12:00:00");

  it("backs up when there is nothing yet", () => {
    expect(shouldBackup([], now)).toBe(true);
  });

  it("skips when the newest is younger than 24h", () => {
    const recent = backupFilename(now - AUTO_BACKUP_INTERVAL_MS + 60_000);
    expect(shouldBackup([recent], now)).toBe(false);
  });

  it("backs up once the newest is exactly 24h old", () => {
    const due = backupFilename(now - AUTO_BACKUP_INTERVAL_MS);
    expect(shouldBackup([due], now)).toBe(true);
  });

  it("keys off the newest, not the oldest", () => {
    const files = [
      backupFilename(now - 10 * AUTO_BACKUP_INTERVAL_MS),
      backupFilename(now - 60_000), // fresh
    ];
    expect(shouldBackup(files, now)).toBe(false);
  });

  it("ignores foreign files when deciding", () => {
    expect(shouldBackup(["tet-backup.json"], now)).toBe(true);
  });

  it("defers rather than spamming when the clock jumps backwards", () => {
    const future = backupFilename(now + 5 * AUTO_BACKUP_INTERVAL_MS);
    expect(shouldBackup([future], now)).toBe(false);
  });
});

describe("staleBackups (retention)", () => {
  const names = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      backupFilename(utc("2026-09-04T12:00:00") - i * AUTO_BACKUP_INTERVAL_MS),
    );

  it("keeps everything below the cap", () => {
    expect(staleBackups(names(MAX_AUTO_BACKUPS))).toEqual([]);
  });

  it("drops the oldest beyond the cap", () => {
    const all = names(MAX_AUTO_BACKUPS + 3);
    const stale = staleBackups(all);
    expect(stale).toHaveLength(3);
    // the three oldest, and none of the kept ones
    expect(stale).toEqual(all.slice(-3));
  });

  it("never proposes deleting a foreign file", () => {
    const all = [...names(MAX_AUTO_BACKUPS + 2), "tet-backup.json", "photo.png"];
    const stale = staleBackups(all);
    expect(stale).not.toContain("tet-backup.json");
    expect(stale).not.toContain("photo.png");
    expect(stale).toHaveLength(2);
  });

  it("honours a custom cap", () => {
    expect(staleBackups(names(5), 2)).toHaveLength(3);
  });
});
