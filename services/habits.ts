import type { Store, HabitParams } from "../db/store";
import type { Habit, HabitLog } from "../db/schema";
import { newId } from "../lib/id";
import { localDayKey } from "../lib/dayKey";

/**
 * Habit orchestration — the screens call these and stay dumb, mirroring
 * services/learning.ts. `now`/`tz` are parameters rather than read from the
 * environment so the day boundary is testable.
 */

export interface NewHabitInput {
  identity: string;
  name: string;
  action: string;
  promptNote?: boolean;
}

export async function createHabit(
  store: Store,
  input: NewHabitInput,
  now: number = Date.now(),
): Promise<Habit> {
  const habit: Habit = {
    id: newId(),
    identity: input.identity.trim(),
    name: input.name.trim(),
    action: input.action.trim(),
    prompt_note: input.promptNote ?? false,
    active: true,
    created_at: now,
  };
  await store.insertHabit(habit);
  return habit;
}

export interface EditHabitInput {
  identity?: string;
  name?: string;
  action?: string;
  promptNote?: boolean;
}

/**
 * Edit a habit's fields, merging the patch over the current row so unspecified
 * fields are untouched. Changing the `action` is the expected case as a habit
 * scales up ("walk to the gym" -> "work out for 5 minutes"); past logs keep the
 * action they were written with (see logHabit).
 */
export async function updateHabit(
  store: Store,
  id: string,
  input: EditHabitInput,
): Promise<Habit> {
  const current = await store.getHabit(id);
  if (!current) throw new Error(`updateHabit: no habit ${id}`);
  const params: HabitParams = {
    identity: input.identity?.trim() ?? current.identity,
    name: input.name?.trim() || current.name,
    action: input.action?.trim() || current.action,
    prompt_note: input.promptNote ?? current.prompt_note,
  };
  await store.updateHabitParams(id, params);
  return { ...current, ...params };
}

/** Soft-archive: drops out of the Habits list, its log history stays. */
export async function archiveHabit(store: Store, id: string): Promise<void> {
  await store.setHabitActive(id, false);
}

/**
 * Record that the habit was done. Unlimited per day — every call is its own
 * row. The action is snapshotted so the log reads truthfully after an edit,
 * and `date` uses the same 4am Tet-day key as completions so a future habit
 * calendar lines up with the rest of the app.
 */
export async function logHabit(
  store: Store,
  habit: Habit,
  opts: { note?: string | null },
  now: number,
  tz: string,
): Promise<HabitLog> {
  const note = opts.note?.trim();
  const log: HabitLog = {
    id: newId(),
    habit_id: habit.id,
    date: localDayKey(now, tz),
    action: habit.action,
    note: note ? note : null,
    done_at: now,
  };
  await store.insertHabitLog(log);
  return log;
}
