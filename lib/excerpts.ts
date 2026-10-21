import { DateTime } from "luxon";
import { startOfTetDay, type Instant } from "./dayKey";
import { newId } from "./id";
import type { Excerpt, ExcerptReview, ExcerptSource, Task } from "../db/schema";
import type { ReadwiseBook, ReadwiseHighlight } from "./readwiseHighlights";

/**
 * Excerpt review — incremental reading over Readwise highlights. Pure and
 * unit-tested; services/excerpts wires it to the Store.
 *
 * Highlights come only from sources you check. Each excerpt is triaged until
 * it is resolved:
 *   - Ignore     -> never shown again.
 *   - Later      -> (daily review) back in 2, then 5, then 7 days.
 *   - Skip       -> (focus mode) to the end of this session; nothing stored.
 *   - Set aside  -> parked in a pile to combine with others into one card.
 *   - Make card  -> a front/back card is written from it; it leaves the queue.
 *
 * Two ways to work through excerpts, kept separate:
 *   - Daily review: a points goal per day, drawn from checked sources in rank
 *     order, one source at a time (block order), each in book order.
 *   - Focus mode: every undecided excerpt of one source, in book order,
 *     regardless of schedule or rank, until none are left.
 */

// ---------------------------------------------------------------------------
// Later: growing interval, capped

/**
 * Days until an excerpt deferred with Later comes back, indexed by how many
 * times it had already been deferred. About two weeks in total — long enough
 * to come back to it fresh, short enough not to lose track of it.
 */
export const PASS_INTERVAL_DAYS = [2, 5, 7] as const;

/**
 * After this many Laters an excerpt must be decided (carded, set aside or
 * ignored) — Later is no longer offered. Without a cap a highlight you keep
 * shrugging at would come back forever.
 */
export const MAX_PASSES = PASS_INTERVAL_DAYS.length;

export function canPass(excerpt: Excerpt): boolean {
  return excerpt.pass_count < MAX_PASSES;
}

/**
 * Apply a Later: push `due` out to the start of the Tet day `n` days from now
 * (so it's waiting first thing that morning rather than at an arbitrary hour)
 * and bump the count.
 */
export function passExcerpt(excerpt: Excerpt, now: Instant, tz: string): Excerpt {
  if (!canPass(excerpt)) {
    throw new Error(`passExcerpt: ${excerpt.id} already passed ${excerpt.pass_count} times`);
  }
  const days = PASS_INTERVAL_DAYS[excerpt.pass_count]!;
  const nowMs = now instanceof Date ? now.getTime() : now;
  const later = DateTime.fromMillis(startOfTetDay(nowMs, tz), { zone: tz })
    .plus({ days })
    .toMillis();
  return { ...excerpt, due: later, pass_count: excerpt.pass_count + 1 };
}

// ---------------------------------------------------------------------------
// Queue order

/** In the given status and not deleted in Readwise. */
function live(e: Excerpt, status: Excerpt["status"]): boolean {
  return e.status === status && !e.source_deleted;
}

/** Undecided: still waiting for Ignore / Set aside / Make card. */
export function isUndecided(e: Excerpt): boolean {
  return live(e, "queued");
}

/** Book order within a source: Readwise location, then when highlighted. */
export function bookOrder(a: Excerpt, b: Excerpt): number {
  return (
    nullsLast(a.location, b.location) ||
    nullsLast(a.highlighted_at, b.highlighted_at) ||
    a.created_at - b.created_at ||
    a.id.localeCompare(b.id)
  );
}

