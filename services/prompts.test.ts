import { MemoryStore } from "../db/memoryStore";
import {
  addPromptItems,
  listRecentPractices,
  seedPromptPools,
  startPractice,
} from "./prompts";
import { exportBackup, restoreBackup } from "./backupService";

async function emptyStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.init();
  return store;
}

/** A store whose word pool is exactly these entries (no bundled seed). */
async function storeWithWords(...words: string[]): Promise<MemoryStore> {
  const store = await emptyStore();
  await addPromptItems(store, "word", words.join("\n"), 100);
  return store;
}

describe("seedPromptPools", () => {
  it("seeds the bundled word and role pools on first run", async () => {
    const store = await emptyStore();
    const seeded = await seedPromptPools(store, 100);

    expect(seeded).toBeGreaterThan(0);
    expect((await store.listPromptItems("word")).length).toBeGreaterThan(0);
    expect((await store.listPromptItems("role")).length).toBeGreaterThan(0);
    expect((await store.listPromptItems("word")).every((i) => i.builtin)).toBe(true);
  });

  it("is idempotent — a second call adds nothing", async () => {
    const store = await emptyStore();
    await seedPromptPools(store, 100);
    const after = await store.listPromptItems();

    expect(await seedPromptPools(store, 200)).toBe(0);
    expect(await store.listPromptItems()).toEqual(after);
  });

  it("leaves a pool you've already added to alone", async () => {
    const store = await storeWithWords("ferry");
    await seedPromptPools(store, 200);

    expect((await store.listPromptItems("word")).map((i) => i.text)).toEqual(["ferry"]);
    // The untouched role pool still seeds.
    expect((await store.listPromptItems("role")).length).toBeGreaterThan(0);
  });

  it("keeps the authored order of the bundled pool", async () => {
    const store = await emptyStore();
    await seedPromptPools(store, 100);
    const words = await store.listPromptItems("word");

    expect(words[0]!.text).toBe("cactus");
    expect(words[1]!.text).toBe("escalator");
  });
});

describe("addPromptItems", () => {
  it("adds pasted entries, one per line", async () => {
    const store = await emptyStore();
    const result = await addPromptItems(store, "word", "ferry\nattic\n\ncactus", 100);

    expect(result.added).toHaveLength(3);
    expect(result.duplicates).toBe(0);
    expect((await store.listPromptItems("word")).map((i) => i.text)).toEqual([
      "ferry",
      "attic",
      "cactus",
    ]);
  });

  it("skips entries the pool already has and reports how many", async () => {
    const store = await storeWithWords("ferry");
    const result = await addPromptItems(store, "word", "FERRY\ncactus", 200);

    expect(result.added.map((i) => i.text)).toEqual(["cactus"]);
    expect(result.duplicates).toBe(1);
    expect(await store.listPromptItems("word")).toHaveLength(2);
  });

  it("marks pasted entries as not builtin so they survive a reset", async () => {
    const store = await storeWithWords("ferry");
    expect((await store.listPromptItems("word"))[0]!.builtin).toBe(false);
  });

  it("writes nothing for an empty paste", async () => {
    const store = await emptyStore();
    const result = await addPromptItems(store, "word", "  \n \n", 100);

    expect(result.added).toEqual([]);
    expect(await store.listPromptItems("word")).toEqual([]);
  });
});

