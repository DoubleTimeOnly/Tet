/**
 * ReadwiseClient — normalizes Readwise Reader into a tiny ReadingProgress
 * shape so the rest of Tet never sees the raw API (eng-review Architecture #4).
 *
 * Open Q #1 RESOLVED (live spike 2026-06-15):
 *   - GET https://readwise.io/api/v3/list/?id=<docId>
 *     headers: Authorization: Token <token>, Accept: application/json
 *     documented rate limit ~20 req/min -> foreground polling only, well under.
 *   - Completion keys off `reading_progress` (float 0..1) ONLY.
 *   - `location` is NOT a done-signal: an archived doc can have
 *     reading_progress: 0 and never have been opened. Never use it.
 *   - `id` (stable opaque string) is the Task.source_ref.
 *
 * The token lives in expo-secure-store, never SQLite. It's reached through the
 * injectable TokenStore so this module (and its tests) carry no Expo import.
 */

export interface ReadingProgress {
  documentId: string;
  /** Readwise `reading_progress`, 0..1. */
  fraction: number;
  /** fraction >= target (per-task override of ~0.9). */
  isComplete: boolean;
}

export interface ReadwiseClient {
  /** @param target completion threshold (defaults to the client's default). */
  getProgress(documentId: string, target?: number): Promise<ReadingProgress>;
}

/** Secure store of the Readwise API token (expo-secure-store in the app). */
export interface TokenStore {
  getToken(): Promise<string | null>;
}

/** Bad/expired/missing token -> surface re-auth, never silently swallow. */
export class ReadwiseAuthError extends Error {
  constructor(message = "Readwise authentication failed") {
    super(message);
    this.name = "ReadwiseAuthError";
  }
}

/** Network/timeout/unexpected-status -> visible retryable state, no crash. */
export class ReadwiseNetworkError extends Error {
  constructor(message = "Readwise request failed") {
    super(message);
    this.name = "ReadwiseNetworkError";
  }
}

export const DEFAULT_READING_TARGET = 0.9;
export const READWISE_LIST_URL = "https://readwise.io/api/v3/list/";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface RealReadwiseClientOptions {
  tokenStore: TokenStore;
  /** Override for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  defaultTarget?: number;
  timeoutMs?: number;
}

interface ReadwiseListResponse {
  results?: Array<{
    id?: string;
    reading_progress?: number;
  }>;
}

export class RealReadwiseClient implements ReadwiseClient {
  private readonly tokenStore: TokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultTarget: number;
  private readonly timeoutMs: number;

  constructor(opts: RealReadwiseClientOptions) {
    this.tokenStore = opts.tokenStore;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.defaultTarget = opts.defaultTarget ?? DEFAULT_READING_TARGET;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getProgress(
    documentId: string,
    target?: number,
  ): Promise<ReadingProgress> {
    const token = await this.tokenStore.getToken();
    if (!token) {
      // Missing secure-store token: prompt re-auth rather than crash.
      throw new ReadwiseAuthError("No Readwise token stored");
    }

    const url = `${READWISE_LIST_URL}?id=${encodeURIComponent(documentId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Token ${token}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } catch (err) {
      throw new ReadwiseNetworkError(
        `Readwise request failed: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401) {
      throw new ReadwiseAuthError("Readwise token rejected (401)");
    }
    if (!res.ok) {
      throw new ReadwiseNetworkError(`Readwise responded ${res.status}`);
    }

    let body: ReadwiseListResponse;
    try {
      body = (await res.json()) as ReadwiseListResponse;
    } catch (err) {
      throw new ReadwiseNetworkError(
        `Readwise returned invalid JSON: ${(err as Error).message}`,
      );
    }

    const doc = body.results?.[0];
    // Absent doc/progress => treat as 0 read, not an error (doc may be unopened).
    const fraction = clampFraction(doc?.reading_progress ?? 0);
    const t = target ?? this.defaultTarget;

    return {
      documentId: doc?.id ?? documentId,
      fraction,
      isComplete: fraction >= t,
    };
  }
}

function clampFraction(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** SecureStore-backed token store for the app (lazy-required; not for tests). */
export function createSecureStoreTokenStore(
  key = "readwise_token",
): TokenStore {
  return {
    async getToken() {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const SecureStore = require("expo-secure-store") as {
        getItemAsync(k: string): Promise<string | null>;
      };
      return SecureStore.getItemAsync(key);
    },
  };
}
