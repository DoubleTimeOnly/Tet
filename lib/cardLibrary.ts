import type { Card, Task } from "../db/schema";

/**
 * Library browsing model. Cards aren't stored by source category — they carry a
 * deck_id and an optional source_task_id — so the three top-level buckets are
 * derived here from each card's source task:
 *
 *   - no source task            -> Obsidian (the imported deck, manual + Anki cards)
 *   - source task is `youtube`  -> YouTube  (one bucket, filterable by video)
 *   - source task is `reading`  -> Readwise (one sub-deck per document/task)
 *
 * Pure + unit-tested so the browser UI (ui/CardBrowser) stays declarative.
 */

export type LibCategory = "obsidian" | "youtube" | "readwise";

export const CATEGORY_LABELS: Record<LibCategory, string> = {
  obsidian: "Obsidian",
  youtube: "YouTube",
  readwise: "Readwise",
};

export function buildTaskMap(tasks: Task[]): Map<string, Task> {
  return new Map(tasks.map((t) => [t.id, t]));
}

export function cardCategory(card: Card, taskById: Map<string, Task>): LibCategory {
  if (!card.source_task_id) return "obsidian";
  const t = taskById.get(card.source_task_id);
  if (t?.type === "youtube") return "youtube";
  if (t?.type === "reading") return "readwise";
  return "obsidian";
}

/** Count of cards in each top-level category. */
export function categoryCounts(
  cards: Card[],
  taskById: Map<string, Task>,
): Record<LibCategory, number> {
  const counts: Record<LibCategory, number> = { obsidian: 0, youtube: 0, readwise: 0 };
  for (const c of cards) counts[cardCategory(c, taskById)]++;
  return counts;
}

export interface SourceGroup {
  taskId: string;
  title: string;
  count: number;
}

/**
 * Group a category's cards by their source task — the YouTube videos within the
 * YouTube bucket, or the documents (sub-decks) within Readwise — sorted by title.
 */
export function sourceGroups(
  cards: Card[],
  taskById: Map<string, Task>,
  category: LibCategory,
): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const c of cards) {
    if (cardCategory(c, taskById) !== category) continue;
    const id = c.source_task_id;
    if (!id) continue;
    const g = groups.get(id);
    if (g) g.count++;
    else groups.set(id, { taskId: id, title: taskById.get(id)?.title ?? "Untitled", count: 1 });
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** Case-insensitive match against a card's front or back; empty query matches all. */
export function matchesQuery(card: Card, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return card.front.toLowerCase().includes(q) || card.back.toLowerCase().includes(q);
}
