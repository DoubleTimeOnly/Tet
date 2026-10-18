import type { Store } from "../db/store";
import type { Card, Excerpt, ExcerptReview } from "../db/schema";
import type { ReadwiseHighlightsClient } from "../lib/readwiseHighlights";
import {
  planSync,
  syncCursor,
  passExcerpt,
  DEFAULT_EXCERPT_CADENCE,
} from "../lib/excerpts";
import { newId } from "../lib/id";
import { addCard, createTask, findOrCreateDeck } from "./authoring";
import { creditExcerptTasks } from "./learning";

/**
 * Excerpt review orchestration: Readwise sync, triage decisions (with undo),
 * and writing a card from one or several excerpts. Pure rules live in
 * lib/excerpts; this file only sequences Store reads and writes.
 */

/** Cards written from excerpts land here, so an "all decks" review picks them up. */
export const EXCERPT_DECK_NAME = "Readwise excerpts";
export const EXCERPT_TASK_TITLE = "Review excerpts";

export interface SyncResult {
  added: number;
  updated: number;
  /** Unresolved excerpts that dropped out because they were deleted upstream. */
  removed: number;
}

/**
 * Pull highlights changed since the last sync and merge them in (see
 * lib/excerpts.planSync for the rules). The first sync that brings in any
 * excerpts also creates the daily "Review excerpts" task, unless an excerpt
 * task already exists — including a removed one, so deleting it sticks.
 */
export async function syncExcerpts(
  store: Store,
  client: ReadwiseHighlightsClient,
  now: number = Date.now(),
): Promise<SyncResult> {
  const existing = await store.listExcerpts();
  const incoming = await client.exportHighlights(syncCursor(existing));
  const plan = planSync(existing, incoming, now);
  await store.insertExcerpts(plan.inserts);
  await store.updateExcerpts(plan.updates);

  if (plan.inserts.length > 0) {
    const tasks = await store.listTasks();
    if (!tasks.some((t) => t.type === "excerpt")) {
      await createTask(
        store,
        { type: "excerpt", title: EXCERPT_TASK_TITLE, cadence: DEFAULT_EXCERPT_CADENCE },
        now,
      );
    }
  }
  return { added: plan.inserts.length, updated: plan.updates.length, removed: plan.removed };
}

/** A triage decision that can be taken back (a mis-tap on a phone). */
export interface UndoToken {
  previous: Excerpt;
  reviewId: string;
}

export type TriageAction = "ignore" | "pass" | "set_aside";

/** Ignore, Pass, or Set aside one excerpt; logs the decision toward today's goal. */
export async function decideExcerpt(
  store: Store,
  excerptId: string,
  action: TriageAction,
  now: number,
  tz: string,
): Promise<UndoToken> {
  const previous = await store.getExcerpt(excerptId);
  if (!previous) throw new Error(`decideExcerpt: no excerpt ${excerptId}`);
  const next: Excerpt =
    action === "pass"
      ? passExcerpt(previous, now, tz)
      : action === "ignore"
        ? { ...previous, status: "ignored", resolved_at: now }
        : { ...previous, status: "set_aside" };
  const review: ExcerptReview = {
    id: newId(),
    excerpt_id: excerptId,
    action,
    card_id: null,
    reviewed_at: now,
  };
  await store.updateExcerpts([next]);
  await store.insertExcerptReviews([review]);
  await creditExcerptTasks(store, now, tz);
  return { previous, reviewId: review.id };
}

/**
 * Restore the excerpt and drop the decision's row. A completion already
 * credited by that decision stays — the day was earned in good faith, and
 * un-crediting would need completions to be deletable, which nothing else does.
 */
export async function undoExcerptDecision(store: Store, undo: UndoToken): Promise<void> {
  await store.updateExcerpts([undo.previous]);
  await store.deleteExcerptReview(undo.reviewId);
}

/** Pull an excerpt back out of the set-aside pile, uncarded; it's due again now. */
export async function returnToQueue(
  store: Store,
  excerptId: string,
  now: number = Date.now(),
): Promise<void> {
  const e = await store.getExcerpt(excerptId);
  if (!e || e.status !== "set_aside") return;
  await store.updateExcerpts([{ ...e, status: "queued", due: now }]);
  await store.insertExcerptReviews([
    { id: newId(), excerpt_id: excerptId, action: "unset_aside", card_id: null, reviewed_at: now },
  ]);
}

/**
 * Write one plain front/back card from one or more excerpts. The card joins
 * the regular flashcard reviews (in the "Readwise excerpts" deck), each
 * excerpt is marked carded and linked to the card, and the card counts toward
 * today's excerpt goal once, however many excerpts it combined.
 */
export async function cardFromExcerpts(
  store: Store,
  excerptIds: string[],
  front: string,
  back: string,
  now: number,
  tz: string,
): Promise<Card> {
  const f = front.trim();
  const b = back.trim();
  if (!f || !b) throw new Error("cardFromExcerpts: front and back are required");
  if (excerptIds.length === 0) throw new Error("cardFromExcerpts: no excerpts");
  const excerpts = await Promise.all(excerptIds.map((id) => store.getExcerpt(id)));
  const missing = excerptIds.filter((_, i) => !excerpts[i]);
  if (missing.length > 0) throw new Error(`cardFromExcerpts: no excerpt ${missing[0]}`);

  const deck = await findOrCreateDeck(store, EXCERPT_DECK_NAME, now);
  const card = await addCard(store, { deckId: deck.id, front: f, back: b }, now);
  await store.insertCardExcerpts(excerptIds.map((id) => ({ card_id: card.id, excerpt_id: id })));
  await store.updateExcerpts(
    excerpts.map((e) => ({ ...e!, status: "carded" as const, resolved_at: now })),
  );
  await store.insertExcerptReviews(
    excerptIds.map((id) => ({
      id: newId(),
      excerpt_id: id,
      action: "card" as const,
      card_id: card.id,
      reviewed_at: now,
    })),
  );
  await creditExcerptTasks(store, now, tz);
  return card;
}

export interface ExcerptCounts {
  /** Queued and ready now. */
  ready: number;
  /** Queued but passed, waiting for their next showing. */
  waiting: number;
  /** Of `ready`, how many are from the initial backlog. */
  backlog: number;
  setAside: number;
  carded: number;
  ignored: number;
}

/** Totals for the Library's excerpt summary. Excludes upstream-deleted excerpts. */
export async function excerptCounts(store: Store, now: number = Date.now()): Promise<ExcerptCounts> {
  const live = (await store.listExcerpts()).filter((e) => !e.source_deleted);
  const queued = live.filter((e) => e.status === "queued");
  const ready = queued.filter((e) => e.due <= now);
  return {
    ready: ready.length,
    waiting: queued.length - ready.length,
    backlog: ready.filter((e) => e.backlog).length,
    setAside: live.filter((e) => e.status === "set_aside").length,
    carded: live.filter((e) => e.status === "carded").length,
    ignored: live.filter((e) => e.status === "ignored").length,
  };
}
