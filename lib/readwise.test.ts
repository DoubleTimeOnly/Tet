import {
  RealReadwiseClient,
  ReadwiseAuthError,
  ReadwiseNetworkError,
  READWISE_LIST_URL,
} from "./readwise";
import { FakeReadwiseClient, FakeTokenStore } from "./readwise.fake";

/** Build a fetch stub returning a given status + JSON body. */
function jsonFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    ({
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    }) as Response) as unknown as typeof fetch;
}

describe("FakeReadwiseClient (offline happy path)", () => {
  it("reports fraction and completeness against the default target", async () => {
    const client = new FakeReadwiseClient({ progress: { doc1: 0.95 } });
    const p = await client.getProgress("doc1");
    expect(p).toEqual({ documentId: "doc1", fraction: 0.95, isComplete: true });
  });

  it("unknown document reports fraction 0, not complete", async () => {
    const client = new FakeReadwiseClient();
    const p = await client.getProgress("missing");
    expect(p.fraction).toBe(0);
    expect(p.isComplete).toBe(false);
  });

  it("honors a per-call target override and records calls", async () => {
    const client = new FakeReadwiseClient({ progress: { doc1: 0.6 } });
    expect((await client.getProgress("doc1", 0.5)).isComplete).toBe(true);
    expect((await client.getProgress("doc1", 0.9)).isComplete).toBe(false);
    expect(client.calls).toEqual(["doc1", "doc1"]);
  });

  it("can be forced to fail to exercise error handling", async () => {
    const client = new FakeReadwiseClient({ failWith: new ReadwiseNetworkError() });
    await expect(client.getProgress("doc1")).rejects.toBeInstanceOf(ReadwiseNetworkError);
  });

  it("resolves a document id from a title (case-insensitive substring)", async () => {
    const client = new FakeReadwiseClient({
      documents: [
        { id: "01a", title: "Deep Work" },
        { id: "02b", title: "The Beginning of Infinity" },
        { id: "03c", title: "Working in Public" },
      ],
    });
    const matches = await client.findDocumentsByTitle("work");
    expect(matches.map((d) => d.id)).toEqual(["01a", "03c"]);
  });

  it("returns no matches for a blank query", async () => {
    const client = new FakeReadwiseClient({ documents: [{ id: "01a", title: "Deep Work" }] });
    expect(await client.findDocumentsByTitle("   ")).toEqual([]);
  });
});

describe("RealReadwiseClient — request shape (resolved spike)", () => {
  it("calls v3/list with id + Token auth header", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenHeaders = init.headers as Record<string, string>;
      return { status: 200, ok: true, json: async () => ({ results: [{ id: "doc1", reading_progress: 1 }] }) } as Response;
    }) as unknown as typeof fetch;

    const client = new RealReadwiseClient({ tokenStore: new FakeTokenStore("tok"), fetchImpl });
    await client.getProgress("doc1");

    expect(seenUrl).toBe(`${READWISE_LIST_URL}?id=doc1`);
    expect(seenHeaders.Authorization).toBe("Token tok");
    expect(seenHeaders.Accept).toBe("application/json");
  });

  it("maps reading_progress -> fraction and isComplete", async () => {
    const client = new RealReadwiseClient({
      tokenStore: new FakeTokenStore("tok"),
      fetchImpl: jsonFetch(200, { results: [{ id: "doc1", reading_progress: 0.92 }] }),
    });
    const p = await client.getProgress("doc1");
    expect(p.fraction).toBe(0.92);
    expect(p.isComplete).toBe(true);
  });

  it("ignores location: an archived doc with reading_progress 0 is NOT complete", async () => {
    const client = new RealReadwiseClient({
      tokenStore: new FakeTokenStore("tok"),
      // location 'archive' present but we never read it; progress is the only signal.
      fetchImpl: jsonFetch(200, { results: [{ id: "doc1", reading_progress: 0, location: "archive" }] }),
    });
    const p = await client.getProgress("doc1");
    expect(p.fraction).toBe(0);
    expect(p.isComplete).toBe(false);
  });

  it("clamps out-of-range progress into 0..1", async () => {
    const client = new RealReadwiseClient({
      tokenStore: new FakeTokenStore("tok"),
      fetchImpl: jsonFetch(200, { results: [{ id: "doc1", reading_progress: 1.4 }] }),
    });
    expect((await client.getProgress("doc1")).fraction).toBe(1);
  });

  it("missing results -> fraction 0, not an error", async () => {
    const client = new RealReadwiseClient({
      tokenStore: new FakeTokenStore("tok"),
      fetchImpl: jsonFetch(200, { results: [] }),
    });
    expect((await client.getProgress("doc1")).fraction).toBe(0);
  });
});

