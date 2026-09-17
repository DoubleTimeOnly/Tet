import {
  drawRelationships,
  drawWords,
  formatRelationship,
  newItems,
  parseBulkItems,
  parseSeconds,
  pickDistinct,
  poolKindFor,
  minPoolSize,
  MAX_SECONDS,
} from "./prompts";

/** Deterministic rng: cycles the given fractions, so draws are reproducible. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] as number;
}

describe("pickDistinct", () => {
  const pool = ["a", "b", "c", "d"];

  it("returns n entries with no repeats", () => {
    const picked = pickDistinct(pool, 3, seq(0.9, 0.1, 0.5));
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
  });

  it("caps at the pool size rather than padding with repeats", () => {
    const picked = pickDistinct(pool, 10, Math.random);
    expect(picked).toHaveLength(4);
    expect(new Set(picked).size).toBe(4);
  });

  it("does not mutate the pool", () => {
    const original = [...pool];
    pickDistinct(pool, 3, Math.random);
    expect(pool).toEqual(original);
  });

  it("returns nothing for n <= 0", () => {
    expect(pickDistinct(pool, 0, Math.random)).toEqual([]);
    expect(pickDistinct(pool, -2, Math.random)).toEqual([]);
  });
});

describe("drawWords", () => {
  it("deals n distinct words", () => {
    const words = drawWords(["ferry", "attic", "cactus", "karaoke"], 3, {
      rng: seq(0.1, 0.6, 0.3),
    });
    expect(words).toHaveLength(3);
    expect(new Set(words).size).toBe(3);
  });

  it("prefers words that aren't in the recent list", () => {
    const words = drawWords(["ferry", "attic", "cactus"], 2, {
      exclude: ["cactus"],
      rng: Math.random,
    });
    expect(words).not.toContain("cactus");
    expect(words.sort()).toEqual(["attic", "ferry"]);
  });

  it("matches the recent list case-insensitively", () => {
    const words = drawWords(["Ferry", "attic"], 1, { exclude: ["FERRY"] });
    expect(words).toEqual(["attic"]);
  });

  it("falls back to recent words rather than dealing short", () => {
    // Everything has been seen, so refusing to deal would leave you with
    // nothing to practise on.
    const words = drawWords(["ferry", "attic"], 2, {
      exclude: ["ferry", "attic"],
      rng: Math.random,
    });
    expect(words.sort()).toEqual(["attic", "ferry"]);
  });

  it("deals what it can from a pool smaller than n", () => {
    expect(drawWords(["ferry"], 5, { rng: Math.random })).toEqual(["ferry"]);
  });

  it("deals nothing from an empty pool", () => {
    expect(drawWords([], 3)).toEqual([]);
  });
});

describe("drawRelationships", () => {
  const roles = ["a dentist", "a stowaway", "a park ranger", "a bailiff"];
  // Which role lands first is down to the shuffle, so assert on the pair.
  const ONLY_PAIR = ["A dentist and a bailiff", "A bailiff and a dentist"];

  it("composes each prompt from two distinct roles", () => {
    const drawn = drawRelationships(roles, 3, { rng: Math.random });
    expect(drawn).toHaveLength(3);
    for (const text of drawn) {
      const [a, b] = text.split(" and ");
      expect(a).toBeTruthy();
      expect(b).toBeTruthy();
      expect(a!.toLowerCase()).not.toBe(b!.toLowerCase());
    }
  });

  it("does not repeat a pair within one run", () => {
    // Two roles = exactly one possible pair, so a second prompt can't exist.
    const drawn = drawRelationships(["a dentist", "a bailiff"], 4, {
      rng: Math.random,
    });
    expect(drawn).toHaveLength(1);
    expect(ONLY_PAIR).toContain(drawn[0]);
  });

  it("treats a reversed pair as the same pair", () => {
    const drawn = drawRelationships(["a dentist", "a bailiff"], 2, {
      rng: seq(0.99, 0.0, 0.0, 0.99),
    });
    expect(drawn).toHaveLength(1);
  });

  it("needs two roles to compose anything", () => {
    expect(drawRelationships(["a dentist"], 3)).toEqual([]);
    expect(drawRelationships([], 3)).toEqual([]);
  });

  it("still deals when every pair was seen recently", () => {
    const drawn = drawRelationships(["a dentist", "a bailiff"], 1, {
      exclude: ONLY_PAIR,
      rng: Math.random,
    });
    expect(drawn).toHaveLength(1);
    expect(ONLY_PAIR).toContain(drawn[0]);
  });
});

describe("formatRelationship", () => {
  it("reads as a sentence", () => {
    expect(formatRelationship("a dentist", "a stowaway")).toBe(
      "A dentist and a stowaway",
    );
  });
});

describe("parseBulkItems", () => {
  it("takes one entry per line, trimmed", () => {
    expect(parseBulkItems("  ferry \n attic\ncactus")).toEqual([
      "ferry",
      "attic",
      "cactus",
    ]);
  });

  it("drops blank lines and handles CRLF", () => {
    expect(parseBulkItems("ferry\r\n\r\n   \r\nattic")).toEqual(["ferry", "attic"]);
  });

  it("de-duplicates case-insensitively, keeping the first spelling", () => {
    expect(parseBulkItems("Ferry\nferry\nFERRY")).toEqual(["Ferry"]);
  });

  it("returns nothing for empty text", () => {
    expect(parseBulkItems("   \n  ")).toEqual([]);
  });
});

describe("newItems", () => {
  it("keeps only entries the pool doesn't already have", () => {
    expect(newItems(["ferry", "attic"], ["FERRY", "cactus"])).toEqual(["cactus"]);
  });

  it("keeps everything when the pool is empty", () => {
    expect(newItems([], ["ferry"])).toEqual(["ferry"]);
  });
});

describe("parseSeconds", () => {
  it("takes a custom interval", () => {
    expect(parseSeconds("7")).toBe(7);
  });

  it("reads empty or junk as tap-to-advance", () => {
    expect(parseSeconds("")).toBeNull();
    expect(parseSeconds("  ")).toBeNull();
    expect(parseSeconds("soon")).toBeNull();
  });

  it("reads zero and negatives as tap-to-advance", () => {
    expect(parseSeconds("0")).toBeNull();
    expect(parseSeconds("-5")).toBeNull();
  });

  it("rounds to whole seconds and clamps the ceiling", () => {
    expect(parseSeconds("7.4")).toBe(7);
    expect(parseSeconds("99999")).toBe(MAX_SECONDS);
  });
});

describe("kind mapping", () => {
  it("draws words from the word pool and relationships from roles", () => {
    expect(poolKindFor("words")).toBe("word");
    expect(poolKindFor("relationships")).toBe("role");
  });

  it("needs two roles for a relationship, one word for a word", () => {
    expect(minPoolSize("words")).toBe(1);
    expect(minPoolSize("relationships")).toBe(2);
  });
});
