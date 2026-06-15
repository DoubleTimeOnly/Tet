import type { AnkiNoteReader } from "../lib/ankiImport";

/**
 * Web preview stub: .apkg import needs native unzip + sqlite. Keeps expo-sqlite
 * out of the web bundle; the real reader lives in apkgReader.ts (native).
 */
export function createApkgReader(_fileUri: string): AnkiNoteReader {
  return {
    async readNotes() {
      throw new Error(".apkg import is only available on the device build");
    },
  };
}
