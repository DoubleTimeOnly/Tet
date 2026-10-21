/**
 * Manual ordering for the Habits list. Habits carry an explicit `sort_order`
 * rather than being sorted by creation time, because the order you want to see
 * them in is a judgement (most important first) that has nothing to do with
 * when you happened to add them.
 *
 * Pure list arithmetic; the store writes the resulting positions.
 */

/**
 * `items` with the entry at `index` moved by `delta` places. Returns the list
 * unchanged when the move would fall off either end, so callers can call it
 * unconditionally and the UI just disables the arrow.
 */
export function moveItem<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length) return items;
  if (target < 0 || target >= items.length) return items;

  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as T);
  return next;
}

/** True when the entry can't move further in that direction. */
export function isAtEdge(index: number, count: number, delta: number): boolean {
  const target = index + delta;
  return target < 0 || target >= count;
}

/**
 * Stable split for display: not-done-today first, then done, each group keeping
 * its manual order. Surfaces what's still left without losing the user's
 * ranking inside either group.
 */
export function partitionByDone<T>(items: readonly T[], isDone: (item: T) => boolean): T[] {
  return [...items.filter((i) => !isDone(i)), ...items.filter(isDone)];
}

/**
 * Move `id` one place within `group` (a subsequence of `order`, as shown on
 * screen), returning the new full order. It lands just past its on-screen
 * neighbour, so an arrow press always changes what you see even when entries
 * from the other group sit between them in the full order. Unchanged (same
 * reference) at the edge of the group or for an unknown id.
 */
export function moveWithinGroup<T>(
  order: T[],
  group: readonly T[],
  id: T,
  delta: -1 | 1,
): T[] {
  const gi = group.indexOf(id);
  const from = order.indexOf(id);
  if (gi === -1 || from === -1 || isAtEdge(gi, group.length, delta)) return order;
  const to = order.indexOf(group[gi + delta] as T);
  if (to === -1) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
