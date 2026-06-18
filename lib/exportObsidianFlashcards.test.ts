import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { parseFlashcardNote, type ObsidianExport, type ParsedCard } from "./obsidianImport";

/**
 * Export generator, NOT a unit test (parsing is covered by obsidianImport.test).
 * It reuses the real parser so the checked-in JSON can never drift from app
 * behaviour. Skipped unless OBSIDIAN_VAULT points at a vault, so CI stays green.
 *
 *   OBSIDIAN_VAULT="/home/victor/Documents/Brain2" npx jest exportObsidianFlashcards
 *
 * Writes data/obsidian-flashcards.json (override with OBSIDIAN_OUT).
 */

const VAULT = process.env.OBSIDIAN_VAULT;
const OUT = process.env.OBSIDIAN_OUT ?? join(__dirname, "..", "data", "obsidian-flashcards.json");
const TAG = "#flashcardsv2";
const DECK_NAME = "Obsidian Flashcards";

function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // skip .obsidian, .trash, etc.
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** "Flashcards - Quantum computing - Andy Matuschak.md" -> note title. */
function noteTitle(file: string): string {
  return basename(file, ".md").replace(/^Flashcards - /, "");
}

/** Cards the author tagged for deletion in the vault (e.g. "REMOVE <front>"). */
function markedForRemoval(card: ParsedCard): boolean {
  return /^(remove|romove)\b/i.test(card.front.trimStart());
}

(VAULT ? describe : describe.skip)("export obsidian flashcards", () => {
  it("writes the export JSON from every #flashcardsv2 note", () => {
    const tagged = walkMarkdown(VAULT!)
      .map((f) => ({ file: f, text: readFileSync(f, "utf-8") }))
      .filter(({ text }) => text.includes(TAG))
      .sort((a, b) => a.file.localeCompare(b.file));

    const cards: ParsedCard[] = [];
    let removed = 0;
    for (const { file, text } of tagged) {
      for (const card of parseFlashcardNote(text, noteTitle(file))) {
        if (markedForRemoval(card)) removed++;
        else cards.push(card);
      }
    }

    const data: ObsidianExport = {
      source: `Obsidian vault (${TAG})`,
      exportedAt: new Date().toISOString(),
      deckName: DECK_NAME,
      cards,
    };

    mkdirSync(join(OUT, ".."), { recursive: true });
    writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n");

    expect(tagged.length).toBeGreaterThan(0);
    expect(cards.length).toBeGreaterThan(300);
    expect(cards.every((c) => !markedForRemoval(c))).toBe(true);
    // eslint-disable-next-line no-console
    console.log(
      `Exported ${cards.length} cards from ${tagged.length} notes ` +
        `(dropped ${removed} marked REMOVE) -> ${OUT}`,
    );
  });
});
