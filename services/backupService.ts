import type { Store } from "../db/store";
import { exportAll, importAll } from "../lib/backup";
import { importApkg, type AnkiNoteReader, type ImportApkgOptions } from "../lib/ankiImport";

/** Store-backed backup + import flows for the Settings screen. */

export async function exportBackup(
  store: Store,
  now: number = Date.now(),
): Promise<string> {
  return exportAll(await store.exportAll(), now);
}

/** Validate then atomically replace the dataset (throws on bad input). */
export async function restoreBackup(store: Store, json: string): Promise<void> {
  const data = importAll(json); // throws BackupImportError before any write
  await store.replaceAll(data);
}

/** Import an .apkg via the injected reader, appending a fresh deck of cards. */
export async function importAnki(
  store: Store,
  reader: AnkiNoteReader,
  opts: ImportApkgOptions = {},
) {
  const { deck, cards, skipped } = await importApkg(reader, opts);
  await store.insertMany([deck], cards);
  return { deck, cardsImported: cards.length, skipped };
}
