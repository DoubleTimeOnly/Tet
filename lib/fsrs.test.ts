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

describe("interval fuzz", () => {
  /** Grade `good` `rounds` times, each review landing on the card's own due date. */
  function schedule(startedAt: Date, gradedAt: Date, rounds: number) {
    let card = createCard({ deckId: "d1", front: "q", back: "a", now: startedAt });
    let when = gradedAt;
    for (let i = 0; i < rounds; i++) {
      card = grade(card, "good", when).card;
      when = new Date(card.due);
    }
    return card;
  }

  it("cards authored together stop travelling as a convoy", () => {
    // Two identical cards made in the same sitting, graded a second apart —
    // the real shape of a review session. Deterministic scheduling would march
    // them to byte-identical due dates forever.
    const a = schedule(NOW, NOW, 5);
    const b = schedule(NOW, new Date(NOW.getTime() + 1000), 5);

    const drift = Math.abs(a.due - b.due) - 1000;
    expect(drift).toBeGreaterThan(24 * 60 * 60 * 1000);
  });

  it("nudges intervals without meaningfully distorting them", () => {
    // Sample the fuzz across many seeds and check the spread is small and
    // symmetric-ish about the middle: jitter, not a different schedule.
    const dues = Array.from({ length: 60 }, (_, i) => {
      const gradedAt = NOW.getTime() + i * 1000;
      // Measure each card's own elapsed span, so the staggered start times
      // cancel out and only the fuzz remains.
      return schedule(NOW, new Date(gradedAt), 5).due - gradedAt;
    });
    const min = Math.min(...dues);
    const max = Math.max(...dues);
    const mid = (min + max) / 2;

    expect(min).toBeLessThan(max); // fuzz actually fired
    expect(max / min).toBeLessThan(1.5); // and stayed a nudge
    // Both tails present: cards move earlier as well as later.
    expect(dues.some((d) => d < mid)).toBe(true);
    expect(dues.some((d) => d > mid)).toBe(true);
  });

  it("is reproducible for a given card and moment", () => {
    // Fuzz is seeded from the card's state and the review timestamp, not a
    // global RNG, so re-grading the same card at the same instant lands in the
    // same place — the stored due date never shifts under the daily queue.
    const card = schedule(NOW, NOW, 4);
    const at = new Date(card.due);
    expect(grade(card, "good", at).card.due).toBe(grade(card, "good", at).card.due);
  });
});
