import type { Store } from "../db/store";
import type { BackupFiles } from "../adapters/backupFiles";
import { exportBackup, restoreBackup } from "./backupService";
import {
  backupFilename,
  shouldBackup,
  sortNewestFirst,
  staleBackups,
  type AutoBackupFile,
} from "../lib/autoBackup";

/**
 * Automatic backups: a snapshot on app open, at most once a day, keeping the
 * most recent MAX_AUTO_BACKUPS (lib/autoBackup owns that policy).
 *
 * `files` is injected rather than imported so the whole flow is exercised
 * against an in-memory fake in tests — the adapter is the only part that
 * touches a real filesystem.
 */

export interface AutoBackupResult {
  /** false when skipped: too soon, or the platform has no storage. */
  wrote: boolean;
  /** Filename written, when one was. */
  name?: string;
  /** Old snapshots deleted to stay under the cap. */
  pruned: string[];
}

/**
 * Take a snapshot if one is due. Never throws: a backup failure must not stop
 * the app opening, so problems are reported through the return value and a
 * console warning rather than propagating to the UI.
 */
export async function runAutoBackup(
  store: Store,
  files: BackupFiles,
  now: number = Date.now(),
): Promise<AutoBackupResult> {
  if (!files.available) return { wrote: false, pruned: [] };
  try {
    const existing = await files.list();
    if (!shouldBackup(existing, now)) return { wrote: false, pruned: [] };

    const name = backupFilename(now);
    await files.write(name, await exportBackup(store, now));

    // Prune against the list INCLUDING the snapshot just written, so the cap
    // counts what's actually on disk.
    const pruned = staleBackups([...existing, name]);
    for (const old of pruned) await files.remove(old);

    return { wrote: true, name, pruned };
  } catch (err) {
    console.warn("[autoBackup] snapshot failed:", err);
    return { wrote: false, pruned: [] };
  }
}

/** Existing snapshots, newest first, for the Settings list. */
export async function listAutoBackups(files: BackupFiles): Promise<AutoBackupFile[]> {
  if (!files.available) return [];
  try {
    return sortNewestFirst(await files.list());
  } catch (err) {
    console.warn("[autoBackup] could not list snapshots:", err);
    return [];
  }
}

/**
 * Restore one snapshot. Unlike runAutoBackup this DOES throw — it's a
 * deliberate user action, so the Settings screen reports what went wrong.
 */
export async function restoreAutoBackup(
  store: Store,
  files: BackupFiles,
  name: string,
): Promise<void> {
  await restoreBackup(store, await files.read(name));
}
