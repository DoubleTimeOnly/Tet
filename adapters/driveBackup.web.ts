import type { DriveBackupFiles } from "./driveBackup";

export type { DriveBackupFiles } from "./driveBackup";

/**
 * No Drive backup on web: the web preview runs on MemoryStore, so there is no
 * durable dataset to back up (same reason as backupFiles.web), and the native
 * Google sign-in library isn't available there.
 */
export const driveBackup: DriveBackupFiles = {
  supported: false,
  async describe() {
    return null;
  },
  async hasFolder() {
    return false;
  },
  async chooseFolder() {
    return false;
  },
  account() {
    return null;
  },
  async signOut() {
    /* no-op */
  },
  async list() {
    return [];
  },
  async read() {
    throw new Error("Google Drive backup is not available on web");
  },
  async write(name: string) {
    return name;
  },
  async remove() {
    /* no-op */
  },
};
