import { unzipSync } from "fflate";
import * as FileSystem from "expo-file-system/legacy";
import * as SQLite from "expo-sqlite";
import type { AnkiNote, AnkiNoteReader } from "../lib/ankiImport";

/**
 * Reads notes out of an .apkg (a zip wrapping a `collection.anki2` SQLite db).
 * This is the device-side plumbing behind the AnkiNoteReader seam; the import
 * transform itself (lib/ankiImport) is pure and unit-tested. Native only.
 *
 * Anki joins a note's fields with the 0x1f unit-separator in `notes.flds`.
 */
const FIELD_SEPARATOR = "";

export function createApkgReader(fileUri: string): AnkiNoteReader {
  return {
    async readNotes(): Promise<AnkiNote[]> {
      const b64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const files = unzipSync(base64ToBytes(b64));
      // Newer exports use collection.anki21; fall back to the classic name.
      const dbBytes = files["collection.anki21"] ?? files["collection.anki2"];
      if (!dbBytes) {
        throw new Error("Archive has no collection.anki2 / .anki21");
      }

      const db = await SQLite.deserializeDatabaseAsync(dbBytes);
      try {
        const rows = await db.getAllAsync<{ flds: string }>("SELECT flds FROM notes");
        return rows.map((r) => ({ fields: r.flds.split(FIELD_SEPARATOR) }));
      } finally {
        await db.closeAsync();
      }
    },
  };
}

/** Base64 -> bytes without relying on atob (not guaranteed in Hermes). */
function base64ToBytes(b64: string): Uint8Array {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

  const clean = b64.replace(/=+$/, "");
  const out = new Uint8Array((clean.length * 3) >> 2);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)]!;
    const b = lookup[clean.charCodeAt(i + 1)]!;
    const c = lookup[clean.charCodeAt(i + 2)]!;
    const d = lookup[clean.charCodeAt(i + 3)]!;
    out[p++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) out[p++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < clean.length) out[p++] = ((c & 3) << 6) | d;
  }
  return out;
}
