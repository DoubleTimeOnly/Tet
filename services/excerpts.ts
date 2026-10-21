import type { Store } from "../db/store";
import type { Card, Excerpt, ExcerptReview, ExcerptSource } from "../db/schema";
import type { ReadwiseHighlight, ReadwiseHighlightsClient } from "../lib/readwiseHighlights";
import {
  planSync,
  planSources,
  backfillSources,
  syncCursor,
  passExcerpt,
  nextRank,
  moveSource,
  excerptQueue,
  DEFAULT_EXCERPT_CADENCE,
} from "../lib/excerpts";
import { newId } from "../lib/id";
import { addCard, createTask, findOrCreateDeck } from "./authoring";
import { creditExcerptTasks } from "./learning";

/**
 * Excerpt review orchestration: Readwise sync, source choices, triage
 * decisions (with undo), and writing a card from one or several excerpts.
 * Pure rules live in lib/excerpts; this file only sequences Store reads and
 * writes.
 */

/** Cards written from excerpts land here, so an "all decks" review picks them up. */
export const EXCERPT_DECK_NAME = "Readwise excerpts";
export const EXCERPT_TASK_TITLE = "Review excerpts";

export interface SyncResult {
  added: number;
  updated: number;
  /** Unresolved excerpts that dropped out because they were deleted upstream. */
  removed: number;
  /** Sources that appeared in Readwise since the last refresh. */
  newSources: number;
}

/**
 * Give excerpts imported before sources existed a source each (one checked
 * source per book title), so they keep showing up. Cheap no-op otherwise; run
 * on launch and before every sync.
 */
export async function ensureExcerptSources(
  store: Store,
  now: number = Date.now(),
): Promise<void> {
  const [excerpts, sources] = await Promise.all([
    store.listExcerpts(),
    store.listExcerptSources(),
  ]);
  const plan = backfillSources(excerpts, sources, now);
  await store.insertExcerptSources(plan.sources);
  await store.updateExcerpts(plan.excerpts);
}

/**
 * Refresh the source list from Readwise, then pull highlights for checked
 * sources only. Nothing else is fetched: an unchecked, hidden or done source's
 * highlights stay in Readwise.
 */
export async function syncExcerpts(
  store: Store,
  client: ReadwiseHighlightsClient,
  now: number = Date.now(),
): Promise<SyncResult> {
  await ensureExcerptSources(store, now);
  const [books, existing] = await Promise.all([client.listBooks(), store.listExcerptSources()]);
  const plan = planSources(existing, books, now);
  await store.insertExcerptSources(plan.inserts);
  await store.updateExcerptSources(plan.updates);

  const sources = await store.listExcerptSources();
  const result = await syncSourceHighlights(
    store,
    client,
    sources.filter((s) => s.state === "checked"),
    now,
  );
  return { ...result, newSources: plan.newCount };
}

const READER_CATEGORIES = new Set(["articles", "tweets", "pdfs", "emails"]);

/**
 * A Reader-type source still holding excerpts synced before we kept Reader
 * links: refetch it whole once so they pick up the link (incremental syncs only
 * return highlights that changed). Fixed up, it goes back to incremental.
 */
function needsReaderLinks(existing: Excerpt[], source: ExcerptSource): boolean {
  return (
    source.category !== null &&
    READER_CATEGORIES.has(source.category) &&
    existing.some((e) => e.source_id === source.id && !!e.url && !e.url.startsWith("https://read.readwise.io/"))
  );
}

/**
 * Fetch and merge highlights for the given sources (see lib/excerpts.planSync
 * for the rules). Sources never fetched get everything; the rest only what
 * changed since the oldest of their cursors — at most two requests. The first
 * time this brings in any excerpts it also creates the daily "Review
 * excerpts" task, unless an excerpt task already exists (including a removed
 * one, so deleting it sticks).
 */