describe("startPractice", () => {
  it("deals n prompts and records the run", async () => {
    const store = await storeWithWords("ferry", "attic", "cactus", "karaoke");
    const result = await startPractice(
      store,
      { kind: "words", n: 3, seconds: null },
      500,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prompts).toHaveLength(3);

    const [practice] = await store.listPromptPractices();
    expect(practice).toMatchObject({ kind: "words", n: 3, seconds: null, started_at: 500 });

    const draws = await store.listPromptDraws(practice!.id);
    expect(draws.map((d) => d.position)).toEqual([0, 1, 2]);
    expect(draws.map((d) => d.text)).toEqual(result.prompts);
    expect(draws.every((d) => d.kind === "words")).toBe(true);
  });

  it("stores a custom timer interval", async () => {
    const store = await storeWithWords("ferry", "attic");
    const result = await startPractice(store, { kind: "words", n: 1, seconds: 7 }, 500);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.practice.seconds).toBe(7);
  });

  it("avoids prompts from the previous run", async () => {
    const store = await storeWithWords("ferry", "attic", "cactus", "karaoke");
    const first = await startPractice(store, { kind: "words", n: 2, seconds: null }, 500);
    const second = await startPractice(store, { kind: "words", n: 2, seconds: null }, 600);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    for (const prompt of second.prompts) {
      expect(first.prompts).not.toContain(prompt);
    }
  });

  it("deals what the pool allows and reports what was asked for", async () => {
    const store = await storeWithWords("ferry", "attic");
    const result = await startPractice(store, { kind: "words", n: 5, seconds: null }, 500);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prompts).toHaveLength(2);
    expect(result.requested).toBe(5);
    expect(result.practice.n).toBe(2);
  });

  it("pairs two roles for a relationship run", async () => {
    const store = await emptyStore();
    await addPromptItems(store, "role", "a dentist\na stowaway", 100);
    const result = await startPractice(
      store,
      { kind: "relationships", n: 1, seconds: null },
      500,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([
      "A dentist and a stowaway",
      "A stowaway and a dentist",
    ]).toContain(result.prompts[0]);
  });

  it("refuses an empty pool without writing a run", async () => {
    const store = await emptyStore();
    const result = await startPractice(store, { kind: "words", n: 3, seconds: null }, 500);

    expect(result).toEqual({ ok: false, reason: "empty-pool", poolSize: 0, needed: 1 });
    expect(await store.listPromptPractices()).toEqual([]);
  });

  it("refuses a relationship run with only one role", async () => {
    const store = await emptyStore();
    await addPromptItems(store, "role", "a dentist", 100);
    const result = await startPractice(
      store,
      { kind: "relationships", n: 2, seconds: null },
      500,
    );

    expect(result).toEqual({ ok: false, reason: "empty-pool", poolSize: 1, needed: 2 });
  });

  it("draws from the word pool only, never the roles", async () => {
    const store = await emptyStore();
    await addPromptItems(store, "word", "ferry", 100);
    await addPromptItems(store, "role", "a dentist", 100);
    const result = await startPractice(store, { kind: "words", n: 5, seconds: null }, 500);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prompts).toEqual(["ferry"]);
  });
});

describe("listRecentPractices", () => {
  it("returns runs newest first with their prompts", async () => {
    const store = await storeWithWords("ferry", "attic", "cactus", "karaoke");
    await startPractice(store, { kind: "words", n: 2, seconds: null }, 500);
    const second = await startPractice(store, { kind: "words", n: 2, seconds: 7 }, 600);

    const history = await listRecentPractices(store);
    expect(history).toHaveLength(2);
    expect(history[0]!.practice.started_at).toBe(600);
    expect(second.ok && history[0]!.prompts).toEqual(second.ok ? second.prompts : []);
  });

  it("bounds the history to the limit", async () => {
    const store = await storeWithWords("ferry", "attic", "cactus");
    for (let i = 0; i < 4; i++) {
      await startPractice(store, { kind: "words", n: 1, seconds: null }, 500 + i);
    }
    expect(await listRecentPractices(store, 2)).toHaveLength(2);
  });
});

describe("backup round-trip", () => {
  it("carries the pools and practice history", async () => {
    const store = await storeWithWords("ferry", "attic");
    await startPractice(store, { kind: "words", n: 2, seconds: 7 }, 500);
    const json = await exportBackup(store, 900);

    const restored = await emptyStore();
    await restoreBackup(restored, json);

    expect((await restored.listPromptItems("word")).map((i) => i.text)).toEqual([
      "ferry",
      "attic",
    ]);
    const practices = await restored.listPromptPractices();
    expect(practices).toHaveLength(1);
    expect(practices[0]!.seconds).toBe(7);
    expect(await restored.listPromptDraws(practices[0]!.id)).toHaveLength(2);
  });
});
