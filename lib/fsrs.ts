import {
  fsrs,
  createEmptyCard,
  Rating as FsrsRating,
  State as FsrsState,
  type FSRS,
  type Card as FsrsCard,
  type Grade,
} from "ts-fsrs";
import { newId } from "./id";
import type { Card, Review, Rating, CardState } from "../db/schema";

/**
 * The ONLY write path for a card's scheduling state (eng-review Architecture
 * #2). The full ts-fsrs object lives in `fsrs_state` (source of truth); `due`
 * (epoch ms) and `state_label` are denormalized for the indexed daily query.
 * Routing every mutation through syncScheduling guarantees the columns can't
 * drift from the blob.
 */

let scheduler: FSRS | null = null;
function getScheduler(): FSRS {
  // Default FSRS-6 parameters; deterministic (fuzz left at its default off).
  if (!scheduler) scheduler = fsrs();
  return scheduler;
}

const RATING_TO_FSRS: Record<Rating, Grade> = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy,
};

function toStateLabel(state: FsrsState): CardState {
  switch (state) {
    case FsrsState.New:
      return "new";
    case FsrsState.Learning:
    case FsrsState.Relearning:
      return "learning";
    case FsrsState.Review:
      return "review";
    default:
      return "new";
  }
}

/** Parse the stored ts-fsrs object; ts-fsrs revives string dates internally. */
function reviveFsrsCard(fsrsState: string): FsrsCard {
  return JSON.parse(fsrsState) as FsrsCard;
}

/** Stamp the denormalized columns from the authoritative ts-fsrs object. */
function syncScheduling(card: Card, fsrsCard: FsrsCard): Card {
  return {
    ...card,
    fsrs_state: JSON.stringify(fsrsCard),
    due: new Date(fsrsCard.due).getTime(),
    state_label: toStateLabel(fsrsCard.state),
  };
}

export interface CreateCardInput {
  deckId: string;
  front: string;
  back: string;
  now: Date | number;
  sourceTaskId?: string | null;
  id?: string;
  /** Owning note + which generated sibling, when the card belongs to a note. */
  noteId?: string | null;
  template?: number;
}

/** A brand-new card with a fresh FSRS state, due immediately. */
export function createCard(input: CreateCardInput): Card {
  const { deckId, front, back, now, sourceTaskId = null, id, noteId = null, template = 0 } = input;
  const nowDate = now instanceof Date ? now : new Date(now);
  const fresh = createEmptyCard(nowDate);
  const base: Card = {
    id: id ?? newId(),
    deck_id: deckId,
    front,
    back,
    note_id: noteId,
    template,
    source_task_id: sourceTaskId,
    created_at: nowDate.getTime(),
    fsrs_state: "{}",
    due: 0,
    state_label: "new",
    ignored: false,
  };
  return syncScheduling(base, fresh);
}

export interface GradeResult {
  card: Card;
  review: Review;
}

/**
 * Apply an Again/Hard/Good/Easy grade: advances FSRS and returns the updated
 * card (with synced due/state_label) plus the Review row to append.
 */
export function grade(
  card: Card,
  rating: Rating,
  now: Date | number,
  opts: { reviewId?: string } = {},
): GradeResult {
  const nowDate = now instanceof Date ? now : new Date(now);
  const fsrsCard = reviveFsrsCard(card.fsrs_state);
  const { card: nextCard } = getScheduler().next(
    fsrsCard,
    nowDate,
    RATING_TO_FSRS[rating],
  );

  return {
    card: syncScheduling(card, nextCard),
    review: {
      id: opts.reviewId ?? newId(),
      card_id: card.id,
      rating,
      reviewed_at: nowDate.getTime(),
    },
  };
}
