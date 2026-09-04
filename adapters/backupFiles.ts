import * as FileSystem from "expo-file-system/legacy";

/**
 * The automatic-backup folder. Native writes JSON snapshots into a dedicated
 * `backups/` directory under the app's document directory, so Tet always knows
 * where to find them and never trips over unrelated files.
 *
 * On iOS the app's Documents directory is exposed in the Files app (the
 * UIFileSharingEnabled / LSSupportsOpeningDocumentsInPlace keys in app.json),
 * so these snapshots are browsable and can be handed straight to the "Import
 * backup" picker. Android keeps app documents private to the app, so there the
 * Settings list offers a per-snapshot "Save a copy" that shares the file out to
 * somewhere the picker can reach.
 *
 * (Web has no persistent store at all — see backupFiles.web.ts.)
 */

export interface BackupFiles {
  /** Filenames in the backup directory (not paths). Empty if none. */
  list(): Promise<string[]>;
  read(name: string): Promise<string>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
  /** Absolute uri for a file, for the share sheet. */
  uriFor(name: string): string;
  /** Whether snapshots can be written at all on this platform. */
  readonly available: boolean;
}

const DIR = `${FileSystem.documentDirectory}backups/`;

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  }
}

export const backupFiles: BackupFiles = {
  available: true,

  async list() {
    await ensureDir();
    return FileSystem.readDirectoryAsync(DIR);
  },

  async read(name) {
    return FileSystem.readAsStringAsync(`${DIR}${name}`);
  },

  async write(name, text) {
    await ensureDir();
    await FileSystem.writeAsStringAsync(`${DIR}${name}`, text);
  },

  async remove(name) {
    await FileSystem.deleteAsync(`${DIR}${name}`, { idempotent: true });
  },

  uriFor(name) {
    return `${DIR}${name}`;
  },
};
