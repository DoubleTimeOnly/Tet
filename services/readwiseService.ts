import { RealReadwiseClient, type ReadwiseClient } from "../lib/readwise";
import { RealReadwiseHighlightsClient } from "../lib/readwiseHighlights";
import { createTokenStore } from "../adapters/tokenStore";
import type { Store } from "../db/store";
import { syncExcerpts, type SyncResult } from "./excerpts";

/** Build the production Readwise client (token from secure-store/localStorage). */
export function createReadwiseClient(): ReadwiseClient {
  return new RealReadwiseClient({ tokenStore: createTokenStore() });
}

/** Automatic excerpt syncs run at most this often (app open / foreground). */
const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000;
let lastAutoSync = 0;
let inFlight: Promise<SyncResult> | null = null;

/**
 * Sync Readwise highlights into the excerpt queue. Concurrent callers share
 * one run, so an app-open sync and a tap on "Sync now" can't both insert the
 * same new highlights. Throws ReadwiseAuthError / ReadwiseNetworkError.
 */
export function syncExcerptsNow(store: Store): Promise<SyncResult> {
  if (!inFlight) {
    const client = new RealReadwiseHighlightsClient({ tokenStore: createTokenStore() });
    inFlight = syncExcerpts(store, client).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
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
