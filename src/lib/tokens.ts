// Invite / set-password token helpers.
//
// Contract: a high-entropy random token is generated once and shown to the user
// (in the invite link). Only its SHA-256 hash is stored (Invite.tokenHash, unique).
// On redemption we hash the presented token and look it up by hash, so a DB leak
// never exposes usable tokens.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 bytes (256 bits) of entropy, URL-safe. Store the hash, mail the raw value. */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex digest — the value persisted in Invite.tokenHash. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Constant-time comparison of two SHA-256 hex digests. Prefer looking a token up
 * by its hash via the unique index; use this when comparing an already-fetched
 * stored hash against a freshly computed one to avoid timing side channels.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  // Guard against malformed (non-hex) input producing mismatched buffer lengths.
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}
