import { RealReadwiseClient, type ReadwiseClient } from "../lib/readwise";
import { createTokenStore } from "../adapters/tokenStore";

/** Build the production Readwise client (token from secure-store/localStorage). */
export function createReadwiseClient(): ReadwiseClient {
  return new RealReadwiseClient({ tokenStore: createTokenStore() });
}
