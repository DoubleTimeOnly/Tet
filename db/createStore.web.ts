import type { Store } from "./store";
import { MemoryStore } from "./memoryStore";

/**
 * Web preview: in-memory store so `expo start --web` runs without native
 * sqlite (and without pulling expo-sqlite's wasm into the web bundle). Data
 * is ephemeral on web; persistent on device via createStore.ts.
 */
export async function createStore(): Promise<Store> {
  const store = new MemoryStore();
  await store.init();
  return store;
}
