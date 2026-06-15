import type { Store } from "./store";
import { SqliteStore } from "./sqliteStore";

/** Native: persistent raw expo-sqlite. (Web uses createStore.web -> MemoryStore.) */
export async function createStore(): Promise<Store> {
  const store = new SqliteStore();
  await store.init();
  return store;
}