describe("RealReadwiseClient — error paths", () => {
  it("401 -> ReadwiseAuthError (prompt re-auth, not silent)", async () => {
    const client = new RealReadwiseClient({
      tokenStore: new FakeTokenStore("expired"),
      fetchImpl: jsonFetch(401, {}),
    });
    await expect(client.getProgress("doc1")).rejects.toBeInstanceOf(ReadwiseAuthError);
  });

  it("missing secure-store token -> ReadwiseAuthError (no network call)", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return jsonFetch(200, {})("", {});
    }) as unknown as typeof fetch;
    const client = new RealReadwiseClient({ tokenStore: new FakeTokenStore(null), fetchImpl });
    await expect(client.getProgress("doc1")).rejects.toBeInstanceOf(ReadwiseAuthError);
    expect(called).toBe(false);
  });

  it("network failure -> ReadwiseNetworkError (no crash)", async () => {
    const fetchImpl = (async () => {
      throw new Error("ETIMEDOUT");
    }) as unknown as typeof fetch;
    const client = new RealReadwiseClient({ tokenStore: new FakeTokenStore("tok"), fetchImpl });
    await expect(client.getProgress("doc1")).rejects.toBeInstanceOf(ReadwiseNetworkError);
  });

  it("non-2xx (e.g. 500) -> ReadwiseNetworkError", async () => {
    const client = new RealReadwiseClient({
      tokenStore: new FakeTokenStore("tok"),
      fetchImpl: jsonFetch(500, {}),
    });
    await expect(client.getProgress("doc1")).rejects.toBeInstanceOf(ReadwiseNetworkError);
  });

  it("invalid JSON -> ReadwiseNetworkError", async () => {
    const fetchImpl = (async () =>
      ({ status: 200, ok: true, json: async () => { throw new Error("bad json"); } }) as unknown as Response) as unknown as typeof fetch;
    const client = new RealReadwiseClient({ tokenStore: new FakeTokenStore("tok"), fetchImpl });
    await expect(client.getProgress("doc1")).rejects.toBeInstanceOf(ReadwiseNetworkError);
  });
});

describe("RealReadwiseClient — document listing by title", () => {
  it("pages through nextPageCursor and filters by title", async () => {
    const pages: Record<string, unknown> = {
      // no cursor -> page 1
      "": { results: [{ id: "01a", title: "Deep Work" }], nextPageCursor: "p2" },
      p2: { results: [{ id: "02b", title: "Working in Public" }], nextPageCursor: null },
    };
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      const cursor = new URL(url).searchParams.get("pageCursor") ?? "";
      seen.push(cursor);
      return { status: 200, ok: true, json: async () => pages[cursor] } as Response;
    }) as unknown as typeof fetch;

    const client = new RealReadwiseClient({ tokenStore: new FakeTokenStore("tok"), fetchImpl });
    const matches = await client.findDocumentsByTitle("work");

    expect(matches).toEqual([
      { id: "01a", title: "Deep Work" },
      { id: "02b", title: "Working in Public" },
    ]);
    expect(seen).toEqual(["", "p2"]); // followed the cursor exactly once
  });

  it("skips results missing id or title", async () => {
    const client = new RealReadwiseClient({
      tokenStore: new FakeTokenStore("tok"),
      fetchImpl: jsonFetch(200, {
        results: [{ id: "01a" }, { title: "no id" }, { id: "02b", title: "Keep me" }],
        nextPageCursor: null,
      }),
    });
    expect(await client.listDocuments()).toEqual([{ id: "02b", title: "Keep me" }]);
  });

  it("401 while listing -> ReadwiseAuthError", async () => {
    const client = new RealReadwiseClient({
      tokenStore: new FakeTokenStore("expired"),
      fetchImpl: jsonFetch(401, {}),
    });
    await expect(client.findDocumentsByTitle("x")).rejects.toBeInstanceOf(ReadwiseAuthError);
  });
});
