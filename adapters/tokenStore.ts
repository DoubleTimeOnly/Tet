import { Platform } from "react-native";
import type { TokenStore } from "../lib/readwise";

/**
 * Readwise token storage. expo-secure-store on device (never SQLite);
 * localStorage on web so the preview can hold a token too.
 */
export interface WritableTokenStore extends TokenStore {
  setToken(token: string | null): Promise<void>;
}

/** Backing store for a single secret, keyed by name. */
function makeKeyStore(key: string): WritableTokenStore {
  if (Platform.OS === "web") {
    return {
      async getToken() {
        return globalThis.localStorage?.getItem(key) ?? null;
      },
      async setToken(token) {
        if (token) globalThis.localStorage?.setItem(key, token);
        else globalThis.localStorage?.removeItem(key);
      },
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SecureStore = require("expo-secure-store") as typeof import("expo-secure-store");
  return {
    async getToken() {
      return SecureStore.getItemAsync(key);
    },
    async setToken(token) {
      if (token) await SecureStore.setItemAsync(key, token);
      else await SecureStore.deleteItemAsync(key);
    },
  };
}

export function createTokenStore(): WritableTokenStore {
  return makeKeyStore("readwise_token");
}

/** YouTube Data API key, used to read playlist tasks. Same storage as the token. */
export function createYoutubeApiKeyStore(): WritableTokenStore {
  return makeKeyStore("youtube_api_key");
}