function nullsLast(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** Checked sources, top priority first. */
export function rankedSources(sources: ExcerptSource[]): ExcerptSource[] {
  return sources
    .filter((s) => s.state === "checked")
    .sort((a, b) => a.rank - b.rank || a.created_at - b.created_at);
}

/**
 * The daily queue: undecided excerpts whose time has come, from checked
 * sources only, in block order — every ready excerpt of the top-ranked source,
 * then the next source, each in book order. An excerpt deferred with Later
 * slots back in by its source's rank, not ahead of it, so blocks stay intact.
 */
export function excerptQueue(
  excerpts: Excerpt[],
  sources: ExcerptSource[],
  now: Instant,
): Excerpt[] {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const position = new Map(rankedSources(sources).map((s, i) => [s.id, i]));
  return excerpts
    .filter((e) => isUndecided(e) && e.due <= nowMs && e.source_id !== null && position.has(e.source_id))
    .sort((a, b) => position.get(a.source_id!)! - position.get(b.source_id!)! || bookOrder(a, b));
}

/**
 * Focus mode: every undecided excerpt of one source, in book order — including
 * ones deferred with Later whose date hasn't come. Ignores rank and schedule.
 */
export function focusQueue(excerpts: Excerpt[], sourceId: string): Excerpt[] {
  return excerpts.filter((e) => e.source_id === sourceId && isUndecided(e)).sort(bookOrder);
}

/**
 * Apply a focus session's skips: skipped excerpts move to the end, in the
 * order they were skipped. Skips live only in the session — nothing is stored.
 */
export function withSkipsLast(queue: Excerpt[], skipped: string[]): Excerpt[] {
  const skippedSet = new Set(skipped);
  const byId = new Map(queue.map((e) => [e.id, e]));
  return [
    ...queue.filter((e) => !skippedSet.has(e.id)),
    ...skipped.map((id) => byId.get(id)).filter((e): e is Excerpt => e !== undefined),
  ];
}

/** The set-aside pile, grouped by book so related excerpts sit together. */
export function setAsidePile(excerpts: Excerpt[]): Excerpt[] {
  return excerpts
    .filter((e) => live(e, "set_aside"))
    .sort((a, b) => a.book_title.localeCompare(b.book_title) || bookOrder(a, b));
}

// ---------------------------------------------------------------------------
// Daily progress

/**
 * Writing a card is worth this many points toward the daily excerpt goal; any
 * other decision is worth 1. A card takes several times longer than a triage
 * tap, and counting it as 1 would quietly reward deferring over carding — the
 * one outcome the whole feature exists to produce.
 */
export const CARD_POINTS = 3;

/** An excerpt task's own card value (Task.meta `cardPoints`), else CARD_POINTS. */
export function cardPointsOf(task: Pick<Task, "meta"> | null | undefined): number {
  try {
    const n = Number(JSON.parse(task?.meta ?? "null")?.cardPoints);
    return Number.isInteger(n) && n >= 1 ? n : CARD_POINTS;
  } catch {
    return CARD_POINTS;
  }
}

/** Task.meta with `cardPoints` set (clamped to a whole number >= 1), other keys kept. */
export function withCardPoints(meta: string | null, points: number): string {
  let rest: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(meta ?? "null");
    if (parsed && typeof parsed === "object") rest = parsed;
  } catch {
    // unreadable meta: start over
  }
  return JSON.stringify({ ...rest, cardPoints: Math.max(1, Math.round(points) || CARD_POINTS) });
}

/** Default daily goal for a new excerpt task. */
export const DEFAULT_EXCERPT_CADENCE = 10;

/**
 * Points earned by a set of decisions. A combined card writes one `card` row
 * per excerpt it used, so cards are counted by distinct card_id. Pulling an
 * excerpt back out of the pile is housekeeping and earns nothing (and a focus
 * Skip writes no row at all).
 */
export function excerptPoints(reviews: ExcerptReview[], cardPoints: number = CARD_POINTS): number {
  const cards = new Set<string>();
  let points = 0;
  for (const r of reviews) {
    if (r.action === "card") cards.add(r.card_id ?? r.id);
    else if (r.action !== "unset_aside") points += 1;
  }
  return points + cards.size * cardPoints;
}

/**
 * Excerpts decided on, by id. Pulling one back out of the pile doesn't count:
 * it returns to the queue, undecided.
 */
export function excerptsHandled(reviews: ExcerptReview[]): Set<string> {
  return new Set(reviews.filter((r) => r.action !== "unset_aside").map((r) => r.excerpt_id));
}

/** Daily review state for an excerpt task — the excerpt analogue of FlashcardSlice. */
export interface ExcerptSlice {
  /** Daily goal: the task's cadence, capped to what's achievable today. */
  goal: number;
  /** What a card counts for this task. */
  cardPoints: number;
  /** Points earned today (daily review and focus sessions alike). */
  pointsToday: number;
  /** max(0, goal - pointsToday). */
  remaining: number;
  /** Excerpts to show now, in order, length <= remaining. */
  queue: Excerpt[];
  /** Every excerpt in the daily queue now (the queue is a prefix of this). */
  readyCount: number;
  /** Size of the set-aside pile. */
  setAsideCount: number;
  /** Sources flagged new since an earlier refresh, awaiting a decision. */
  newSourceCount: number;
  done: boolean;
}

