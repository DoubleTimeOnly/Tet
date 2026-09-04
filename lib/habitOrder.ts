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
