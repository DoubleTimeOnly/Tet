import type { Task, Card, Completion, CompletionEvidence, Excerpt } from "../db/schema";

/** Minimal builders so tests state only the fields they care about. */

export function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    type: "flashcard",
    title: "Task",
    source_ref: null,
    cadence: 1,
    makes_cards_count: 0,
    reading_target: null,
    active: true,
    created_at: 0,
    meta: null,
    ...over,
  };
}

export function makeCard(over: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    deck_id: "deck-1",
    front: "q",
    back: "a",
    note_id: null,
    template: 0,
    source_task_id: null,
    created_at: 0,
    fsrs_state: "{}",
    due: 0,
    state_label: "review",
    ignored: false,
    ...over,
  };
}

export function makeCompletion(over: Partial<Completion> = {}): Completion {
  const evidence: CompletionEvidence = over.evidence ?? {
    type: "flashcard",
    n: 1,
  };
  return {
    id: "comp-1",
    task_id: "task-1",
    date: "2026-06-15",
    verified: true,
    evidence,
    completed_at: 0,
    ...over,
  };
}

export function makeExcerpt(over: Partial<Excerpt> = {}): Excerpt {
  return {
    id: "ex-1",
    readwise_id: "rw-1",
    text: "A highlight",
    note: null,
    book_title: "A Book",
    book_author: "An Author",
    url: "https://readwise.io/open/rw-1",
    highlighted_at: 0,
    source_updated_at: 0,
    source_deleted: false,
    backlog: false,
    status: "queued",
    due: 0,
    pass_count: 0,
    created_at: 0,
    resolved_at: null,
    ...over,
  };
}