/**
 * Like flashcardSlice, the goal is capped to what's achievable, so a
 * near-empty queue completes at what's there and an empty one auto-completes
 * rather than stalling the day. The cap counts excerpts (handled today + still
 * ready) rather than points, so it holds still through the day: deciding on an
 * excerpt moves it from one side to the other, and a card's extra points
 * count toward the goal instead of raising it.
 *
 * @param todaysReviews decisions made since today's 4am boundary.
 */
export function excerptSlice(
  task: Task,
  excerpts: Excerpt[],
  sources: ExcerptSource[],
  todaysReviews: ExcerptReview[],
  now: Instant,
): ExcerptSlice {
  const ready = excerptQueue(excerpts, sources, now);
  const cardPoints = cardPointsOf(task);
  const pointsToday = excerptPoints(todaysReviews, cardPoints);
  const handled = excerptsHandled(todaysReviews).size;
  const goal = Math.min(task.cadence, handled + ready.length);
  const remaining = Math.max(0, goal - pointsToday);
  return {
    goal,
    cardPoints,
    pointsToday,
    remaining,
    queue: ready.slice(0, remaining),
    readyCount: ready.length,
    setAsideCount: setAsidePile(excerpts).length,
    newSourceCount: sources.filter((s) => s.state === "new").length,
    done: pointsToday >= goal,
  };
}

// ---------------------------------------------------------------------------
// Sources

export interface SourceStats {
  undecided: number;
  setAside: number;
  carded: number;
  ignored: number;
}

/** Per-source tallies, for the Sources screen and the done-source record. */
export function sourceStats(excerpts: Excerpt[]): Map<string, SourceStats> {
  const out = new Map<string, SourceStats>();
  for (const e of excerpts) {
    if (!e.source_id || e.source_deleted) continue;
    let s = out.get(e.source_id);
    if (!s) {
      s = { undecided: 0, setAside: 0, carded: 0, ignored: 0 };
      out.set(e.source_id, s);
    }
    if (e.status === "queued") s.undecided++;
    else if (e.status === "set_aside") s.setAside++;
    else if (e.status === "carded") s.carded++;
    else if (e.status === "ignored") s.ignored++;
  }
  return out;
}

/** Rank for a source joining the checked list: at the bottom. */
export function nextRank(sources: ExcerptSource[]): number {
  const ranks = sources.filter((s) => s.state === "checked").map((s) => s.rank);
  return ranks.length === 0 ? 0 : Math.max(...ranks) + 1;
}

/**
 * Move one checked source up or down a place. Returns the checked sources with
 * ranks rewritten 0..n-1 in the new order (only the ones whose rank changed
 * need saving, but writing them all keeps ranks dense).
 */
export function moveSource(
  sources: ExcerptSource[],
  id: string,
  direction: "up" | "down",
): ExcerptSource[] {
  const ordered = rankedSources(sources);
  const i = ordered.findIndex((s) => s.id === id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i >= 0 && j >= 0 && j < ordered.length) {
    [ordered[i], ordered[j]] = [ordered[j]!, ordered[i]!];
  }
  return ordered.map((s, rank) => ({ ...s, rank }));
}

