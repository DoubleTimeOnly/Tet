import {
  ReadwiseAuthError,
  ReadwiseNetworkError,
  type TokenStore,
} from "./readwise";

/**
 * Readwise highlights client — normalizes the v2 API into flat shapes so the
 * excerpt code never sees the raw responses. Separate from lib/readwise
 * (Reader v3, reading progress) because it's a different API with a different
 * shape; the token and error types are shared.
 *
 *   GET https://readwise.io/api/v2/books/?page_size=1000&page=<n>
 *   -> { count, next, results: Book[] } — the source list, no highlights.
 *
 *   GET https://readwise.io/api/v2/export/?ids=<book ids>&updatedAfter=<ISO>&pageCursor=<c>
 *   -> { count, nextPageCursor, results: Book[] }, each Book carrying its
 *      highlights. `ids` limits it to the given books; with updatedAfter, only
 *      highlights changed since then are returned — including ones deleted
 *      (is_deleted) or discarded.
 *
 * Both are under the same token: Authorization: Token <token>.
 */

/** One Readwise source (book, article, …) as listed, without its highlights. */
export interface ReadwiseBook {
  /** Readwise user_book_id (stringified). */
  id: string;
  title: string;
  author: string | null;
  category: string | null;
  numHighlights: number;
  lastHighlightAt: number | null;
}

export interface ReadwiseHighlight {
  /** Readwise highlight id (stringified) — the dedup key. */
  id: string;
  /** The user_book_id of the source it belongs to. */
  bookId: string;
  text: string;
  note: string | null;
  bookTitle: string;
  bookAuthor: string | null;
  /** Opens the highlight on Readwise. */
  url: string | null;
  /** Position within the source, for book order. */
  location: number | null;
  highlightedAt: number | null;
  updatedAt: number;
  /** Deleted or discarded in Readwise (the highlight, or its whole book). */
  deleted: boolean;
}

export interface ReadwiseHighlightsClient {
  /** Every source in the Readwise library (titles and counts only). */
  listBooks(): Promise<ReadwiseBook[]>;
  /**
   * Highlights of the given books changed after `updatedAfter` (epoch ms), or
   * all of them if null. An empty `bookIds` fetches nothing.
   */
  exportHighlights(bookIds: string[], updatedAfter: number | null): Promise<ReadwiseHighlight[]>;
}

export const READWISE_EXPORT_URL = "https://readwise.io/api/v2/export/";
export const READWISE_BOOKS_URL = "https://readwise.io/api/v2/books/";
const DEFAULT_TIMEOUT_MS = 20_000;
/** Runaway guard on cursor loops; a real library is far below this. */
const MAX_PAGES = 500;
/** Readwise's maximum page size for list endpoints. */
const BOOKS_PAGE_SIZE = 1000;

interface ExportHighlight {
  id?: number | string;
  text?: string;
  note?: string | null;
  location?: number | null;
  highlighted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  /** Reader deep link (read.readwise.io/read/<id>) for highlights made in Reader. */
  url?: string | null;
  readwise_url?: string | null;
  is_deleted?: boolean;
  is_discard?: boolean;
}

interface ExportBook {
  user_book_id?: number | string;
  title?: string;
  readable_title?: string;
  author?: string | null;
  /** The whole document in Reader, for books whose highlights carry no link. */
  unique_url?: string | null;
  is_deleted?: boolean;
  highlights?: ExportHighlight[];
}

interface ExportResponse {
  results?: ExportBook[];
  nextPageCursor?: string | number | null;
}

interface BooksResponse {
  results?: Array<{
    id?: number | string;
    title?: string;
    author?: string | null;
    category?: string | null;
    num_highlights?: number;
    last_highlight_at?: string | null;
  }>;
  next?: string | null;
}

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Only a Reader link counts; other `url`s point at the original web page. */
function readerUrl(url: string | null | undefined): string | null {
  return url && url.startsWith("https://read.readwise.io/") ? url : null;
}

/** Flatten one export page into highlights. Exported for tests. */
export function normalizeExportPage(body: ExportResponse): ReadwiseHighlight[] {
  const out: ReadwiseHighlight[] = [];
  for (const book of body.results ?? []) {
    const bookTitle = (book.readable_title || book.title || "Untitled").trim();
    const bookAuthor = book.author?.trim() || null;
    const bookId = book.user_book_id === undefined ? "" : String(book.user_book_id);
    for (const h of book.highlights ?? []) {
      if (h.id === undefined || h.id === null) continue;
      const id = String(h.id);
      const updatedAt =
        parseTime(h.updated_at) ?? parseTime(h.highlighted_at) ?? parseTime(h.created_at) ?? 0;
      out.push({
        id,
        bookId,
        text: (h.text ?? "").trim(),
        note: h.note?.trim() || null,
        bookTitle,
        bookAuthor,
        // Prefer Reader (read in context) over Readwise's highlights-only page.
        url: readerUrl(h.url) || readerUrl(book.unique_url) || h.readwise_url || `https://readwise.io/open/${id}`,
        location: typeof h.location === "number" ? h.location : null,
        highlightedAt: parseTime(h.highlighted_at) ?? parseTime(h.created_at),
        updatedAt,
        deleted: Boolean(h.is_deleted || h.is_discard || book.is_deleted),
      });
    }
  }
  return out;
}

