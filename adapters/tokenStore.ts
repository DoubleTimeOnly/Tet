import { Platform } from "react-native";
import type { TokenStore } from "../lib/readwise";

/**
 * Readwise token storage. expo-secure-store on device (never SQLite);
 * localStorage on web so the preview can hold a token too.
 */
export interface WritableTokenStore extends TokenStore {
  setToken(token: string | null): Promise<void>;
}

const KEY = "readwise_token";

export function createTokenStore(): WritableTokenStore {
  if (Platform.OS === "web") {
    return {
      async getToken() {
        return globalThis.localStorage?.getItem(KEY) ?? null;
      },
      async setToken(token) {
        if (token) globalThis.localStorage?.setItem(KEY, token);
        else globalThis.localStorage?.removeItem(KEY);
      },
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SecureStore = require("expo-secure-store") as typeof import("expo-secure-store");
  return {
    async getToken() {
      return SecureStore.getItemAsync(KEY);
    },
    async setToken(token) {
      if (token) await SecureStore.setItemAsync(KEY, token);
      else await SecureStore.deleteItemAsync(KEY);
    },
  };
}
