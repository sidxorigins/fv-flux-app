import { createHash, randomBytes } from "node:crypto";

export const API_KEY_PREFIX = "flux_sk_";

/** sha256 hex of a full key — the stored/looked-up form. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Mint a new key: `flux_sk_<random>`. Returns the plaintext (shown once), a
 * 16-char `prefix` for identification in listings, and the sha256 hash to store.
 */
export function generateApiKey(): { key: string; prefix: string; keyHash: string } {
  const key = API_KEY_PREFIX + randomBytes(24).toString("base64url");
  return { key, prefix: key.slice(0, 16), keyHash: hashApiKey(key) };
}
