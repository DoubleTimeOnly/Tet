import type { PlaylistVideo } from "./youtube";

/**
 * Pure state logic for a YouTube *playlist* task — the part that doesn't touch
 * the network. The cached items, which videos you've watched, and today's
 * sampled pick live in Task.meta as JSON (PlaylistState); the task screen owns
 * fetching + persistence and leans on these helpers for the decisions.
 *
 * Sampling is "random unwatched, no replays": each Tet-day surfaces a random
 * video you haven't watched yet. Once every video has been watched the pick is
 * null — the task can't be completed until you add more videos and refresh.
 */
export interface PlaylistState {
  playlistId: string;
  items: PlaylistVideo[];
  /** localDayKey of the last successful fetch; drives the once-a-day refresh. */
  fetchedDay: string | null;
  fetchedAt: number | null;
  watchedIds: string[];
  /** The video chosen for `day`; recomputed when the day rolls over. */
  pick: { id: string; day: string } | null;
}

export function emptyPlaylistState(playlistId: string): PlaylistState {
  return { playlistId, items: [], fetchedDay: null, fetchedAt: null, watchedIds: [], pick: null };
}

/** True when the cache is empty or was last fetched on an earlier Tet-day. */
export function needsRefresh(state: PlaylistState | null, dayKey: string): boolean {
  return !state || state.items.length === 0 || state.fetchedDay !== dayKey;
}

/**
 * Ensure `state.pick` is a valid choice for `dayKey`. Keeps an existing pick
 * that's still for today, still in the list, and not yet watched; otherwise
 * samples a random *unwatched* video. Watched videos are never replayed, so
 * when none remain the pick becomes null. Returns the same reference when
 * nothing changes so callers can skip a write.
 */
export function pickForDay(
  state: PlaylistState,
  dayKey: string,
  rng: () => number = Math.random,
): PlaylistState {
  const watched = new Set(state.watchedIds);
  const current = state.pick;
  if (
    current &&
    current.day === dayKey &&
    !watched.has(current.id) &&
    state.items.some((i) => i.id === current.id)
  ) {
    return state;
  }
  const pool = state.items.filter((i) => !watched.has(i.id));
  if (pool.length === 0) {
    return current === null ? state : { ...state, pick: null };
  }
  const choice = pool[Math.floor(rng() * pool.length)]!;
  return { ...state, pick: { id: choice.id, day: dayKey } };
}

/** Mark a video watched and clear the pick so the next open samples a new one. */
export function markWatched(state: PlaylistState, id: string): PlaylistState {
  const watchedIds = state.watchedIds.includes(id)
    ? state.watchedIds
    : [...state.watchedIds, id];
  return { ...state, watchedIds, pick: null };
}

/** Look up the full video record for the current pick. */
export function pickedVideo(state: PlaylistState): PlaylistVideo | null {
  if (!state.pick) return null;
  return state.items.find((i) => i.id === state.pick!.id) ?? null;
}
