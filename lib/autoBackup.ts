import { DateTime } from "luxon";

/**
 * Naming, scheduling and retention for automatic backups — pure logic, no I/O,
 * so the whole policy is testable without a filesystem (adapters/backupFiles
 * does the reading and writing).
 *
 * Tet takes a snapshot when the app opens, at most once a day, and keeps the
 * last MAX_AUTO_BACKUPS. The point is blast radius: a restore REPLACES the
 * dataset (lib/backup), so without recent snapshots your only fallback is
 * whatever manual export you last remembered to take.
 *
 * The timestamp lives in the filename rather than in a separate "last run"
 * record, so the schedule is derived from the files themselves. Delete them and
 * the next open simply backs up again — there is no state to get out of sync.
 */

export const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MAX_AUTO_BACKUPS = 14;

const PREFIX = "tet-auto-";
const SUFFIX = ".json";
/**
 * UTC, so filenames sort chronologically as plain strings and a device moving
 * between zones (or across a DST change) can't produce an out-of-order name.
 * Displayed times are converted back to the local zone by the Settings list.
 */
const STAMP_FORMAT = "yyyy-LL-dd'T'HHmmss";

export interface AutoBackupFile {
  name: string;
  /** Epoch ms parsed from the filename. */
  at: number;
}

/** e.g. "tet-auto-2026-09-04T183000.json" */
export function backupFilename(now: number): string {
  const stamp = DateTime.fromMillis(now, { zone: "utc" }).toFormat(STAMP_FORMAT);
  return `${PREFIX}${stamp}${SUFFIX}`;
}

/**
 * The name without its extension — what SAF's createFileAsync wants, since it
 * appends the extension itself from the mime type.
 */
export function stripExtension(filename: string): string {
  return filename.endsWith(SUFFIX) ? filename.slice(0, -SUFFIX.length) : filename;
}

/**
 * Filename out of a SAF content:// uri. Android's Storage Access Framework
 * enumerates a directory as document uris whose id is a percent-encoded path,
 * e.g.
 *   content://…/document/primary%3ADownload%2FTet%2Ftet-auto-2026-09-04T120000.json
 * so the name is whatever follows the last separator once decoded. Works for
 * plain file:// uris too. Returns the input unchanged if it can't be decoded.
 */
export function filenameFromUri(uri: string): string {
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    // Malformed escape sequence — fall back to the raw string.
  }
  const cut = Math.max(decoded.lastIndexOf("/"), decoded.lastIndexOf(":"));
  return cut === -1 ? decoded : decoded.slice(cut + 1);
}

/** Epoch ms for one of our filenames, or null for anything else in the dir. */
export function parseBackupTime(filename: string): number | null {
  if (!filename.startsWith(PREFIX) || !filename.endsWith(SUFFIX)) return null;
  const stamp = filename.slice(PREFIX.length, filename.length - SUFFIX.length);
  const dt = DateTime.fromFormat(stamp, STAMP_FORMAT, { zone: "utc" });
  return dt.isValid ? dt.toMillis() : null;
}

/** Our backups, newest first. Foreign files in the directory are ignored. */
export function sortNewestFirst(filenames: string[]): AutoBackupFile[] {
  return filenames
    .map((name) => ({ name, at: parseBackupTime(name) }))
    .filter((f): f is AutoBackupFile => f.at !== null)
    .sort((a, b) => b.at - a.at);
}

/**
 * True when the newest snapshot is at least `intervalMs` old (or there is
 * none). A clock that jumps backwards can make the newest look like it's in
 * the future; that just defers the next backup rather than spamming one per
 * open, which is the safer failure.
 */
export function shouldBackup(
  filenames: string[],
  now: number,
  intervalMs: number = AUTO_BACKUP_INTERVAL_MS,
): boolean {
  const newest = sortNewestFirst(filenames)[0];
  if (!newest) return true;
  return now - newest.at >= intervalMs;
}

/** Names to delete so at most `max` remain — the oldest go first. */
export function staleBackups(
  filenames: string[],
  max: number = MAX_AUTO_BACKUPS,
): string[] {
  return sortNewestFirst(filenames)
    .slice(max)
    .map((f) => f.name);
}
