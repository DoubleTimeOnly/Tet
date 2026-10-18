import { DateTime } from "luxon";
import { startOfTetDay, type Instant } from "./dayKey";
import { newId } from "./id";
import type { Excerpt, ExcerptReview, Task } from "../db/schema";
import type { ReadwiseHighlight } from "./readwiseHighlights";

/**
 * Excerpt review — incremental reading over Readwise highlights. Pure and
 * unit-tested; services/excerpts wires it to the Store.
 *
 * Each excerpt is triaged until it is resolved:
 *   - Ignore     -> never shown again.
 *   - Pass       -> shown again later, at a growing interval (PASS_INTERVAL_DAYS).
 *   - Set aside  -> parked in a pile to combine with others into one card.
 *   - Make card  -> a front/back card is written from it; it leaves the queue.
 */

// ---------------------------------------------------------------------------
// Pass: growing interval, capped

/**
 * Days until a passed excerpt comes back, indexed by how many times it had
 * already been passed. Grows roughly x3 per pass, like an SRS interval, but
 * there is no recall to grade here, so a fixed ladder stands in for FSRS.
 */
export const PASS_INTERVAL_DAYS = [3, 10, 30] as const;

/**
 * After this many passes an excerpt must be resolved (carded or ignored) or
 * set aside — Pass is no longer offered. Without a cap a highlight you keep
 * shrugging at would come back forever; three looks spread over ~6 weeks is
 * enough to know whether it's worth a card.
 */
export const MAX_PASSES = PASS_INTERVAL_DAYS.length;

export function canPass(excerpt: Excerpt): boolean {
  return excerpt.pass_count < MAX_PASSES;
}

/**
 * Apply a Pass: push `due` out to the start of the Tet day `n` days from now
 * (so it's waiting first thing that morning rather than at an arbitrary hour),
 * bump the pass count, and lift it out of the backlog so it queues by date.
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
  return { ...excerpt, due: later, pass_count: excerpt.pass_count + 1, backlog: false };
}

// ---------------------------------------------------------------------------
// Queue order

/** Unresolved, not deleted in Readwise, and in the given status. */
function live(e: Excerpt, status: Excerpt["status"]): boolean {
  return e.status === status && !e.source_deleted;
}

/**
 * Stable pseudo-random rank from an id (FNV-1a). Backlog excerpts are shown in
 * this order so a 3,000-highlight import mixes books instead of serving one
 * book's highlights in a row, and the order doesn't reshuffle between opens.
 */
