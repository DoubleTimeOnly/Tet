import { State as FsrsState, type Card as FsrsCard } from "ts-fsrs";
import { createCard } from "./fsrs";
import { newId } from "./id";
import { buildCloze, CLOZE, reconstructClozeText } from "./notes";
import type { Deck, Card, Note } from "../db/schema";

/**
 * Import flashcards authored with the Obsidian "Spaced Repetition" plugin
 * (notes tagged `#flashcardsv2`) into Tet's ts-fsrs deck model.
 *
 * Unlike ankiImport (which resets every card to new), this path PRESERVES the
 * plugin's SM-2 schedule per card — its due date, interval, and ease — so the
 * learner keeps their progress. The plugin is SM-2 and Tet is FSRS, so the
 * mapping is best-effort (see srScheduleToFsrsCard / easeToDifficulty); the
 * raw SM-2 numbers are kept verbatim in the export JSON so nothing is lost.
 *
 * Two stages, both pure and unit-tested:
 *   1. parseFlashcardNote(markdown) -> ParsedCard[]  (markdown shapes -> cards)
 *   2. importObsidian(export)       -> { deck, cards } (ParsedCard -> Card rows)
 * The markdown parser only runs at export time (lib/exportObsidianFlashcards);
 * the app imports the resulting JSON, never raw markdown.
 */

/** One card's SM-2 state as the plugin stores it in `<!--SR:!due,interval,ease-->`. */
export interface SrSchedule {
  /** Next review date, "YYYY-MM-DD". */
  due: string;
  /** Current inter-repetition interval in days. */
  interval: number;
  /** SM-2 ease factor in per-mille (250 = the 2.5 default). */
  ease: number;
}

export type CardKind = "basic" | "reversed" | "cloze" | "multiline";

/** A card extracted from markdown, with its raw SM-2 schedule (null = never reviewed). */
export interface ParsedCard {
  front: string;
  back: string;
  /** Source note (filename without the "Flashcards - " prefix / extension). */
  note: string;
  kind: CardKind;
  schedule: SrSchedule | null;
}

/** The on-disk export artifact (data/obsidian-flashcards.json). */
export interface ObsidianExport {
  source: string;
  exportedAt: string;
  deckName: string;
  cards: ParsedCard[];
}

// ---------------------------------------------------------------------------
// Markdown parsing
// ---------------------------------------------------------------------------

const SR_COMMENT = /<!--SR:(.*?)-->/;
const SR_ENTRY = /!(\d{4}-\d{2}-\d{2}),(\d+),(\d+)/g;

/** Pull every `!date,interval,ease` triple out of a line's SR comment, in order. */
function parseSchedules(text: string): SrSchedule[] {
  const m = SR_COMMENT.exec(text);
  if (!m || m[1] === undefined) return [];
  const out: SrSchedule[] = [];
  const re = new RegExp(SR_ENTRY.source, "g");
  let e: RegExpExecArray | null;
  while ((e = re.exec(m[1])) !== null) {
    out.push({ due: e[1]!, interval: Number(e[2]), ease: Number(e[3]) });
  }
  return out;
}

/** Drop the trailing `<!--SR:...-->` scheduling comment from a line. */
function stripSr(text: string): string {
  return text.replace(SR_COMMENT, "").replace(/[ \t]+$/, "");
}

function isTagOrHeading(line: string): boolean {
  return line.trim().startsWith("#");
}

/** A line that already encodes a complete card (so multiline walk-back must stop). */
function looksLikeOwnCard(line: string): boolean {
  return line.includes("::") || line.includes("<!--SR:") || line.includes("==");
}

/**
 * Parse one `#flashcardsv2` note into cards. Handles the plugin's default
 * syntaxes: single-line `::` (basic) and `:::` (reversed -> 2 cards), multi-line
 * `?`/`??` blocks, and `==highlight==` clozes (one card per highlight).
 */
