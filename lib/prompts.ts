import type { PracticeKind } from "../db/schema";

/**
 * Improv prompt generation — pure, so every draw is reproducible in a test.
 *
 * There is no correct answer and no difficulty here, which is what separates
 * this from the flashcard system: nothing is scheduled, nothing is graded, and
 * the only state that matters is "don't hand me the same word I saw last time".
 * The side-effecting half (persisting a run, seeding the bundled pools) lives in
 * services/prompts.ts.
 */

/** Injected so tests draw deterministically; defaults to Math.random. */
export type Rng = () => number;

export const DEFAULT_N = 5;

/**
 * Bounds on the optional auto-advance timer. The floor is 1s (below that you
 * can't read the word); the ceiling is 10 minutes, past which "timed" is a
 * fiction and you may as well tap.
 */
export const MIN_SECONDS = 1;
export const MAX_SECONDS = 600;

/** How far back recent-draw avoidance looks. Big enough to cover several runs. */
export const RECENT_DRAW_WINDOW = 60;

/** Which pool a practice kind draws from. */
export function poolKindFor(kind: PracticeKind): "word" | "role" {
  return kind === "relationships" ? "role" : "word";
}

/** Fewest pool entries a kind can run on: a relationship needs two roles. */
export function minPoolSize(kind: PracticeKind): number {
  return kind === "relationships" ? 2 : 1;
}

/**
 * `n` distinct items, in random order. Partial Fisher-Yates over a copy, so a
 * pool is never mutated and an item can't be dealt twice in one run. Returns
 * fewer than `n` when the pool is smaller — callers surface that rather than
 * padding with repeats.
 */
export function pickDistinct<T>(items: readonly T[], n: number, rng: Rng): T[] {
  const pool = [...items];
  const take = Math.max(0, Math.min(n, pool.length));
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    const a = pool[i] as T;
    const b = pool[j] as T;
    pool[i] = b;
    pool[j] = a;
  }
  return pool.slice(0, take);
}

export interface DrawOptions {
  /** Recently seen prompts, de-prioritized so runs don't repeat themselves. */
  exclude?: readonly string[];
  rng?: Rng;
}

/**
 * `n` words, preferring ones you haven't just seen. Recency is a preference and
 * not a filter: with a 10-word pool and 20 recent draws there is nothing fresh
 * left, and refusing to deal is worse than dealing a repeat — so exhausted
 * fresh words fall back to the rest of the pool.
 */
export function drawWords(
  pool: readonly string[],
  n: number,
  { exclude = [], rng = Math.random }: DrawOptions = {},
): string[] {
  const seen = new Set(exclude.map(normalize));
  const fresh = pool.filter((w) => !seen.has(normalize(w)));
  const stale = pool.filter((w) => seen.has(normalize(w)));

  const picked = pickDistinct(fresh, n, rng);
  if (picked.length < n) {
    picked.push(...pickDistinct(stale, n - picked.length, rng));
  }
  return picked;
}

/**
 * `n` relationships, each two distinct roles composed at draw time ("A dentist
 * and a stowaway"). Composing rather than storing whole relationships is what
 * makes the space effectively unlimited from a short list of roles — 80 roles
 * is 3,160 pairs.
 *
 * Pairs are unique within a run (seeing the same two roles twice in five
 * prompts reads as a bug), and `exclude` de-prioritizes pairs from recent runs
 * the same way drawWords does.
 */
export function drawRelationships(
  roles: readonly string[],
  n: number,
  { exclude = [], rng = Math.random }: DrawOptions = {},
): string[] {
  if (roles.length < 2) return [];

  const seen = new Set(exclude.map(normalize));
  const used = new Set<string>();
  const out: string[] = [];

  // Bounded: every attempt either lands a pair or collides, and a pool this
  // small exhausts long before the cap. Without it an exhausted pool spins.
  const maxAttempts = n * 40;
  for (let attempt = 0; out.length < n && attempt < maxAttempts; attempt++) {
    const pair = pickDistinct(roles, 2, rng);
    const a = pair[0];
    const b = pair[1];
    if (a === undefined || b === undefined) break;

    const text = formatRelationship(a, b);
    const key = pairKey(a, b);
    if (used.has(key)) continue;
    // Second half of the budget: take repeats from earlier runs rather than
    // hand back fewer prompts than asked for.
    if (seen.has(normalize(text)) && attempt < maxAttempts / 2) continue;

    used.add(key);
    out.push(text);
  }
  return out;
}

/** Roles are stored lowercase ("a dentist"); the rendered prompt is a sentence. */
export function formatRelationship(a: string, b: string): string {
  return capitalize(`${a} and ${b}`);
}

/** Order-independent, so "A and B" and "B and A" count as the same pair. */
function pairKey(a: string, b: string): string {
  return [normalize(a), normalize(b)].sort().join("\u0000");
}

export function draw(
  kind: PracticeKind,
  pool: readonly string[],
  n: number,
  options: DrawOptions = {},
): string[] {
  return kind === "relationships"
    ? drawRelationships(pool, n, options)
    : drawWords(pool, n, options);
}

/**
 * Bulk paste -> items, mirroring the flashcard text import: one per line, blanks
 * dropped, trimmed, and de-duplicated case-insensitively keeping the first
 * spelling you typed.
 */
export function parseBulkItems(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const key = normalize(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** The parsed entries that aren't already in the pool (case-insensitive). */
export function newItems(
  existing: readonly string[],
  parsed: readonly string[],
): string[] {
  const have = new Set(existing.map(normalize));
  return parsed.filter((item) => !have.has(normalize(item)));
}

/**
 * The timer field -> seconds. Empty or unparseable is null (tap to advance);
 * anything else is a whole number of seconds clamped into range, so "7" works
 * and "0"/"9999" can't produce a practice that flickers or never advances.
 */
export function parseSeconds(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  const whole = Math.round(n);
  if (whole <= 0) return null;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, whole));
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** Which practice kinds have a run dealt on or after `since` (a day's start). */
export interface ImprovDone {
  words: boolean;
  relationships: boolean;
}

/**
 * Today's improv progress for the Today rings and the loot gate: a kind counts
 * once any run of it was dealt since the start of the day. Runs record when
 * they were dealt, not when the last prompt was reached, so opening a run is
 * what counts.
 */
export function improvDoneSince(
  practices: readonly { kind: string; started_at: number }[],
  since: number,
): ImprovDone {
  const today = practices.filter((p) => p.started_at >= since);
  return {
    words: today.some((p) => p.kind === "words"),
    relationships: today.some((p) => p.kind === "relationships"),
  };
}
