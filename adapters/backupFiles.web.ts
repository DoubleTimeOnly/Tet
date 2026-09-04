import type { BackupFiles } from "./backupFiles";

export type { BackupFiles } from "./backupFiles";

/**
 * Web has no automatic backups: the web preview runs on MemoryStore, so the
 * dataset is already gone when the tab closes and there is nothing durable to
 * snapshot. `available: false` makes the Settings section say so instead of
 * showing an empty list that never fills.
 */
export const backupFiles: BackupFiles = {
  available: false,
  async list() {
    return [];
  },
  async read() {
    throw new Error("Automatic backups are not available on web");
  },
  async write() {
    /* no-op */
  },
  async remove() {
    /* no-op */
  },
  uriFor(name: string) {
    return name;
  },
};
