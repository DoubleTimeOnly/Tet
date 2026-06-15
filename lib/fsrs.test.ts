import { createCard, grade } from "./fsrs";
import type { Rating } from "../db/schema";

const NOW = new Date("2026-06-15T12:00:00Z");

describe("createCard", () => {
  it("produces a new card due immediately with synced columns", () => {
    const c = createCard({ deckId: "d1", front: "q", back: "a", now: NOW });
    expect(c.deck_id).toBe("d1");
    expect(c.state_label).toBe("new");
    expect(c.due).toBe(NOW.getTime());
    expect(c.created_at).toBe(NOW.getTime());
    // fsrs_state is real JSON carrying the ts-fsrs object.
    expect(JSON.parse(c.fsrs_state).reps).toBe(0);
  });

  it("carries source_task_id for chained make-cards follow-ups", () => {
    const c = createCard({ deckId: "d1", front: "q", back: "a", now: NOW, sourceTaskId: "task-9" });
    expect(c.source_task_id).toBe("task-9");
  });
});

describe("grade", () => {
  it("advances FSRS, syncs due/state_label, and emits a Review", () => {
    const card = createCard({ deckId: "d1", front: "q", back: "a", now: NOW, id: "card-1" });
    const { card: next, review } = grade(card, "good", NOW, { reviewId: "r1" });

    // due moved forward; state left "new".
    expect(next.due).toBeGreaterThan(card.due);
    expect(next.state_label).toBe("learning");
    expect(review).toEqual({ id: "r1", card_id: "card-1", rating: "good", reviewed_at: NOW.getTime() });
  });

  it("due column always equals the ts-fsrs blob's due (no drift)", () => {
    const card = createCard({ deckId: "d1", front: "q", back: "a", now: NOW });
    const { card: next } = grade(card, "easy", NOW);
    expect(next.due).toBe(new Date(JSON.parse(next.fsrs_state).due).getTime());
  });

  it("a later review reads back the prior fsrs_state and advances again", () => {
    const card = createCard({ deckId: "d1", front: "q", back: "a", now: NOW });
    const first = grade(card, "good", NOW).card;
    const later = new Date(first.due);
    const second = grade(first, "good", later).card;
    expect(second.due).toBeGreaterThan(first.due);
    expect(JSON.parse(second.fsrs_state).reps).toBe(2);
  });

  it("Again on a review card lapses it into relearning (learning label)", () => {
    // Push to review state first via repeated Good.
    let card = createCard({ deckId: "d1", front: "q", back: "a", now: NOW });
    let when = NOW;
    for (let i = 0; i < 4; i++) {
      const r = grade(card, "good", when);
      card = r.card;
      when = new Date(card.due);
    }
    expect(card.state_label).toBe("review");
    const lapsed = grade(card, "again", new Date(card.due)).card;
    expect(lapsed.state_label).toBe("learning");
  });

  it.each(["again", "hard", "good", "easy"] as Rating[])(
    "accepts rating %s",
    (rating) => {
      const card = createCard({ deckId: "d1", front: "q", back: "a", now: NOW });
      expect(() => grade(card, rating, NOW)).not.toThrow();
    },
  );
});
