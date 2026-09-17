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
  /** false when skipped: too soon, not due, or the platform has no storage. */
  wrote: boolean;
  /** The name actually written, when one was (SAF may rename — see BackupFiles). */
  name?: string;
  /** Old snapshots deleted to stay under the cap. */
  pruned: string[];
  /**
   * Why nothing was written, when the cause was a failure rather than the
   * schedule. Reported rather than thrown so a broken backup can't stop the app
   * opening — but it must reach the Settings card, because "no snapshots" and
   * "snapshots are failing" look identical to the user otherwise.
   */
  error?: string;
}

export interface AutoBackupOptions {
  /**
   * Snapshot even if one isn't due. Used when the user has just picked a
   * folder or asked for a backup explicitly — in both cases the interval is
   * beside the point and they expect a file to appear now.
   */
  force?: boolean;
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
  { force = false }: AutoBackupOptions = {},
): Promise<AutoBackupResult> {
  if (!files.supported) return { wrote: false, pruned: [] };
  try {
    const existing = await files.list();
    if (!force && !shouldBackup(existing, now)) return { wrote: false, pruned: [] };

    // What the file is CALLED is the adapter's to decide: SAF appends the
    // extension and de-duplicates clashes, so prune against what came back.
    const name = await files.write(backupFilename(now), await exportBackup(store, now));

    // Prune against the list INCLUDING the snapshot just written, so the cap
    // counts what's actually on disk.
    const pruned = staleBackups([...existing, name]);
    for (const old of pruned) await files.remove(old);

    return { wrote: true, name, pruned };
  } catch (err) {
    console.warn("[autoBackup] snapshot failed:", err);
    return { wrote: false, pruned: [], error: (err as Error).message };
  }
}

/**
 * Existing snapshots, newest first, for the Settings list. Throws if the
 * directory can't be read — an unreadable folder (a revoked SAF grant, say) is
 * exactly what the user needs told, and swallowing it into an empty list made
 * a broken folder indistinguishable from a new one.
 */
export async function listAutoBackups(files: BackupFiles): Promise<AutoBackupFile[]> {
  if (!files.supported) return [];
  return sortNewestFirst(await files.list());
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
