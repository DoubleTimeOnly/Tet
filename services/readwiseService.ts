import { RealReadwiseClient, type ReadwiseClient } from "../lib/readwise";
import { RealReadwiseHighlightsClient } from "../lib/readwiseHighlights";
import { createTokenStore } from "../adapters/tokenStore";
import type { Store } from "../db/store";
import {
  syncExcerpts,
  checkSource,
  reopenSource,
  type SyncResult,
} from "./excerpts";

/** Build the production Readwise client (token from secure-store/localStorage). */
export function createReadwiseClient(): ReadwiseClient {
  return new RealReadwiseClient({ tokenStore: createTokenStore() });
}

function highlightsClient(): RealReadwiseHighlightsClient {
  return new RealReadwiseHighlightsClient({ tokenStore: createTokenStore() });
}

/**
 * Every Readwise write to the excerpt tables runs one at a time: a sync and a
 * "check this source" both plan inserts from the same snapshot, and running
 * them side by side would insert the same new highlights twice.
 */
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

/** Automatic excerpt syncs run at most this often (app open / foreground). */
const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000;
let lastAutoSync = 0;
let inFlight: Promise<SyncResult> | null = null;

/**
 * Refresh the Readwise source list and sync checked sources. Concurrent
 * callers share one run. Throws ReadwiseAuthError / ReadwiseNetworkError.
 */
export function syncExcerptsNow(store: Store): Promise<SyncResult> {
  if (!inFlight) {
    inFlight = exclusive(() => syncExcerpts(store, highlightsClient())).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Check a source and fetch its highlights now. Throws like syncExcerptsNow. */
export function checkSourceNow(store: Store, sourceId: string) {
  return exclusive(() => checkSource(store, highlightsClient(), sourceId));
}

/** Reopen a done source and catch up on its highlights. */
export function reopenSourceNow(store: Store, sourceId: string) {
  return exclusive(() => reopenSource(store, highlightsClient(), sourceId));
}

/**
 * Background sync on app open / foreground: throttled, skipped without a
 * token, and silent on failure (the next open retries; "Sync now" in the
 * Library surfaces errors). Resolves null when it didn't run or failed.
 */
export async function autoSyncExcerpts(store: Store): Promise<SyncResult | null> {
  const now = Date.now();
  if (now - lastAutoSync < AUTO_SYNC_INTERVAL_MS) return null;
  lastAutoSync = now;
  try {
    if (!(await createTokenStore().getToken())) return null;
    return await syncExcerptsNow(store);
  } catch {
    return null;
  }
}