/** Normalise one /books/ page. Exported for tests. */
export function normalizeBooksPage(body: BooksResponse): ReadwiseBook[] {
  const out: ReadwiseBook[] = [];
  for (const b of body.results ?? []) {
    if (b.id === undefined || b.id === null) continue;
    out.push({
      id: String(b.id),
      title: b.title?.trim() || "Untitled",
      author: b.author?.trim() || null,
      category: b.category ?? null,
      numHighlights: b.num_highlights ?? 0,
      lastHighlightAt: parseTime(b.last_highlight_at),
    });
  }
  return out;
}

export interface RealReadwiseHighlightsClientOptions {
  tokenStore: TokenStore;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class RealReadwiseHighlightsClient implements ReadwiseHighlightsClient {
  private readonly tokenStore: TokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: RealReadwiseHighlightsClientOptions) {
    this.tokenStore = opts.tokenStore;
    // Wrapped, not stored bare: a browser's fetch throws "Illegal invocation"
    // when called as a method of some other object.
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async listBooks(): Promise<ReadwiseBook[]> {
    const token = await this.token();
    const out: ReadwiseBook[] = [];
    let url: string | null = `${READWISE_BOOKS_URL}?page_size=${BOOKS_PAGE_SIZE}`;
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const body: BooksResponse = await this.getJson<BooksResponse>(token, url);
      out.push(...normalizeBooksPage(body));
      url = body.next ?? null;
    }
    return out;
  }

  async exportHighlights(
    bookIds: string[],
    updatedAfter: number | null,
  ): Promise<ReadwiseHighlight[]> {
    if (bookIds.length === 0) return [];
    const token = await this.token();
    const out: ReadwiseHighlight[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params: Record<string, string> = { ids: bookIds.join(",") };
      if (updatedAfter !== null) params.updatedAfter = new Date(updatedAfter).toISOString();
      if (cursor) params.pageCursor = cursor;
      const qs = new URLSearchParams(params).toString();
      const body = await this.getJson<ExportResponse>(token, `${READWISE_EXPORT_URL}?${qs}`);
      out.push(...normalizeExportPage(body));
      if (body.nextPageCursor === null || body.nextPageCursor === undefined) break;
      cursor = String(body.nextPageCursor);
    }
    return out;
  }

  private async token(): Promise<string> {
    const token = await this.tokenStore.getToken();
    if (!token) throw new ReadwiseAuthError("No Readwise token stored");
    return token;
  }

  private async getJson<T>(token: string, url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Token ${token}`, Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (err) {
      throw new ReadwiseNetworkError(`Readwise request failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401) throw new ReadwiseAuthError("Readwise token rejected (401)");
    if (!res.ok) throw new ReadwiseNetworkError(`Readwise responded ${res.status}`);
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new ReadwiseNetworkError(
        `Readwise returned invalid JSON: ${(err as Error).message}`,
      );
    }
  }
}

/**
 * In-memory client for tests: a book list plus highlights, filtered the way
 * the real export filters them (by book id, then by updatedAfter).
 */
export class FakeReadwiseHighlightsClient implements ReadwiseHighlightsClient {
  public readonly calls: Array<{ bookIds: string[]; updatedAfter: number | null }> = [];
  constructor(
    public books: ReadwiseBook[] = [],
    public highlights: ReadwiseHighlight[] = [],
    private readonly failWith?: Error,
  ) {}
  async listBooks(): Promise<ReadwiseBook[]> {
    if (this.failWith) throw this.failWith;
    return this.books.map((b) => ({ ...b }));
  }
  async exportHighlights(
    bookIds: string[],
    updatedAfter: number | null,
  ): Promise<ReadwiseHighlight[]> {
    if (bookIds.length === 0) return [];
    this.calls.push({ bookIds: [...bookIds], updatedAfter });
    if (this.failWith) throw this.failWith;
    const ids = new Set(bookIds);
    return this.highlights
      .filter((h) => ids.has(h.bookId))
      .filter((h) => updatedAfter === null || h.updatedAt > updatedAfter)
      .map((h) => ({ ...h }));
  }
}
