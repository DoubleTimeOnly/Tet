import { requireNativeModule } from "expo";

/** A file directly inside the granted folder. */
export interface DocumentEntry {
  /** The provider's display name, e.g. "tet-auto-2026-09-04T120000.json". */
  name: string;
  /** Document uri for read/remove. Opaque: never parse it for a name. */
  uri: string;
}

/**
 * Android-only (Storage Access Framework). Rejections carry a `code`:
 * FOLDER_UNAVAILABLE, FOLDER_NOT_WRITABLE, CREATE_FAILED, WRITE_FAILED,
 * READ_FAILED.
 */
interface TetDocumentsNative {
  list(treeUri: string): Promise<DocumentEntry[]>;
  /** Resolves true if a throwaway file could be created, written and deleted. */
  probe(treeUri: string): Promise<boolean>;
  /** Resolves with the name the provider actually stored the file under. */
  write(treeUri: string, name: string, mimeType: string, text: string): Promise<string>;
  read(uri: string): Promise<string>;
  /** False if there was nothing to delete or the provider refused. */
  remove(uri: string): Promise<boolean>;
  release(treeUri: string): Promise<boolean>;
}

export default requireNativeModule<TetDocumentsNative>("TetDocuments");
