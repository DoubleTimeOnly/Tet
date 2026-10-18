import {
  RealReadwiseHighlightsClient,
  normalizeExportPage,
  READWISE_EXPORT_URL,
} from "./readwiseHighlights";
import { FakeTokenStore } from "./readwise.fake";
import { ReadwiseAuthError, ReadwiseNetworkError } from "./readwise";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const BOOK = {
  title: "raw title",
  readable_title: "Thinking, Fast and Slow",
  author: "Daniel Kahneman",
  highlights: [
    {
      id: 101,
      text: "  Nothing in life is as important as you think it is. ",
      note: "",
      highlighted_at: "2026-06-01T10:00:00Z",
      updated_at: "2026-06-02T10:00:00Z",
      readwise_url: "https://readwise.io/open/101",
    },
    { id: 102, text: "gone", is_deleted: true, updated_at: "2026-06-03T00:00:00Z" },
    { id: 103, text: "discarded", is_discard: true },
  ],
};

describe("normalizeExportPage", () => {
  it("flattens books into highlights with source info", () => {
    const [a, b, c] = normalizeExportPage({ results: [BOOK] });
    expect(a).toEqual({
      id: "101",
      text: "Nothing in life is as important as you think it is.",
      note: null,
      bookTitle: "Thinking, Fast and Slow",
      bookAuthor: "Daniel Kahneman",
      url: "https://readwise.io/open/101",
      highlightedAt: Date.parse("2026-06-01T10:00:00Z"),
      updatedAt: Date.parse("2026-06-02T10:00:00Z"),
      deleted: false,
    });
    expect(b!.deleted).toBe(true);
    expect(c!.deleted).toBe(true);
    // falls back to a constructed open link
    expect(c!.url).toBe("https://readwise.io/open/103");
  });

  it("treats every highlight of a deleted book as deleted", () => {
    const out = normalizeExportPage({ results: [{ ...BOOK, is_deleted: true }] });
    expect(out.every((h) => h.deleted)).toBe(true);
  });
});

describe("RealReadwiseHighlightsClient", () => {
  it("pages through the export with the token and updatedAfter", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      expect((init!.headers as Record<string, string>).Authorization).toBe("Token fake-token");
      return urls.length === 1
        ? jsonResponse({ results: [BOOK], nextPageCursor: 77 })
        : jsonResponse({ results: [], nextPageCursor: null });
    }) as unknown as typeof fetch;
    const client = new RealReadwiseHighlightsClient({ tokenStore: new FakeTokenStore(), fetchImpl });
    const out = await client.exportHighlights(Date.parse("2026-06-01T00:00:00Z"));
    expect(out).toHaveLength(3);
    expect(urls).toHaveLength(2);
    expect(urls[0]!.startsWith(READWISE_EXPORT_URL)).toBe(true);
    expect(urls[0]).toContain("updatedAfter=2026-06-01T00%3A00%3A00.000Z");
    expect(urls[1]).toContain("pageCursor=77");
  });

  it("surfaces auth and network failures", async () => {
    const noToken = new RealReadwiseHighlightsClient({ tokenStore: new FakeTokenStore(null) });
    await expect(noToken.exportHighlights(null)).rejects.toBeInstanceOf(ReadwiseAuthError);

    const unauthorized = new RealReadwiseHighlightsClient({
      tokenStore: new FakeTokenStore(),
      fetchImpl: (async () => jsonResponse({}, 401)) as unknown as typeof fetch,
    });
    await expect(unauthorized.exportHighlights(null)).rejects.toBeInstanceOf(ReadwiseAuthError);

    const limited = new RealReadwiseHighlightsClient({
      tokenStore: new FakeTokenStore(),
      fetchImpl: (async () => jsonResponse({}, 429)) as unknown as typeof fetch,
    });
    await expect(limited.exportHighlights(null)).rejects.toBeInstanceOf(ReadwiseNetworkError);
  });
});
