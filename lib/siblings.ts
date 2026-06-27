import type { Card } from "../db/schema";

/**
 * Sibling burying — mirrors the Obsidian "Spaced Repetition" plugin: cards that
 * came from the same source (the several clozes of one `==a== not ==b==` line,
 * or the two directions of a reversed `:::` / `??` card) must not both surface
 * on the same day, because each one reveals the others' answers.
 *
 * Cards have no stored sibling-group id, so we derive one from content. The
 * importer (lib/obsidianImport) is the only producer of siblings today and its
 * shapes are recoverable:
 *
 *   - Cloze cards blank one `==span==` as the literal "[...]"; splicing `back`
 *     back into that hole reconstructs the original sentence, so every cloze of
 *     a line collapses to one key.
 *   - Reversed pairs are the same {front, back} in swapped order, so a key built
 *     from the unordered pair matches both directions.
 *
 * Keys are scoped by deck so identical text in different decks stays separate.
 *
 * Cards that DO carry a note_id are grouped by it directly — the real sibling
 * group, set by the importer / authoring. The content heuristic below only
 * applies to note-less cards (legacy data not yet backfilled, Anki/transfer
 * imports), so existing burying behavior is preserved.
 */
export function siblingKey(card: Card): string {
  if (card.note_id) return `note:${card.note_id}`;
  if (card.front.includes("[...]")) {
    // split/join (not String.replace) so `back` is spliced literally, never
    // interpreted as a `$1`-style replacement pattern.
    return `cloze:${card.deck_id}:${card.front.split("[...]").join(card.back)}`;
  }
  const pair = [card.front, card.back].sort();
  return `pair:${card.deck_id}:${JSON.stringify(pair)}`;
}

export interface BuriedCards {
  /** First card of each sibling group, in input order. */
  kept: Card[];
  /** Later siblings of an already-kept group — hold these for another day. */
  deferred: Card[];
}

/**
 * Keep the first card of each sibling group and defer the rest. Input should be
 * the day's due cards in priority order (oldest-first); the kept card is then
 * the oldest of its group and deferred siblings roll to a later day.
 */
export function burySiblings(cards: Card[]): BuriedCards {
  const seen = new Set<string>();
  const kept: Card[] = [];
  const deferred: Card[] = [];
  for (const card of cards) {
    const key = siblingKey(card);
    if (seen.has(key)) {
      deferred.push(card);
    } else {
      seen.add(key);
      kept.push(card);
    }
  }
  return { kept, deferred };
}
