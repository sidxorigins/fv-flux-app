import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Wall-display access tokens. Mirrors lib/api-key.ts so the codebase has one
// credential pattern rather than two — same prefix + sha256 shape, same
// "plaintext shown once" contract.
//
// Deliberately NOT a JWT: this needs server-side revocation (a TV in a room
// anyone walks through), and a stateless token can't be revoked without a
// denylist — which is a database lookup anyway.

export const DISPLAY_TOKEN_PREFIX = "flux_dt_";

/** sha256 hex of a full token — the stored and looked-up form. */
export function hashDisplayToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mint a token: `flux_dt_<random>`. Returns the plaintext (shown once at
 * creation, never recoverable), a 16-char prefix for identification in
 * listings, and the hash to store.
 */
export function generateDisplayToken(): {
  token: string;
  prefix: string;
  tokenHash: string;
} {
  const token = DISPLAY_TOKEN_PREFIX + randomBytes(24).toString("base64url");
  return {
    token,
    prefix: token.slice(0, 16),
    tokenHash: hashDisplayToken(token),
  };
}

/** Shape check before touching the database — rejects obvious junk without a
 * query, and keeps the DB lookup off the hot path for random URL probing. */
export function looksLikeDisplayToken(value: string): boolean {
  return (
    value.startsWith(DISPLAY_TOKEN_PREFIX) &&
    value.length > DISPLAY_TOKEN_PREFIX.length + 16 &&
    value.length < 128
  );
}

/**
 * Constant-time comparison of two hex hashes. The lookup itself is by unique
 * index (already constant-ish), but comparing here rather than relying on
 * string equality keeps the pattern honest if the lookup ever changes.
 */
export function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}