export async function syncSourceHighlights(
  store: Store,
  client: ReadwiseHighlightsClient,
  sources: ExcerptSource[],
  now: number = Date.now(),
): Promise<Omit<SyncResult, "newSources">> {
  const withIds = sources.filter((s) => s.readwise_book_id !== null);
  if (withIds.length === 0) return { added: 0, updated: 0, removed: 0 };
  const existing = await store.listExcerpts();
  const fresh: string[] = [];
  const known: string[] = [];
  let since: number | null = null;
  for (const s of withIds) {
    const cursor = syncCursor(existing, s.id);
    if (cursor === null || needsReaderLinks(existing, s)) fresh.push(s.readwise_book_id!);
    else {
      known.push(s.readwise_book_id!);
      since = since === null ? cursor : Math.min(since, cursor);
    }
  }
  const incoming: ReadwiseHighlight[] = [
    ...(await client.exportHighlights(fresh, null)),
    ...(await client.exportHighlights(known, since)),
  ];
  const byBookId = new Map(withIds.map((s) => [s.readwise_book_id!, s]));
  const plan = planSync(existing, incoming, byBookId, now);
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

// ---------------------------------------------------------------------------
// Source choices

async function getSource(store: Store, id: string): Promise<ExcerptSource> {
  const s = (await store.listExcerptSources()).find((x) => x.id === id);
  if (!s) throw new Error(`no excerpt source ${id}`);
  return s;
}

async function setState(
  store: Store,
  id: string,
  patch: Partial<ExcerptSource>,
): Promise<ExcerptSource> {
  const next = { ...(await getSource(store, id)), ...patch };
  await store.updateExcerptSources([next]);
  return next;
}

/**
 * Check a source: it joins the bottom of the daily-queue order and its
 * highlights are fetched now. If the fetch fails the source stays checked and
 * the next sync picks it up; the error is rethrown for the UI.
 */
export async function checkSource(
  store: Store,
  client: ReadwiseHighlightsClient,
  id: string,
  now: number = Date.now(),
): Promise<Omit<SyncResult, "newSources">> {
  const all = await store.listExcerptSources();
  const source = await setState(store, id, { state: "checked", rank: nextRank(all), done_at: null });
  return syncSourceHighlights(store, client, [source], now);
}

/** Stop syncing a source. Its imported excerpts are kept; undecided ones leave the queue. */
export async function uncheckSource(store: Store, id: string): Promise<void> {
  await setState(store, id, { state: "unchecked" });
}

/** "Not now" on a new source: clears the flag without syncing it. */
export async function dismissNewSource(store: Store, id: string): Promise<void> {
  await setState(store, id, { state: "unchecked" });
}

/** Declutter: out of the list, and never flagged as new again. */
export async function hideSource(store: Store, id: string): Promise<void> {
  await setState(store, id, { state: "hidden" });
}

/** Back from the hidden list, unchecked. */
export async function unhideSource(store: Store, id: string): Promise<void> {
  await setState(store, id, { state: "unchecked" });
}

/**
 * Mark a source done: no longer synced or queued, kept in the done list.
 * `leftovers` decides its undecided excerpts: "ignore" resolves them all
 * (without earning points — it's one tap, not a decision each), "leave" keeps
 * them undecided for focus mode or a reopen.
 */
export async function markSourceDone(
  store: Store,
  id: string,
  leftovers: "ignore" | "leave",
  now: number = Date.now(),
): Promise<void> {
  if (leftovers === "ignore") {
    const undecided = (await store.listExcerpts()).filter(
      (e) => e.source_id === id && e.status === "queued",
    );
    await store.updateExcerpts(
      undecided.map((e) => ({ ...e, status: "ignored" as const, resolved_at: now })),
    );
  }
  await setState(store, id, { state: "done", done_at: now });
}

/** Pick a done source back up: checked again, at the bottom of the order. */
export async function reopenSource(
  store: Store,
  client: ReadwiseHighlightsClient | null,
  id: string,
  now: number = Date.now(),
): Promise<void> {
  if (client) {
    await checkSource(store, client, id, now);
  } else {
    const all = await store.listExcerptSources();
    await setState(store, id, { state: "checked", rank: nextRank(all), done_at: null });
  }
}

/** Move a checked source one place up or down the daily-queue order. */
export async function moveSourceRank(
  store: Store,
  id: string,
  direction: "up" | "down",
): Promise<void> {
  const reordered = moveSource(await store.listExcerptSources(), id, direction);
  await store.updateExcerptSources(reordered);
}

/** A triage decision that can be taken back (a mis-tap on a phone). */
export interface UndoToken {
  previous: Excerpt;
  reviewId: string;
}

export type TriageAction = "ignore" | "pass" | "set_aside";

/**
 * Ignore, Later ("pass"), or Set aside one excerpt; logs the decision toward
 * today's goal. Focus mode's Skip never comes here — it is session-only.
 */
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
 * today's excerpt goal once, however many excerpts it combined. An excerpt can
 * be carded again: each card is its own link and its own points.
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
    // A further card from an already-carded excerpt keeps its original resolved_at.
    excerpts.map((e) => ({
      ...e!,
      status: "carded" as const,
      resolved_at: e!.status === "carded" ? e!.resolved_at : now,
    })),
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
  /** In the daily queue now (undecided, due, from a checked source). */
  ready: number;
  /** Undecided in checked sources but deferred with Later, not yet due. */
  waiting: number;
  setAside: number;
  carded: number;
  ignored: number;
  checkedSources: number;
  newSources: number;
}

/** Totals for the Library's excerpt summary. Excludes upstream-deleted excerpts. */
export async function excerptCounts(store: Store, now: number = Date.now()): Promise<ExcerptCounts> {
  const [all, sources] = await Promise.all([store.listExcerpts(), store.listExcerptSources()]);
  const live = all.filter((e) => !e.source_deleted);
  const checked = new Set(sources.filter((s) => s.state === "checked").map((s) => s.id));
  const ready = excerptQueue(live, sources, now).length;
  const inChecked = live.filter(
    (e) => e.status === "queued" && e.source_id !== null && checked.has(e.source_id),
  ).length;
  return {
    ready,
    waiting: inChecked - ready,
    setAside: live.filter((e) => e.status === "set_aside").length,
    carded: live.filter((e) => e.status === "carded").length,
    ignored: live.filter((e) => e.status === "ignored").length,
    checkedSources: checked.size,
    newSources: sources.filter((s) => s.state === "new").length,
  };
}
