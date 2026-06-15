import { createCard } from "./fsrs";
import { newId } from "./id";
import type { Deck, Card } from "../db/schema";

/**
 * Import an Anki .apkg into a fresh deck of brand-new FSRS cards
 * (eng-review #8). Anki's SM-2 scheduling history is intentionally NOT ported
 * — every imported card starts new under ts-fsrs.
 *
 * The .apkg internals (a zip wrapping a `collection.anki2` SQLite db) stay out
 * of this module. It depends only on an injectable AnkiNoteReader, matching
 * the TokenStore / ReadwiseClient seam used elsewhere: the app wires the real
 * unzip + expo-sqlite read; tests wire a fake. A corrupt archive surfaces as
 * the reader throwing, which we wrap in AnkiImportError.
 */

/** One note's fields, already split from Anki's \x1f-separated `flds`. */
export interface AnkiNote {
  fields: string[];
}

export interface AnkiNoteReader {
  readNotes(): Promise<AnkiNote[]>;
}

export class AnkiImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnkiImportError";
  }
}

export interface ImportApkgOptions {
  deckName?: string;
  now?: Date | number;
  /** Test seam for deterministic ids. */
  deckId?: string;
  idFactory?: () => string;
  /** Strip Anki field HTML to plain text (default true). */
  stripHtml?: boolean;
}

export interface ImportApkgResult {
  deck: Deck;
  cards: Card[];
  /** Notes skipped for lacking a usable front+back. */
  skipped: number;
}

/** Minimal HTML-to-text: drop tags, collapse whitespace, decode common entities. */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export async function importApkg(
  reader: AnkiNoteReader,
  opts: ImportApkgOptions = {},
): Promise<ImportApkgResult> {
  const now = opts.now ?? Date.now();
  const nowMs = now instanceof Date ? now.getTime() : now;
  const genId = opts.idFactory ?? newId;
  const clean = opts.stripHtml === false ? (s: string) => s : stripHtmlToText;

  let notes: AnkiNote[];
  try {
    notes = await reader.readNotes();
  } catch (err) {
    // Corrupt/unreadable archive: reject cleanly, nothing written.
    throw new AnkiImportError(`Could not read .apkg: ${(err as Error).message}`);
  }

  const deck: Deck = {
    id: opts.deckId ?? genId(),
    name: opts.deckName ?? "Imported deck",
    created_at: nowMs,
  };

  const cards: Card[] = [];
  let skipped = 0;

  for (const note of notes) {
    const front = clean(note.fields[0] ?? "");
    const back = clean(note.fields[1] ?? "");
    // A usable Basic card needs a front and a back; skip the rest.
    if (!front || !back) {
      skipped++;
      continue;
    }
    cards.push(
      createCard({ deckId: deck.id, front, back, now, id: genId() }),
    );
  }

  return { deck, cards, skipped };
}