function normTitle(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface SourcePlan {
  inserts: ExcerptSource[];
  /** Existing sources whose stored row changed (title, counts, adopted book id). */
  updates: ExcerptSource[];
  /** Of `inserts`, how many were flagged new (vs. unchecked on first refresh). */
  newCount: number;
}

/**
 * Merge a refreshed Readwise book list into the local sources.
 *
 *   - Unknown book         -> inserted unchecked on the very first refresh
 *                             (nothing is synced until you choose), and flagged
 *                             `new` on every refresh after that.
 *   - Known book           -> title/author/counts refreshed; state untouched,
 *                             so a hidden source stays hidden however many
 *                             highlights it gains.
 *   - Legacy source (no book id, rebuilt from excerpts imported before sources
 *     existed) -> adopts the book id of the book with the same title.
 *
 * A book that disappears from the list is left alone.
 */
export function planSources(
  existing: ExcerptSource[],
  books: ReadwiseBook[],
  now: number,
  opts: { newId?: () => string } = {},
): SourcePlan {
  const makeId = opts.newId ?? newId;
  const firstRefresh = !existing.some((s) => s.readwise_book_id !== null);
  const byBookId = new Map(
    existing.filter((s) => s.readwise_book_id !== null).map((s) => [s.readwise_book_id!, s]),
  );
  const legacyByTitle = new Map(
    existing.filter((s) => s.readwise_book_id === null).map((s) => [normTitle(s.title), s]),
  );
  const inserts: ExcerptSource[] = [];
  const updates: ExcerptSource[] = [];

  for (const b of books) {
    const current = byBookId.get(b.id) ?? legacyByTitle.get(normTitle(b.title));
    if (current) {
      legacyByTitle.delete(normTitle(current.title));
      const next: ExcerptSource = {
        ...current,
        readwise_book_id: b.id,
        title: b.title,
        author: b.author,
        category: b.category,
        num_highlights: b.numHighlights,
        last_highlight_at: b.lastHighlightAt,
      };
      byBookId.set(b.id, next);
      if (!sameSource(current, next)) updates.push(next);
      continue;
    }
    const s: ExcerptSource = {
      id: makeId(),
      readwise_book_id: b.id,
      title: b.title,
      author: b.author,
      category: b.category,
      num_highlights: b.numHighlights,
      last_highlight_at: b.lastHighlightAt,
      state: firstRefresh ? "unchecked" : "new",
      rank: 0,
      created_at: now,
      done_at: null,
    };
    inserts.push(s);
    byBookId.set(b.id, s);
  }
  return {
    inserts,
    updates,
    newCount: inserts.filter((s) => s.state === "new").length,
  };
}

function sameSource(a: ExcerptSource, b: ExcerptSource): boolean {
  return (
    a.readwise_book_id === b.readwise_book_id &&
    a.title === b.title &&
    a.author === b.author &&
    a.category === b.category &&
    a.num_highlights === b.num_highlights &&
    a.last_highlight_at === b.last_highlight_at
  );
}

/**
 * Excerpts imported before sources existed carry no source_id. Rebuild one
 * checked source per book title (reusing a source of that title if there is
 * one) so they stay in the queue; the next refresh adopts the Readwise id.
 */
export function backfillSources(
  excerpts: Excerpt[],
  sources: ExcerptSource[],
  now: number,
  opts: { newId?: () => string } = {},
): { sources: ExcerptSource[]; excerpts: Excerpt[] } {
  const orphans = excerpts.filter((e) => e.source_id === null);
  if (orphans.length === 0) return { sources: [], excerpts: [] };
  const makeId = opts.newId ?? newId;
  const byTitle = new Map(sources.map((s) => [normTitle(s.title), s]));
  const created: ExcerptSource[] = [];
  let rank = nextRank(sources);
  const updated = orphans.map((e) => {
    const key = normTitle(e.book_title);
    let s = byTitle.get(key);
    if (!s) {
      s = {
        id: makeId(),
        readwise_book_id: null,
        title: e.book_title,
        author: e.book_author,
        category: null,
        num_highlights: 0,
        last_highlight_at: null,
        state: "checked",
        rank: rank++,
        created_at: now,
        done_at: null,
      };
      byTitle.set(key, s);
      created.push(s);
    }
    return { ...e, source_id: s.id };
  });
  return { sources: created, excerpts: updated };
}

// ---------------------------------------------------------------------------
// Highlight sync

/** Normalised text+book key: catches one highlight synced in from two sources. */
export function dedupKey(bookTitle: string, text: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return `${norm(bookTitle)}\u0000${norm(text)}`;
}

export interface SyncPlan {
  inserts: Excerpt[];
  /** Existing excerpts whose stored row changed (edited or deleted upstream). */
  updates: Excerpt[];
  /** Of `updates`, how many were newly marked deleted. */
  removed: number;
}

/**
 * Merge a batch of Readwise highlights into the local excerpts.
 *
 *   - New highlight            -> queued, due now, under its source. Skipped
 *                                 if its book isn't a known source.
 *   - Same readwise id again   -> never a second excerpt. If the text, note,
 *                                 position or source changed, the stored copy
 *                                 is updated in place, whatever its status — a
 *                                 card already written from it is not touched.
 *   - Deleted / discarded      -> marked source_deleted: drops out of the queue
 *                                 and pile; a carded excerpt keeps its card.
 *   - Same text in same book   -> skipped (one highlight synced from two
 *                                 sources, e.g. Kindle and Reader).
 */
export function planSync(
  existing: Excerpt[],
  incoming: ReadwiseHighlight[],
  sourceByBookId: Map<string, ExcerptSource>,
  now: number,
  opts: { newId?: () => string } = {},
): SyncPlan {
  const makeId = opts.newId ?? newId;
  const byReadwiseId = new Map(existing.map((e) => [e.readwise_id, e]));
  const seenText = new Set(
    existing.filter((e) => !e.source_deleted).map((e) => dedupKey(e.book_title, e.text)),
  );
  const inserts: Excerpt[] = [];
  const updates = new Map<string, Excerpt>();

  for (const h of incoming) {
    const current = byReadwiseId.get(h.id);
    if (current) {
      const next: Excerpt = {
        ...current,
        source_id: sourceByBookId.get(h.bookId)?.id ?? current.source_id,
        location: h.location ?? current.location,
        text: h.deleted ? current.text : h.text,
        note: h.deleted ? current.note : h.note,
        book_title: h.bookTitle,
        book_author: h.bookAuthor,
        url: h.url ?? current.url,
        source_updated_at: Math.max(current.source_updated_at, h.updatedAt),
        source_deleted: h.deleted,
      };
      if (!sameStored(current, next)) {
        updates.set(h.id, next);
        byReadwiseId.set(h.id, next);
      }
      continue;
    }
    const source = sourceByBookId.get(h.bookId);
    if (!source || h.deleted || !h.text.trim()) continue;
    const key = dedupKey(h.bookTitle, h.text);
    if (seenText.has(key)) continue;
    seenText.add(key);

    const e: Excerpt = {
      id: makeId(),
      readwise_id: h.id,
      source_id: source.id,
      location: h.location,
      text: h.text,
      note: h.note,
      book_title: h.bookTitle,
      book_author: h.bookAuthor,
      url: h.url,
      highlighted_at: h.highlightedAt,
      source_updated_at: h.updatedAt,
      source_deleted: false,
      status: "queued",
      due: now,
      pass_count: 0,
      created_at: now,
      resolved_at: null,
    };
    inserts.push(e);
    byReadwiseId.set(h.id, e);
  }
  // A highlight edited after being inserted in this same batch: fold it in.
  const insertIds = new Set(inserts.map((e) => e.readwise_id));
  const finalUpdates = [...updates.values()].filter((e) => !insertIds.has(e.readwise_id));
  const original = new Map(existing.map((e) => [e.readwise_id, e]));
  return {
    inserts: inserts.map((e) => byReadwiseId.get(e.readwise_id) ?? e),
    updates: finalUpdates,
    removed: finalUpdates.filter(
      (e) => e.source_deleted && !original.get(e.readwise_id)?.source_deleted,
    ).length,
  };
}

function sameStored(a: Excerpt, b: Excerpt): boolean {
  return (
    a.source_id === b.source_id &&
    a.location === b.location &&
    a.text === b.text &&
    a.note === b.note &&
    a.book_title === b.book_title &&
    a.book_author === b.book_author &&
    a.url === b.url &&
    a.source_updated_at === b.source_updated_at &&
    a.source_deleted === b.source_deleted
  );
}

/**
 * Incremental-sync cursor for one source: the newest Readwise updated_at
 * stored for it. Derived rather than persisted, so a backup restore carries it
 * for free, and unchecking then rechecking a source resumes where it left off.
 * Null when nothing of it is stored yet (fetch all of its highlights).
 */
export function syncCursor(excerpts: Excerpt[], sourceId: string): number | null {
  let max: number | null = null;
  for (const e of excerpts) {
    if (e.source_id === sourceId && (max === null || e.source_updated_at > max)) {
      max = e.source_updated_at;
    }
  }
  return max;
}
