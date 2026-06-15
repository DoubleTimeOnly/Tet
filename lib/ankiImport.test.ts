import {
  importApkg,
  stripHtmlToText,
  AnkiImportError,
  type AnkiNote,
  type AnkiNoteReader,
} from "./ankiImport";

const NOW = new Date("2026-06-15T12:00:00Z");

/** In-memory reader; matches the injectable seam the app fills with sqlite. */
function fakeReader(notes: AnkiNote[]): AnkiNoteReader {
  return { readNotes: async () => notes };
}

/** Deterministic id sequence for assertions. */
function seqIds(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

describe("importApkg", () => {
  it("creates fresh FSRS cards from Basic notes (no SM-2 history)", async () => {
    const reader = fakeReader([
      { fields: ["Front 1", "Back 1"] },
      { fields: ["Front 2", "Back 2"] },
    ]);
    const { deck, cards, skipped } = await importApkg(reader, {
      deckName: "French",
      now: NOW,
      deckId: "deck-x",
      idFactory: seqIds("card"),
    });

    expect(deck).toEqual({ id: "deck-x", name: "French", created_at: NOW.getTime() });
    expect(skipped).toBe(0);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => [c.front, c.back])).toEqual([
      ["Front 1", "Back 1"],
      ["Front 2", "Back 2"],
    ]);
    // Fresh under FSRS: new, due now, zero reps.
    expect(cards[0]?.state_label).toBe("new");
    expect(cards[0]?.due).toBe(NOW.getTime());
    expect(JSON.parse(cards[0]!.fsrs_state).reps).toBe(0);
    expect(cards.every((c) => c.deck_id === "deck-x")).toBe(true);
  });

  it("strips HTML from fields by default", async () => {
    const reader = fakeReader([{ fields: ["<b>Bonjour</b>", "Hello&nbsp;there<br>friend"] }]);
    const { cards } = await importApkg(reader, { now: NOW });
    expect(cards[0]?.front).toBe("Bonjour");
    expect(cards[0]?.back).toBe("Hello there friend");
  });

  it("keeps raw fields when stripHtml is false", async () => {
    const reader = fakeReader([{ fields: ["<b>x</b>", "<i>y</i>"] }]);
    const { cards } = await importApkg(reader, { now: NOW, stripHtml: false });
    expect(cards[0]?.front).toBe("<b>x</b>");
  });

  it("skips notes missing a front or back (and counts them)", async () => {
    const reader = fakeReader([
      { fields: ["only front"] },
      { fields: ["", "no front"] },
      { fields: ["good", "card"] },
      { fields: [] },
    ]);
    const { cards, skipped } = await importApkg(reader, { now: NOW });
    expect(cards).toHaveLength(1);
    expect(skipped).toBe(3);
  });

  it("uses the extra fields of multi-field notes as front/back (first two)", async () => {
    const reader = fakeReader([{ fields: ["F", "B", "extra", "tags"] }]);
    const { cards } = await importApkg(reader, { now: NOW });
    expect([cards[0]?.front, cards[0]?.back]).toEqual(["F", "B"]);
  });

  it("handles an empty collection", async () => {
    const { cards, skipped } = await importApkg(fakeReader([]), { now: NOW });
    expect(cards).toEqual([]);
    expect(skipped).toBe(0);
  });

  it("wraps a corrupt/unreadable archive in AnkiImportError (nothing written)", async () => {
    const reader: AnkiNoteReader = {
      readNotes: async () => {
        throw new Error("not a zip");
      },
    };
    await expect(importApkg(reader, { now: NOW })).rejects.toBeInstanceOf(AnkiImportError);
  });
});

describe("stripHtmlToText", () => {
  it("drops tags and collapses whitespace", () => {
    expect(stripHtmlToText("<div>a   b</div>")).toBe("a b");
  });
  it("converts <br> to a space", () => {
    expect(stripHtmlToText("a<br>b")).toBe("a b");
  });
  it("decodes common entities", () => {
    expect(stripHtmlToText("a &amp; b &lt;c&gt; &quot;d&quot;")).toBe('a & b <c> "d"');
  });
});
