import { State as FsrsState, type Card as FsrsCard } from "ts-fsrs";
import { createCard } from "./fsrs";
import { newId } from "./id";
import type { Deck, Card } from "../db/schema";

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
const CLOZE = /==(.+?)==/g;

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
 * Build one cloze card: blank the `target`-th `==span==`, reveal the rest.
 * Front = sentence with the target replaced by "[...]"; back = the target text.
 */
function buildCloze(
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
  /** How many cards were seeded with a preserved schedule vs. started new. */
  scheduled: number;
  fresh: number;
}

/**
 * Assemble a single deck of Card rows from an export. Cards with a usable
 * schedule are seeded in Review state with their preserved due/stability/
 * difficulty; everything else (no schedule, or the new-sentinel) starts fresh
 * via the same createCard path Anki import uses.
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

  const cards: Card[] = [];
  let scheduled = 0;
  let fresh = 0;
  for (const pc of data.cards) {
    const fsrsCard = pc.schedule ? srScheduleToFsrsCard(pc.schedule, now) : null;
    if (fsrsCard === null) {
      cards.push(createCard({ deckId: deck.id, front: pc.front, back: pc.back, now, id: genId() }));
      fresh++;
    } else {
      cards.push({
        id: genId(),
        deck_id: deck.id,
        front: pc.front,
        back: pc.back,
        source_task_id: null,
        created_at: nowMs,
        // Mirrors fsrs.ts syncScheduling: fsrs_state is source of truth, due
        // and state_label are denormalized for the indexed daily query.
        fsrs_state: JSON.stringify(fsrsCard),
        due: fsrsCard.due.getTime(),
        state_label: "review",
        ignored: false,
      });
      scheduled++;
    }
  }

  return { deck, cards, scheduled, fresh };
}