export function shuffleRank(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Queued excerpts ready to review now, in the order they should be shown:
 * recent highlights and passed excerpts that have come due first (oldest due
 * first), then the backlog in its stable shuffled order.
 */
export function excerptQueue(excerpts: Excerpt[], now: Instant): Excerpt[] {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const ready = excerpts.filter((e) => live(e, "queued") && e.due <= nowMs);
  const fresh = ready.filter((e) => !e.backlog).sort((a, b) => a.due - b.due);
  const backlog = ready
    .filter((e) => e.backlog)
    .sort((a, b) => shuffleRank(a.id) - shuffleRank(b.id));
  return [...fresh, ...backlog];
}

/** The set-aside pile, grouped by book so related excerpts sit together. */
export function setAsidePile(excerpts: Excerpt[]): Excerpt[] {
  return excerpts
    .filter((e) => live(e, "set_aside"))
    .sort((a, b) => a.book_title.localeCompare(b.book_title) || a.created_at - b.created_at);
}

// ---------------------------------------------------------------------------
// Daily progress

/**
 * Writing a card is worth this many points toward the daily excerpt goal; any
 * other decision is worth 1. A card takes several times longer than a triage
 * tap, and counting it as 1 would quietly reward passing over carding — the
 * one outcome the whole feature exists to produce.
 */
export const CARD_POINTS = 3;

/** Default daily goal for a new excerpt task ("review 10 excerpts"). */
export const DEFAULT_EXCERPT_CADENCE = 10;

/**
 * Points earned by a set of decisions. A combined card writes one `card` row
 * per excerpt it used, so cards are counted by distinct card_id. Pulling an
 * excerpt back out of the pile is housekeeping and earns nothing.
 */
export function excerptPoints(reviews: ExcerptReview[]): number {
  const cards = new Set<string>();
  let points = 0;
  for (const r of reviews) {
    if (r.action === "card") cards.add(r.card_id ?? r.id);
    else if (r.action !== "unset_aside") points += 1;
  }
  return points + cards.size * CARD_POINTS;
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
  /** Points earned today. */
  pointsToday: number;
  /** max(0, goal - pointsToday). */
  remaining: number;
  /** Excerpts to show now, in order, length <= remaining. */
  queue: Excerpt[];
  /** Every queued excerpt ready now (the queue is a prefix of this). */
  readyCount: number;
  /** Size of the set-aside pile. */
  setAsideCount: number;
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
  todaysReviews: ExcerptReview[],
  now: Instant,
): ExcerptSlice {
  const ready = excerptQueue(excerpts, now);
  const pointsToday = excerptPoints(todaysReviews);
  const handled = excerptsHandled(todaysReviews).size;
  const goal = Math.min(task.cadence, handled + ready.length);
  const remaining = Math.max(0, goal - pointsToday);
  return {
    goal,
    pointsToday,
    remaining,
    queue: ready.slice(0, remaining),
    readyCount: ready.length,
    setAsideCount: setAsidePile(excerpts).length,
    done: pointsToday >= goal,
  };
}

// ---------------------------------------------------------------------------
// Readwise sync

/**
 * On the very first import, highlights older than this are the backlog; newer
 * ones are treated as fresh so what you highlighted this week comes up first.
 */
export const BACKLOG_GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

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
 *   - New highlight            -> queued, due now. On the first import (no
 *                                 excerpts yet) anything older than
 *                                 BACKLOG_GRACE_DAYS is flagged backlog.
 *   - Same readwise id again   -> never a second excerpt. If the text, note or
 *                                 source changed, the stored copy is updated in
 *                                 place, whatever its status — a card already
 *                                 written from it is yours and is not touched.
 *   - Deleted / discarded      -> marked source_deleted: drops out of the queue
 *                                 and pile; a carded excerpt keeps its card.
 *   - Same text in same book   -> skipped (one highlight synced from two
 *                                 sources, e.g. Kindle and Reader).
 */
export function planSync(
  existing: Excerpt[],
  incoming: ReadwiseHighlight[],
  now: number,
  opts: { newId?: () => string } = {},
): SyncPlan {
  const makeId = opts.newId ?? newId;
  const firstImport = existing.length === 0;
  const byReadwiseId = new Map(existing.map((e) => [e.readwise_id, e]));
  const seenText = new Set(
    existing.filter((e) => !e.source_deleted).map((e) => dedupKey(e.book_title, e.text)),
  );
  const inserts: Excerpt[] = [];
  const updates = new Map<string, Excerpt>();

  for (const h of incoming) {
    const current = updates.get(h.id) ?? byReadwiseId.get(h.id);
    if (current) {
      const next: Excerpt = {
        ...current,
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
    if (h.deleted || !h.text.trim()) continue;
    const key = dedupKey(h.bookTitle, h.text);
    if (seenText.has(key)) continue;
    seenText.add(key);

    const highlightedAt = h.highlightedAt ?? h.updatedAt;
    const e: Excerpt = {
      id: makeId(),
      readwise_id: h.id,
      text: h.text,
      note: h.note,
      book_title: h.bookTitle,
      book_author: h.bookAuthor,
      url: h.url,
      highlighted_at: h.highlightedAt,
      source_updated_at: h.updatedAt,
      source_deleted: false,
      backlog: firstImport && highlightedAt < now - BACKLOG_GRACE_DAYS * DAY_MS,
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
 * Incremental-sync cursor: the newest Readwise updated_at already stored.
 * Derived rather than persisted, so a backup restore carries it for free.
 * Null when nothing is stored yet (fetch the full export).
 */
export function syncCursor(excerpts: Excerpt[]): number | null {
  if (excerpts.length === 0) return null;
  return excerpts.reduce((max, e) => Math.max(max, e.source_updated_at), 0);
}
