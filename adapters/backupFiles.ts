import * as FileSystem from "expo-file-system/legacy";
import { createBackupFolderStore } from "./tokenStore";
import { filenameFromUri, stripExtension } from "../lib/autoBackup";

/**
 * Where automatic backups live on Android.
 *
 * Preferred: a folder the user picks once through the Storage Access
 * Framework. That grant is persistable, so it survives restarts, and the
 * folder is somewhere they can actually open — Downloads, an SD card, a synced
 * Drive folder — which is the whole point. The chosen tree uri is remembered in
 * adapters/tokenStore.
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
   * again to move to a different folder.
   */
  chooseFolder(): Promise<boolean>;
  /** Filenames (not uris) of everything in the active directory. */
  list(): Promise<string[]>;
  read(name: string): Promise<string>;
  write(name: string, text: string): Promise<void>;
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

const SAF = FileSystem.StorageAccessFramework;

/** name -> document uri within the granted tree. */
async function safUriFor(tree: string, name: string): Promise<string | null> {
  const uris = await SAF.readDirectoryAsync(tree);
  return uris.find((u) => filenameFromUri(u) === name) ?? null;
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
    const res = await SAF.requestDirectoryPermissionsAsync();
    if (!res.granted) return false;
    await folderStore.setToken(res.directoryUri);
    return true;
  },

  async list() {
    const tree = await grantedUri();
    if (tree) return (await SAF.readDirectoryAsync(tree)).map(filenameFromUri);
    await ensurePrivateDir();
    return FileSystem.readDirectoryAsync(PRIVATE_DIR);
  },

  async read(name) {
    const tree = await grantedUri();
    if (tree) {
      const uri = await safUriFor(tree, name);
      if (!uri) throw new Error(`Backup ${name} is no longer in the chosen folder`);
      return SAF.readAsStringAsync(uri);
    }
    return FileSystem.readAsStringAsync(`${PRIVATE_DIR}${name}`);
  },

  async write(name, text) {
    const tree = await grantedUri();
    if (tree) {
      // SAF appends the extension itself, from the mime type.
      const uri = await SAF.createFileAsync(tree, stripExtension(name), MIME);
      await SAF.writeAsStringAsync(uri, text);
      return;
    }
    await ensurePrivateDir();
    await FileSystem.writeAsStringAsync(`${PRIVATE_DIR}${name}`, text);
  },

  async remove(name) {
    const tree = await grantedUri();
    if (tree) {
      const uri = await safUriFor(tree, name);
      if (uri) await SAF.deleteAsync(uri);
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