export function parseFlashcardNote(markdown: string, note: string): ParsedCard[] {
  const lines = markdown.split(/\r?\n/);
  const consumed = new Set<number>();
  const cards: ParsedCard[] = [];

  // Pass 1: multi-line cards — front lines, a lone `?`(basic)/`??`(reversed)
  // separator, then back lines, bounded by blank lines.
  for (let i = 0; i < lines.length; i++) {
    const sep = lines[i]!.trim();
    if (sep !== "?" && sep !== "??") continue;
    consumed.add(i);

    const frontLines: string[] = [];
    for (let s = i - 1; s >= 0; s--) {
      const t = lines[s]!.trim();
      if (t === "" || isTagOrHeading(lines[s]!) || looksLikeOwnCard(lines[s]!)) break;
      frontLines.unshift(lines[s]!);
      consumed.add(s);
    }
    const backLines: string[] = [];
    for (let e = i + 1; e < lines.length; e++) {
      if (lines[e]!.trim() === "") break;
      backLines.push(lines[e]!);
      consumed.add(e);
    }
    if (frontLines.length === 0 || backLines.length === 0) continue;

    const schedules = parseSchedules(backLines.join("\n"));
    const front = frontLines.map(stripSr).join("\n").trim();
    const back = backLines.map(stripSr).join("\n").trim();
    cards.push({ front, back, note, kind: "multiline", schedule: schedules[0] ?? null });
    if (sep === "??") {
      cards.push({ front: back, back: front, note, kind: "multiline", schedule: schedules[1] ?? null });
    }
  }

  // Pass 2: single-line cards on every line not absorbed by a multi-line block.
  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue;
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "" || isTagOrHeading(line) || trimmed.startsWith("---")) continue;

    const body = stripSr(line);
    const schedules = parseSchedules(line);

    if (body.includes(":::")) {
      const idx = body.indexOf(":::");
      const front = body.slice(0, idx).trim();
      const back = body.slice(idx + 3).trim();
      if (!front || !back) continue;
      cards.push({ front, back, note, kind: "reversed", schedule: schedules[0] ?? null });
      cards.push({ front: back, back: front, note, kind: "reversed", schedule: schedules[1] ?? null });
    } else if (body.includes("::")) {
      const idx = body.indexOf("::");
      const front = body.slice(0, idx).trim();
      const back = body.slice(idx + 2).trim();
      if (!front || !back) continue;
      cards.push({ front, back, note, kind: "basic", schedule: schedules[0] ?? null });
    } else {
      const spans = [...body.matchAll(CLOZE)];
      if (spans.length === 0) continue;
      spans.forEach((_span, k) => {
        const { front, back } = buildCloze(body, spans, k);
        if (!front || !back) return;
        cards.push({ front, back, note, kind: "cloze", schedule: schedules[k] ?? null });
      });
    }
  }

  return cards;
}

// ---------------------------------------------------------------------------
// SM-2 -> FSRS conversion
// ---------------------------------------------------------------------------

/** Plugin sentinel for "queued but never actually reviewed" cloze deletions. */
const NEW_SENTINEL_YEAR = 2001;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Map an SM-2 ease factor to an FSRS difficulty (1..10, higher = harder).
 * SM-2 ease runs the other way (higher = easier), with 2.5 as its default, so
 * we invert around the FSRS midpoint: ease 2.5 -> ~5, 1.3 -> 10, ~3.1 -> ~2.5.
 * Lossy by nature — FSRS has no "ease" — which is why the raw value is retained
 * in the export.
 */
export function easeToDifficulty(easePerMille: number): number {
  const factor = easePerMille / 100; // 250 -> 2.5
  const difficulty = 10 - (factor - 1.3) * (9 / 1.8);
  return clamp(round2(difficulty), 1, 10);
}

