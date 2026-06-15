import {
  type ReadwiseClient,
  type ReadingProgress,
  type TokenStore,
  DEFAULT_READING_TARGET,
} from "./readwise";

/**
 * In-memory ReadwiseClient for offline tests and local dev. Drives the
 * happy-path reading-verification flow without touching the network or
 * expo-secure-store. Set `failWith` to assert error-handling paths.
 */
export interface FakeReadwiseOptions {
  /** documentId -> reading_progress (0..1). Missing ids report fraction 0. */
  progress?: Record<string, number>;
  defaultTarget?: number;
  /** When set, getProgress rejects with this (e.g. ReadwiseNetworkError). */
  failWith?: Error;
}

export class FakeReadwiseClient implements ReadwiseClient {
  private readonly progress: Record<string, number>;
  private readonly defaultTarget: number;
  private readonly failWith?: Error;
  /** Records the documentIds requested, for assertions. */
  public readonly calls: string[] = [];

  constructor(opts: FakeReadwiseOptions = {}) {
    this.progress = opts.progress ?? {};
    this.defaultTarget = opts.defaultTarget ?? DEFAULT_READING_TARGET;
    this.failWith = opts.failWith;
  }

  setProgress(documentId: string, fraction: number): void {
    this.progress[documentId] = fraction;
  }

  async getProgress(
    documentId: string,
    target?: number,
  ): Promise<ReadingProgress> {
    this.calls.push(documentId);
    if (this.failWith) throw this.failWith;
    const fraction = this.progress[documentId] ?? 0;
    const t = target ?? this.defaultTarget;
    return { documentId, fraction, isComplete: fraction >= t };
  }
}

/** In-memory TokenStore for exercising RealReadwiseClient without Expo. */
export class FakeTokenStore implements TokenStore {
  constructor(private token: string | null = "fake-token") {}
  async getToken(): Promise<string | null> {
    return this.token;
  }
  set(token: string | null): void {
    this.token = token;
  }
}
