import { localDayKey, type Instant } from "./dayKey";
import { newId } from "./id";
import type {
  Task,
  Completion,
  CompletionEvidence,
} from "../db/schema";

/**
 * Writes a Completion keyed by localDayKey (eng-review Architecture #5).
 *
 * A task is `verified` only when BOTH hold:
 *   1. its own type-specific done-condition is met, and
 *   2. cards_made >= makes_cards_count  (the chained "make N cards" gate).
 *
 * There is no separate make_cards task type; the follow-up gate rides on the
 * source task. A youtube/reading task with makes_cards_count > 0 stays
 * unverified until enough cards cite it, even once watched/read.
 */

export const DEFAULT_READING_TARGET = 0.9;

export interface RecordCompletionInput {
  task: Task;
  evidence: CompletionEvidence;
  now: Instant;
  tz: string;
  /** Cards already created that cite this task as their source. */
  cardsMade?: number;
  /** Test seam for deterministic ids. */
  id?: string;
}

/** Whether the task's own (pre-card-gate) condition is satisfied. */
export function ownConditionMet(
  task: Task,
  evidence: CompletionEvidence,
): boolean {
  switch (evidence.type) {
    case "flashcard":
      // Self-verifying: reviewed at least the day's cadence worth of cards.
      return evidence.n >= task.cadence;
    case "youtube":
      // Hybrid verification: manual "Done" is the signal (no coverage gate).
      return evidence.manual === true;
    case "reading": {
      const target = task.reading_target ?? DEFAULT_READING_TARGET;
      return evidence.readwise_fraction >= target;
    }
  }
}

export function recordCompletion(input: RecordCompletionInput): Completion {
  const { task, evidence, now, tz, cardsMade = 0, id } = input;

  const cardsGateMet = cardsMade >= task.makes_cards_count;
  const verified = ownConditionMet(task, evidence) && cardsGateMet;

  return {
    id: id ?? newId(),
    task_id: task.id,
    date: localDayKey(now, tz),
    verified,
    evidence,
    completed_at: now instanceof Date ? now.getTime() : now,
  };
}
