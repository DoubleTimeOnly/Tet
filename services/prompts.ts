import type { Store } from "../db/store";
import type {
  PracticeKind,
  PromptDraw,
  PromptItem,
  PromptPractice,
} from "../db/schema";
import { newId } from "../lib/id";
import {
  draw,
  minPoolSize,
  newItems,
  parseBulkItems,
  poolKindFor,
  RECENT_DRAW_WINDOW,
  type Rng,
} from "../lib/prompts";
import bundled from "../data/improv-prompts.json";

/**
 * Improv prompt orchestration — Store + lib/prompts glue, mirroring
 * services/habits.ts. `now` and `rng` are parameters rather than read from the
 * environment so a run is reproducible in tests.
 */

/** The bundled pools, shipped so the feature is usable before you curate it. */
const BUILTIN: Record<string, string[]> = {
  word: bundled.words,
  role: bundled.roles,
};

/**
 * Seed the bundled pools on first run. Per-kind and idempotent: a pool that
 * already has entries is left alone, so this is safe to call on every startup
 * (which is also how an existing install picks the pools up). Deleting every
 * entry in a pool does re-seed it on next launch — that reads as "reset to
 * defaults" rather than a bug.
 */
export async function seedPromptPools(
  store: Store,
  now: number = Date.now(),
): Promise<number> {
  let seeded = 0;
  for (const [kind, texts] of Object.entries(BUILTIN)) {
    const existing = await store.listPromptItems(kind);
    if (existing.length > 0) continue;
    await store.insertPromptItems(
      texts.map((text, i) => ({
        id: newId(),
        kind,
        text,
        builtin: true,
        // Spread created_at so the list keeps the authored order (it sorts by
        // created_at, and a whole pool written in one millisecond would not).
        created_at: now + i,
      })),
    );
    seeded += texts.length;
  }
  return seeded;
}

export interface AddItemsResult {
  added: PromptItem[];
  /** Pasted lines already in the pool — reported so the UI can say so. */
  duplicates: number;
}

/**
 * Bulk-add pasted entries to a pool (one per line), skipping anything already
 * there. Mirrors the flashcard text import: parse first, then commit.
 */
export async function addPromptItems(
  store: Store,
  kind: string,
  text: string,
  now: number = Date.now(),
): Promise<AddItemsResult> {
  const parsed = parseBulkItems(text);
  const existing = await store.listPromptItems(kind);
  const fresh = newItems(
    existing.map((i) => i.text),
    parsed,
  );
  const added: PromptItem[] = fresh.map((t, i) => ({
    id: newId(),
    kind,
    text: t,
    builtin: false,
    created_at: now + i,
  }));
  await store.insertPromptItems(added);
  return { added, duplicates: parsed.length - fresh.length };
}

export interface StartPracticeInput {
  kind: PracticeKind;
  /** How many prompts to deal. */
  n: number;
  /** Auto-advance seconds, or null for tap-to-advance. */
  seconds: number | null;
}

export type PracticeResult =
  | {
      ok: true;
      practice: PromptPractice;
      /** The dealt prompts, in reveal order. */
      prompts: string[];
      /** What was asked for — may exceed prompts.length on a small pool. */
      requested: number;
    }
  | { ok: false; reason: "empty-pool"; poolSize: number; needed: number };

/**
 * Deal a run and record it. The draw avoids prompts from the last
 * RECENT_DRAW_WINDOW draws of the same kind, so consecutive sessions don't
 * repeat themselves while a small pool still deals something.
 *
 * A pool too small to produce a single prompt returns ok:false instead of
 * writing an empty practice row — an empty run is not history worth keeping.
 */
export async function startPractice(
  store: Store,
  input: StartPracticeInput,
  now: number = Date.now(),
  rng: Rng = Math.random,
): Promise<PracticeResult> {
  const poolKind = poolKindFor(input.kind);
  const pool = await store.listPromptItems(poolKind);
  const needed = minPoolSize(input.kind);
  if (pool.length < needed) {
    return { ok: false, reason: "empty-pool", poolSize: pool.length, needed };
  }

  const recent = await store.listRecentPromptDraws(input.kind, RECENT_DRAW_WINDOW);
  const prompts = draw(
    input.kind,
    pool.map((i) => i.text),
    input.n,
    { exclude: recent.map((d) => d.text), rng },
  );
  if (prompts.length === 0) {
    return { ok: false, reason: "empty-pool", poolSize: pool.length, needed };
  }

  const practice: PromptPractice = {
    id: newId(),
    kind: input.kind,
    n: prompts.length,
    seconds: input.seconds,
    started_at: now,
  };
  const draws: PromptDraw[] = prompts.map((text, position) => ({
    id: newId(),
    practice_id: practice.id,
    kind: input.kind,
    position,
    text,
    drawn_at: now,
  }));
  await store.insertPromptPractice(practice, draws);
  return { ok: true, practice, prompts, requested: input.n };
}

export interface PracticeSummary {
  practice: PromptPractice;
  prompts: string[];
}

/** Recent runs with the prompts they dealt, newest first (history view). */
export async function listRecentPractices(
  store: Store,
  limit = 10,
): Promise<PracticeSummary[]> {
  const practices = await store.listPromptPractices(limit);
  return Promise.all(
    practices.map(async (practice) => ({
      practice,
      prompts: (await store.listPromptDraws(practice.id)).map((d) => d.text),
    })),
  );
}
