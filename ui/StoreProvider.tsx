import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ActivityIndicator, AppState, View } from "react-native";
import type { Store } from "../db/store";
import { createStore } from "../db/createStore";
import { seedStarterDeck } from "../services/authoring";
import { seedObsidianFlashcards } from "../services/seedObsidian";
import { seedPromptPools } from "../services/prompts";
import { runAutoBackup } from "../services/autoBackupService";
import { backupFiles } from "../adapters/backupFiles";
import { driveBackup } from "../adapters/driveBackup";
import { autoSyncExcerpts } from "../services/readwiseService";
import { ensureExcerptSources } from "../services/excerpts";

interface StoreContextValue {
  store: Store;
  tz: string;
  /** Bumped to signal screens to refetch after a mutation. */
  version: number;
  reload: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Daily snapshot to the local destination and, if the user has signed in, to
 * Google Drive. Independent: each runs its own schedule against its own file
 * list, and neither can throw (runAutoBackup reports failures instead), so a
 * Drive outage — offline, revoked access — never costs the local snapshot.
 */
async function backUpEverywhere(store: Store): Promise<void> {
  const local = runAutoBackup(store, backupFiles);
  const cloud = (async () => {
    if (await driveBackup.hasFolder()) await runAutoBackup(store, driveBackup);
  })().catch((e) => console.warn("[driveBackup] skipped:", e));
  await Promise.all([local, cloud]);
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<Store | null>(null);
  const [version, setVersion] = useState(0);
  const tz = useMemo(deviceTimeZone, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await createStore();
      // Cold start: seed a starter deck + review task on first run.
      const decks = await s.listDecks();
      if (decks.length === 0) {
        // Cold start seeds the bundled Obsidian flashcard export (schedule
        // preserved), then a starter review task so the day isn't empty.
        await seedObsidianFlashcards(s);
        await seedStarterDeck(s);
      }
      // Idempotent and independent of the deck seed, so an install that
      // predates improv prompts picks up the bundled pools on next launch.
      await seedPromptPools(s);
      // Excerpts imported before sources existed get one source per book.
      await ensureExcerptSources(s);
      if (!cancelled) setStore(s);
      // Daily safety snapshot. Deliberately not awaited: the app renders as
      // soon as the store is ready, and runAutoBackup swallows its own errors,
      // so a slow or failing write is never visible here. It no-ops unless a
      // day has passed since the last one.
      void backUpEverywhere(s);
      // New Readwise highlights flow into the excerpt queue on their own.
      // Also not awaited, and silent on failure; refetch screens if it added any.
      void autoSyncExcerpts(s).then((r) => {
        if (r && (r.added > 0 || r.removed > 0 || r.newSources > 0) && !cancelled) {
          setVersion((v) => v + 1);
        }
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Re-check the daily snapshot whenever the app comes back to the foreground.
   *
   * The startup call below only fires on a COLD start — a fresh JS context.
   * Android keeps a process alive for days, so "close and reopen the app" in
   * the normal sense (background, then back) never re-ran it, and a user who
   * doesn't force-stop the app could go weeks between snapshots while Settings
   * claimed it backs up "when you open it". runAutoBackup is cheap when nothing
   * is due (one directory listing) and never throws.
   */
  useEffect(() => {
    if (!store) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      void backUpEverywhere(store);
      void autoSyncExcerpts(store).then((r) => {
        if (r && (r.added > 0 || r.removed > 0 || r.newSources > 0)) setVersion((v) => v + 1);
      });
    });
    return () => sub.remove();
  }, [store]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const value = useMemo(
    () => (store ? { store, tz, version, reload } : null),
    [store, tz, version, reload],
  );

  if (!value) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
