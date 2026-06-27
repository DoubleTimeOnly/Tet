import type { Card, Note, NoteKind } from "../db/schema";

/**
 * Notes own the shared source text; their review Cards are generated from it.
 * This module is the single place that turns a note into its sibling cards
 * (generateCards) and that re-derives those cards after an edit while keeping
 * each surviving sibling's FSRS schedule (reconcileNoteCards). Pure + unit
 * tested; the importer (lib/obsidianImport) and backfill (lib/notesBackfill)
 * reuse buildCloze / reconstructClozeText from here.
 */

/** Matches one `==span==` highlight; `g` so callers get every span on a line. */
export const CLOZE = /==(.+?)==/g;

/** A card as generated from a note: which sibling (template) and its text. */
export interface GeneratedCard {
  template: number;
  front: string;
  back: string;
}

export interface PairFields {
  front: string;
  back: string;
}
export interface ClozeFields {
  text: string;
}

/**
 * Build one cloze card: blank the `target`-th `==span==`, reveal the rest.
 * Front = sentence with the target replaced by "[...]"; back = the target text.
 * (Moved here from obsidianImport so import, authoring, and backfill share it.)
 */
export function buildCloze(
  body: string,
  spans: RegExpMatchArray[],
  target: number,
): { front: string; back: string } {
  let front = "";
  let cursor = 0;
  spans.forEach((m, k) => {
    const start = m.index ?? 0;
    front += body.slice(cursor, start);
    front += k === target ? "[...]" : m[1];
    cursor = start + m[0].length;
  });
  front += body.slice(cursor);
  return { front: front.trim(), back: (spans[target]![1] ?? "").trim() };
}

/** Typed accessor for a note's JSON `fields` by kind. */
export function noteFields(note: Note): PairFields | ClozeFields {
  return JSON.parse(note.fields) as PairFields | ClozeFields;
}

export function clozeText(fields: PairFields | ClozeFields): string {
  return (fields as ClozeFields).text ?? "";
}

/**
 * Generate the review cards a note produces, in template order:
 *   basic    -> [front/back]
 *   reversed -> [front/back, back/front]
 *   cloze    -> one card per `==span==`, template = span index.
 */
export function generateCards(note: Note): GeneratedCard[] {
  const fields = noteFields(note);
  switch (note.kind) {
    case "basic": {
      const f = fields as PairFields;
      return [{ template: 0, front: f.front, back: f.back }];
    }
    case "reversed": {
      const f = fields as PairFields;
      return [
        { template: 0, front: f.front, back: f.back },
        { template: 1, front: f.back, back: f.front },
      ];
    }
    case "cloze": {
      const body = clozeText(fields);
      const spans = [...body.matchAll(CLOZE)];
      const out: GeneratedCard[] = [];
      spans.forEach((_s, k) => {
        const { front, back } = buildCloze(body, spans, k);
        if (front && back) out.push({ template: k, front, back });
      });
      return out;
    }
  }
}

/** How many `==span==` blanks a cloze source contains (UI hint / validation). */
export function countClozeSpans(text: string): number {
  return [...text.matchAll(CLOZE)].length;
}

export interface NoteReconcile {
  /** Existing cards to update in place (id kept -> schedule preserved). */
  updated: { id: string; front: string; back: string; template: number }[];
  /** Brand-new siblings (e.g. a newly added cloze) needing fresh FSRS cards. */
  inserted: GeneratedCard[];
  /** Card ids no longer produced by the note (e.g. a removed cloze). */
  removed: string[];
}

/**
 * Diff a note's freshly generated cards against the cards it currently owns,
 * matching survivors so their schedule carries over:
 *   - basic / reversed match by template (stable 0/1 roles).
 *   - cloze matches by the blanked span TEXT (its `back`), so inserting or
 *     removing a span mid-sentence keeps each schedule glued to its own blank
 *     rather than to a shifting positional index; `template` is then re-stamped
 *     to the new index for the surviving card.
 */
export function reconcileNoteCards(note: Note, existing: Card[]): NoteReconcile {
  const gen = generateCards(note);
  const updated: NoteReconcile["updated"] = [];
  const inserted: GeneratedCard[] = [];
  const usedIds = new Set<string>();

  for (const g of gen) {
    const match =
      note.kind === "cloze"
        ? existing.find((c) => !usedIds.has(c.id) && c.back === g.back)
        : existing.find((c) => !usedIds.has(c.id) && c.template === g.template);
    if (match) {
      usedIds.add(match.id);
      updated.push({ id: match.id, front: g.front, back: g.back, template: g.template });
    } else {
      inserted.push(g);
    }
  }

  const removed = existing.filter((c) => !usedIds.has(c.id)).map((c) => c.id);
  return { updated, inserted, removed };
}

/**
 * Rebuild a cloze note's `==span==` source from its already-generated cards —
 * the inverse of buildCloze. Each card's `front` has exactly one "[...]" whose
 * prefix length locates its span (`back`) in the plain sentence; wrapping every
 * span in `==…==` recovers the editable source.
 *
 * Returns null when the cards don't cleanly invert (overlapping/duplicate spans
 * or a missing "[...]"), so callers can fall back to keeping cards standalone.
 */
export function reconstructClozeText(cards: { front: string; back: string }[]): string | null {
  if (cards.length === 0) return null;
  // Plain sentence: splice any card's answer back into its blank.
  const first = cards[0]!;
  if (!first.front.includes("[...]")) return null;
  const plain = first.front.split("[...]").join(first.back);

  // Locate each span [start, end) in the plain sentence.
  const ranges: { start: number; end: number }[] = [];
  for (const c of cards) {
    const hole = c.front.indexOf("[...]");
    if (hole < 0) return null;
    const start = hole;
    const end = start + c.back.length;
    if (plain.slice(start, end) !== c.back) return null; // doesn't line up
    ranges.push({ start, end });
  }
  ranges.sort((a, b) => a.start - b.start);
  // Reject overlaps — they'd produce nested/ambiguous markers.
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i]!.start < ranges[i - 1]!.end) return null;
  }

  let out = "";
  let cursor = 0;
  for (const r of ranges) {
    out += plain.slice(cursor, r.start);
    out += `==${plain.slice(r.start, r.end)}==`;
    cursor = r.end;
  }
  out += plain.slice(cursor);
  return out;
}

/** Build a note's JSON `fields` from a kind + form inputs (authoring). */
export function makeFields(kind: NoteKind, input: { front?: string; back?: string; text?: string }): string {
  if (kind === "cloze") return JSON.stringify({ text: (input.text ?? "").trim() });
  return JSON.stringify({ front: (input.front ?? "").trim(), back: (input.back ?? "").trim() });
}