function parseDueLocal(due: string): Date {
  const [y, m, d] = due.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

/**
 * Turn one SM-2 schedule into a Review-state ts-fsrs card. The interval seeds
 * FSRS stability (both are "days until ~90% retention"); ease seeds difficulty.
 * Returns null for the never-reviewed sentinel, signalling "treat as new".
 */
export function srScheduleToFsrsCard(s: SrSchedule, _now: Date): FsrsCard | null {
  const due = parseDueLocal(s.due);
  if (due.getFullYear() <= NEW_SENTINEL_YEAR) return null;
  const interval = Math.max(1, s.interval);
  return {
    due,
    stability: Math.max(interval, 0.1),
    difficulty: easeToDifficulty(s.ease),
    elapsed_days: interval,
    scheduled_days: interval,
    learning_steps: 0,
    reps: 1,
    lapses: 0,
    state: FsrsState.Review,
    last_review: new Date(due.getTime() - interval * 86_400_000),
  };
}

// ---------------------------------------------------------------------------
// Import: ParsedCard[] -> Deck + Card[]
// ---------------------------------------------------------------------------

export interface ImportObsidianOptions {
  now?: Date | number;
  deckId?: string;
  deckName?: string;
  /** Test seam for deterministic ids. */
  idFactory?: () => string;
}

export interface ImportObsidianResult {
  deck: Deck;
  cards: Card[];
  /** Notes that own the sibling cards (cloze groups + reversed pairs). */
  notes: Note[];
  /** How many cards were seeded with a preserved schedule vs. started new. */
  scheduled: number;
  fresh: number;
}

/** Build one Card row from a ParsedCard, preserving its SM-2 schedule if any. */
function parsedToCard(
  pc: ParsedCard,
  deckId: string,
  now: Date,
  id: string,
  noteId: string | null,
  template: number,
): { card: Card; scheduled: boolean } {
  const fsrsCard = pc.schedule ? srScheduleToFsrsCard(pc.schedule, now) : null;
  if (fsrsCard === null) {
    return {
      card: createCard({ deckId, front: pc.front, back: pc.back, now, id, noteId, template }),
      scheduled: false,
    };
  }
  return {
    card: {
      id,
      deck_id: deckId,
      front: pc.front,
      back: pc.back,
      note_id: noteId,
      template,
      source_task_id: null,
      created_at: now.getTime(),
      // Mirrors fsrs.ts syncScheduling: fsrs_state is source of truth, due and
      // state_label are denormalized for the indexed daily query.
      fsrs_state: JSON.stringify(fsrsCard),
      due: fsrsCard.due.getTime(),
      state_label: "review",
      ignored: false,
    },
    scheduled: true,
  };
}

/** Group key collapsing the directions of a reversed/multiline pair. */
function pairKey(pc: ParsedCard): string {
  return JSON.stringify([pc.front, pc.back].sort());
}
/** Group key collapsing the clozes of one source line (sentence with the answer spliced back). */
function clozeSentence(pc: ParsedCard): string {
  return pc.front.split("[...]").join(pc.back);
}

/**
 * Assemble a deck of Cards — and the Notes that own their sibling groups — from
 * an export. Cloze cards of one line collapse to a cloze note; the two
 * directions of a `:::`/`??` line collapse to a reversed note; everything else
 * stays a note-less basic card. Cards with a usable schedule keep their
 * preserved due/stability/difficulty; the rest start fresh via createCard.
 */
export function importObsidian(
  data: ObsidianExport,
  opts: ImportObsidianOptions = {},
): ImportObsidianResult {
  const nowMs =
    opts.now == null ? Date.now() : opts.now instanceof Date ? opts.now.getTime() : opts.now;
  const now = new Date(nowMs);
  const genId = opts.idFactory ?? newId;

  const deck: Deck = {
    id: opts.deckId ?? genId(),
    name: opts.deckName ?? data.deckName ?? "Obsidian Flashcards",
    created_at: nowMs,
  };

  const notes: Note[] = [];
  // Per-ParsedCard assignment, decided up-front so cards can still be emitted in
  // their original order (only the grouping into notes is order-independent).
  const assign = new Map<ParsedCard, { noteId: string | null; template: number }>();

  // Bucket the flat ParsedCard[] back into sibling groups.
  const clozeGroups = new Map<string, ParsedCard[]>();
  const pairGroups = new Map<string, ParsedCard[]>();
  for (const pc of data.cards) {
    if (pc.kind === "cloze") {
      const k = clozeSentence(pc);
      (clozeGroups.get(k) ?? clozeGroups.set(k, []).get(k)!).push(pc);
    } else if (pc.kind === "reversed" || pc.kind === "multiline") {
      const k = pairKey(pc);
      (pairGroups.get(k) ?? pairGroups.set(k, []).get(k)!).push(pc);
    }
    // basic + everything else default to note-less (see fallthrough below).
  }

  for (const group of clozeGroups.values()) {
    // Order siblings by span position so template = span index.
    const ordered = [...group].sort(
      (a, b) => a.front.indexOf("[...]") - b.front.indexOf("[...]"),
    );
    const text = reconstructClozeText(ordered);
    if (text === null) continue; // couldn't invert -> stays note-less
    const note: Note = {
      id: genId(),
      deck_id: deck.id,
      kind: "cloze",
      fields: JSON.stringify({ text }),
      source_task_id: null,
      created_at: nowMs,
    };
    notes.push(note);
    ordered.forEach((pc, i) => assign.set(pc, { noteId: note.id, template: i }));
  }

  for (const group of pairGroups.values()) {
    if (group.length < 2) continue; // lone basic multiline -> note-less
    const [fwd, ...rest] = group;
    const note: Note = {
      id: genId(),
      deck_id: deck.id,
      kind: "reversed",
      fields: JSON.stringify({ front: fwd!.front, back: fwd!.back }),
      source_task_id: null,
      created_at: nowMs,
    };
    notes.push(note);
    assign.set(fwd!, { noteId: note.id, template: 0 });
    rest.forEach((pc) => assign.set(pc, { noteId: note.id, template: 1 }));
  }

  const cards: Card[] = [];
  let scheduled = 0;
  let fresh = 0;
  for (const pc of data.cards) {
    const a = assign.get(pc) ?? { noteId: null, template: 0 };
    const { card, scheduled: sched } = parsedToCard(pc, deck.id, now, genId(), a.noteId, a.template);
    cards.push(card);
    if (sched) scheduled++;
    else fresh++;
  }

  return { deck, cards, notes, scheduled, fresh };
}
