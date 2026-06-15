/**
 * Stable id generation. Uses the platform crypto UUID when available
 * (Node, and Hermes via expo-crypto polyfill), falling back to a
 * timestamp+random token so pure logic stays runnable in any environment.
 *
 * Callers that need deterministic ids in tests inject their own via opts.
 */
export function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
