import {
  ReadwiseAuthError,
  ReadwiseNetworkError,
  type TokenStore,
} from "./readwise";

/**
 * Readwise highlights client — normalizes the v2 export endpoint into a flat
 * ReadwiseHighlight so the excerpt code never sees the raw API. Separate from
 * lib/readwise (Reader v3, reading progress) because it's a different API with
 * a different shape; the token and error types are shared.
 *
 *   GET https://readwise.io/api/v2/export/?updatedAfter=<ISO>&pageCursor=<c>
 *   headers: Authorization: Token <token>
 *   -> { count, nextPageCursor, results: Book[] }, each Book carrying its
 *      highlights. With updatedAfter, only highlights changed since then are
 *      returned — including ones deleted (is_deleted) or discarded.
 */

export interface ReadwiseHighlight {
  /** Readwise highlight id (stringified) — the dedup key. */
  id: string;
  text: string;
  note: string | null;
  bookTitle: string;
  bookAuthor: string | null;
  /** Opens the highlight on Readwise. */
  url: string | null;
  highlightedAt: number | null;
  updatedAt: number;
  /** Deleted or discarded in Readwise (the highlight, or its whole book). */
  deleted: boolean;
}

export interface ReadwiseHighlightsClient {
  /** Every highlight changed after `updatedAfter` (epoch ms), or all if null. */
  exportHighlights(updatedAfter: number | null): Promise<ReadwiseHighlight[]>;
}

export const READWISE_EXPORT_URL = "https://readwise.io/api/v2/export/";
const DEFAULT_TIMEOUT_MS = 20_000;
/** Runaway guard on cursor loops; a real library is far below this. */
const MAX_EXPORT_PAGES = 500;

interface ExportHighlight {
  id?: number | string;
  text?: string;
  note?: string | null;
  highlighted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  readwise_url?: string | null;
  is_deleted?: boolean;
  is_discard?: boolean;
}

interface ExportBook {
  title?: string;
  readable_title?: string;
  author?: string | null;
  is_deleted?: boolean;
  highlights?: ExportHighlight[];
}

interface ExportResponse {
  results?: ExportBook[];
  nextPageCursor?: string | number | null;
}

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Flatten one export page into highlights. Exported for tests. */
export function normalizeExportPage(body: ExportResponse): ReadwiseHighlight[] {
  const out: ReadwiseHighlight[] = [];
  for (const book of body.results ?? []) {
    const bookTitle = (book.readable_title || book.title || "Untitled").trim();
    const bookAuthor = book.author?.trim() || null;
    for (const h of book.highlights ?? []) {
      if (h.id === undefined || h.id === null) continue;
      const id = String(h.id);
      const updatedAt =
        parseTime(h.updated_at) ?? parseTime(h.highlighted_at) ?? parseTime(h.created_at) ?? 0;
      out.push({
        id,
        text: (h.text ?? "").trim(),
        note: h.note?.trim() || null,
        bookTitle,
        bookAuthor,
        url: h.readwise_url || `https://readwise.io/open/${id}`,
        highlightedAt: parseTime(h.highlighted_at) ?? parseTime(h.created_at),
        updatedAt,
        deleted: Boolean(h.is_deleted || h.is_discard || book.is_deleted),
      });
    }
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

  async exportHighlights(updatedAfter: number | null): Promise<ReadwiseHighlight[]> {
    const token = await this.tokenStore.getToken();
    if (!token) throw new ReadwiseAuthError("No Readwise token stored");

    const out: ReadwiseHighlight[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_EXPORT_PAGES; page++) {
      const params: Record<string, string> = {};
      if (updatedAfter !== null) params.updatedAfter = new Date(updatedAfter).toISOString();
      if (cursor) params.pageCursor = cursor;
      const body = await this.fetchPage(token, params);
      out.push(...normalizeExportPage(body));
      if (body.nextPageCursor === null || body.nextPageCursor === undefined) break;
      cursor = String(body.nextPageCursor);
    }
    return out;
  }

  private async fetchPage(
    token: string,
    params: Record<string, string>,
  ): Promise<ExportResponse> {
    const qs = new URLSearchParams(params).toString();
    const url = qs ? `${READWISE_EXPORT_URL}?${qs}` : READWISE_EXPORT_URL;
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
      return (await res.json()) as ExportResponse;
    } catch (err) {
      throw new ReadwiseNetworkError(
        `Readwise returned invalid JSON: ${(err as Error).message}`,
      );
    }
  }
}

/** In-memory client for tests: returns the highlights updated after the cursor. */
export class FakeReadwiseHighlightsClient implements ReadwiseHighlightsClient {
  public readonly calls: (number | null)[] = [];
  constructor(
    public highlights: ReadwiseHighlight[] = [],
    private readonly failWith?: Error,
  ) {}
  async exportHighlights(updatedAfter: number | null): Promise<ReadwiseHighlight[]> {
    this.calls.push(updatedAfter);
    if (this.failWith) throw this.failWith;
    return this.highlights
      .filter((h) => updatedAfter === null || h.updatedAt > updatedAfter)
      .map((h) => ({ ...h }));
  }
}
