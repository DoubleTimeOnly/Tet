import * as FileSystem from "expo-file-system/legacy";
import TetDocuments from "../modules/tet-documents";
import { createBackupFolderStore } from "./tokenStore";
import { filenameFromUri } from "../lib/autoBackup";
import { folderProblem, type FolderError } from "../lib/backupFolder";

/**
 * Where automatic backups live on Android.
 *
 * Preferred: a folder the user picks once through the Storage Access
 * Framework. That grant is persistable, so it survives restarts, and the
 * folder is somewhere they can actually open — Downloads, an SD card, a Google
 * Drive folder — which is the whole point. The chosen tree uri is remembered in
 * adapters/tokenStore.
 *
 * Picking goes through expo-file-system, but reading and writing inside the
 * folder goes through modules/tet-documents: expo's SAF helpers only accept the
 * built-in storage provider, so a cloud provider's folder could be picked and
 * then failed every call. The native module works with any provider, uses each
 * file's real display name, and chooseFolder() test-writes to the folder so a
 * provider that lists but won't accept files (Dropbox) is rejected up front
 * instead of failing every day at backup time.
 *
 * Until they pick one, snapshots still go to a private `backups/` folder inside
 * the app's document directory. A user who never opens Settings must not end up
 * with no backups at all; private storage is worse than a real folder (it's
 * invisible to a file manager and an uninstall takes it with it) but it is far
 * better than nothing. describe() reports which is in use so Settings can say.
 */

export interface BackupFiles {
  /** Whether this platform can persist snapshots at all (false on web). */
  readonly supported: boolean;
  /** Where backups are going, for display. Null when unsupported. */
  describe(): Promise<string | null>;
  /** True once the user has granted a folder of their own. */
  hasFolder(): Promise<boolean>;
  /**
   * One-time folder grant. Resolves true if the user picked one. Safe to call
   * again to move to a different folder. Rejects, with a message the user can
   * act on, if the folder was picked but can't be written to.
   */
  chooseFolder(): Promise<boolean>;
  /** Filenames (not uris) of everything in the active directory. */
  list(): Promise<string[]>;
  read(name: string): Promise<string>;
  /**
   * Write a snapshot and resolve with the name it actually landed under.
   * On SAF that is not necessarily the name asked for: the provider
   * de-duplicates clashes, so the caller must use the returned name for listing
   * and pruning rather than assuming.
   */
  write(name: string, text: string): Promise<string>;
  remove(name: string): Promise<void>;
}

const MIME = "application/json";
const PRIVATE_DIR = `${FileSystem.documentDirectory}backups/`;
const folderStore = createBackupFolderStore();

/** The granted tree uri, or null when the user hasn't chosen one. */
async function grantedUri(): Promise<string | null> {
  try {
    return await folderStore.getToken();
  } catch {
    return null;
  }
}

async function ensurePrivateDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(PRIVATE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PRIVATE_DIR, { intermediates: true });
  }
}

/** The document uri of a file in the granted folder, by its display name. */
async function documentUriFor(tree: string, name: string): Promise<string | null> {
  const entries = await TetDocuments.list(tree);
  return entries.find((e) => e.name === name)?.uri ?? null;
}

export const backupFiles: BackupFiles = {
  supported: true,

  async describe() {
    const tree = await grantedUri();
    return tree ? readableFolder(tree) : "Tet's private storage";
  },

  async hasFolder() {
    return (await grantedUri()) !== null;
  },

  async chooseFolder() {
    const res = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!res.granted) return false;
    try {
      await TetDocuments.probe(res.directoryUri);
    } catch (e) {
      // Don't keep a grant for a folder we won't use.
      await TetDocuments.release(res.directoryUri).catch(() => undefined);
      throw new Error(folderProblem(e as FolderError));
    }
    await folderStore.setToken(res.directoryUri);
    return true;
  },

  async list() {
    const tree = await grantedUri();
    if (tree) return (await TetDocuments.list(tree)).map((e) => e.name);
    await ensurePrivateDir();
    return FileSystem.readDirectoryAsync(PRIVATE_DIR);
  },

  async read(name) {
    const tree = await grantedUri();
    if (tree) {
      const uri = await documentUriFor(tree, name);
      if (!uri) throw new Error(`Backup ${name} is no longer in the chosen folder`);
      return TetDocuments.read(uri);
    }
    return FileSystem.readAsStringAsync(`${PRIVATE_DIR}${name}`);
  },

  async write(name, text) {
    const tree = await grantedUri();
    if (tree) return TetDocuments.write(tree, name, MIME, text);
    await ensurePrivateDir();
    await FileSystem.writeAsStringAsync(`${PRIVATE_DIR}${name}`, text);
    return name;
  },

  async remove(name) {
    const tree = await grantedUri();
    if (tree) {
      const uri = await documentUriFor(tree, name);
      if (uri) await TetDocuments.remove(uri);
      return;
    }
    await FileSystem.deleteAsync(`${PRIVATE_DIR}${name}`, { idempotent: true });
  },
};

/**
 * "primary:Download/Tet" out of a tree uri, so Settings can name the folder the
 * way the user would recognise it rather than showing a content:// blob.
 */
function readableFolder(treeUri: string): string {
  const decoded = filenameFromUri(treeUri);
  return decoded || treeUri;
}
