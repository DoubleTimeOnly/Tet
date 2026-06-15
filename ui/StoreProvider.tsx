import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ActivityIndicator, View } from "react-native";
import type { Store } from "../db/store";
import { createStore } from "../db/createStore";
import { seedStarterDeck } from "../services/authoring";

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
      if (decks.length === 0) await seedStarterDeck(s);
      if (!cancelled) setStore(s);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
