import {
  RealReadwiseHighlightsClient,
  normalizeExportPage,
  normalizeBooksPage,
  READWISE_EXPORT_URL,
  READWISE_BOOKS_URL,
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
  user_book_id: 555,
  title: "raw title",
  readable_title: "Thinking, Fast and Slow",
  author: "Daniel Kahneman",
  highlights: [
    {
      id: 101,
      text: "  Nothing in life is as important as you think it is. ",
      note: "",
      location: 1234,
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
      bookId: "555",
      text: "Nothing in life is as important as you think it is.",
      note: null,
      bookTitle: "Thinking, Fast and Slow",
      bookAuthor: "Daniel Kahneman",
      url: "https://readwise.io/open/101",
      location: 1234,
      highlightedAt: Date.parse("2026-06-01T10:00:00Z"),
      updatedAt: Date.parse("2026-06-02T10:00:00Z"),
      deleted: false,
    });
    expect(b!.deleted).toBe(true);
    expect(c!.deleted).toBe(true);
    expect(c!.location).toBeNull();
    // falls back to a constructed open link
    expect(c!.url).toBe("https://readwise.io/open/103");
  });

  it("links to the Reader document, falling back to the book's, then the highlights page", () => {
    const reader = "https://read.readwise.io/read/abc";
    const out = normalizeExportPage({
      results: [
        {
          ...BOOK,
          unique_url: "https://read.readwise.io/read/book",
          highlights: [
            { id: 1, text: "a", url: reader, readwise_url: "https://readwise.io/open/1" },
            { id: 2, text: "b", url: "https://example.com/post", readwise_url: "https://readwise.io/open/2" },
            { id: 3, text: "c", url: null },
          ],
        },
        { ...BOOK, highlights: [{ id: 4, text: "d", readwise_url: "https://readwise.io/open/4" }] },
      ],
    });
    expect(out.map((h) => h.url)).toEqual([
      reader,
      "https://read.readwise.io/read/book", // non-Reader url ignored
      "https://read.readwise.io/read/book",
      "https://readwise.io/open/4", // no Reader link anywhere
    ]);
  });

  it("treats every highlight of a deleted book as deleted", () => {
    const out = normalizeExportPage({ results: [{ ...BOOK, is_deleted: true }] });
    expect(out.every((h) => h.deleted)).toBe(true);
  });
});

describe("normalizeBooksPage", () => {
  it("keeps id, title, author, category and counts", () => {
    expect(
      normalizeBooksPage({
        results: [
          {
            id: 9,
            title: " Atomic Habits ",
            author: "James Clear",
            category: "books",
            num_highlights: 42,
            last_highlight_at: "2026-05-01T00:00:00Z",
          },
          { title: "no id" },
        ],
      }),
    ).toEqual([
      {
        id: "9",
        title: "Atomic Habits",
        author: "James Clear",
        category: "books",
        numHighlights: 42,
        lastHighlightAt: Date.parse("2026-05-01T00:00:00Z"),
      },
    ]);
  });
});

describe("RealReadwiseHighlightsClient", () => {
  it("exports only the given books, paging with updatedAfter", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      expect((init!.headers as Record<string, string>).Authorization).toBe("Token fake-token");
      return urls.length === 1
        ? jsonResponse({ results: [BOOK], nextPageCursor: 77 })
        : jsonResponse({ results: [], nextPageCursor: null });
    }) as unknown as typeof fetch;
    const client = new RealReadwiseHighlightsClient({ tokenStore: new FakeTokenStore(), fetchImpl });
    const out = await client.exportHighlights(["555", "9"], Date.parse("2026-06-01T00:00:00Z"));
    expect(out).toHaveLength(3);
    expect(urls).toHaveLength(2);
    expect(urls[0]!.startsWith(READWISE_EXPORT_URL)).toBe(true);
    expect(urls[0]).toContain("ids=555%2C9");
    expect(urls[0]).toContain("updatedAfter=2026-06-01T00%3A00%3A00.000Z");
    expect(urls[1]).toContain("pageCursor=77");
  });

  it("fetches nothing for no books", async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    const client = new RealReadwiseHighlightsClient({ tokenStore: new FakeTokenStore(), fetchImpl });
    expect(await client.exportHighlights([], null)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lists books by following `next`", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return urls.length === 1
        ? jsonResponse({ results: [{ id: 1, title: "A" }], next: `${READWISE_BOOKS_URL}?page=2` })
        : jsonResponse({ results: [{ id: 2, title: "B" }], next: null });
    }) as unknown as typeof fetch;
    const client = new RealReadwiseHighlightsClient({ tokenStore: new FakeTokenStore(), fetchImpl });
    expect((await client.listBooks()).map((b) => b.id)).toEqual(["1", "2"]);
    expect(urls[0]).toContain("page_size=1000");
    expect(urls[1]).toBe(`${READWISE_BOOKS_URL}?page=2`);
  });

  it("surfaces auth and network failures", async () => {
    const noToken = new RealReadwiseHighlightsClient({ tokenStore: new FakeTokenStore(null) });
    await expect(noToken.listBooks()).rejects.toBeInstanceOf(ReadwiseAuthError);

    const unauthorized = new RealReadwiseHighlightsClient({
      tokenStore: new FakeTokenStore(),
      fetchImpl: (async () => jsonResponse({}, 401)) as unknown as typeof fetch,
    });
    await expect(unauthorized.exportHighlights(["1"], null)).rejects.toBeInstanceOf(ReadwiseAuthError);

    const limited = new RealReadwiseHighlightsClient({
      tokenStore: new FakeTokenStore(),
      fetchImpl: (async () => jsonResponse({}, 429)) as unknown as typeof fetch,
    });
    await expect(limited.listBooks()).rejects.toBeInstanceOf(ReadwiseNetworkError);
  });
});
