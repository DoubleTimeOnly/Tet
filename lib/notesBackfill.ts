import { newId } from "./id";
import { reconstructClozeText } from "./notes";
import type { Card, Note } from "../db/schema";

/**
 * One-time migration: existing cards predate notes, so their sibling groups are
 * only derivable from content. backfillNotes reconstructs a Note for each group
 * (cloze sentence / reversed pair) and stamps note_id + template onto its cards,
 * so old multi-cloze / reversed cards become editable-as-one. Singletons (plain
 * basic cards) stay note-less, and cards that already have a note_id are passed
 * through untouched. Card ids / fsrs_state / due are preserved — only note_id
 * and template are added — so no schedule is lost.
 *
 * Grouping mirrors lib/siblings.siblingKey (and lib/obsidianImport) so burying
 * and backfill agree on what a sibling group is.
 */

function clozeSentence(card: Card): string {
  return card.front.split("[...]").join(card.back);
}
function pairKey(card: Card): string {
  return `${card.deck_id}:${JSON.stringify([card.front, card.back].sort())}`;
}

export interface BackfillResult {
  notes: Note[];
  cards: Card[];
}

export function backfillNotes(cards: Card[], genId: () => string = newId): BackfillResult {
  const notes: Note[] = [];
  // Index of card.id -> stamped { note_id, template }; default note-less.
  const stamp = new Map<string, { note_id: string | null; template: number }>();

  // Only legacy, note-less cards are eligible (idempotent re-runs are no-ops).
  const legacy = cards.filter((c) => !c.note_id);

  // Cloze groups: cards whose front carries a "[...]" blank.
  const clozeGroups = new Map<string, Card[]>();
  const rest: Card[] = [];
  for (const c of legacy) {
    if (c.front.includes("[...]")) {
      const k = `${c.deck_id}:${clozeSentence(c)}`;
      (clozeGroups.get(k) ?? clozeGroups.set(k, []).get(k)!).push(c);
    } else {
      rest.push(c);
    }
  }

  for (const group of clozeGroups.values()) {
    const ordered = [...group].sort(
      (a, b) => a.front.indexOf("[...]") - b.front.indexOf("[...]"),
    );
    const text = reconstructClozeText(ordered);
    if (text === null) continue; // can't invert -> leave note-less
    const head = ordered[0]!;
    const note: Note = {
      id: genId(),
      deck_id: head.deck_id,
      kind: "cloze",
      fields: JSON.stringify({ text }),
      source_task_id: head.source_task_id,
      created_at: head.created_at,
    };
    notes.push(note);
    ordered.forEach((c, i) => stamp.set(c.id, { note_id: note.id, template: i }));
  }

  // Reversed pairs: two cards in a deck whose front/back are swapped.
  const pairGroups = new Map<string, Card[]>();
  for (const c of rest) {
    const k = pairKey(c);
    (pairGroups.get(k) ?? pairGroups.set(k, []).get(k)!).push(c);
  }
  for (const group of pairGroups.values()) {
    const swapped =
      group.length === 2 &&
      group[0]!.front === group[1]!.back &&
      group[0]!.back === group[1]!.front;
    if (!swapped) continue; // singleton or not a true swap -> note-less basic
    const [fwd, rev] = group;
    const note: Note = {
      id: genId(),
      deck_id: fwd!.deck_id,
      kind: "reversed",
      fields: JSON.stringify({ front: fwd!.front, back: fwd!.back }),
      source_task_id: fwd!.source_task_id,
      created_at: fwd!.created_at,
    };
    notes.push(note);
    stamp.set(fwd!.id, { note_id: note.id, template: 0 });
    stamp.set(rev!.id, { note_id: note.id, template: 1 });
  }

  const stampedCards = cards.map((c) => {
    const s = stamp.get(c.id);
    // Normalize defaults too: v1-backup cards predate these columns entirely.
    return {
      ...c,
      note_id: s ? s.note_id : c.note_id ?? null,
      template: s ? s.template : c.template ?? 0,
    };
  });
  return { notes, cards: stampedCards };
}
