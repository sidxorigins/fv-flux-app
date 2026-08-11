import "server-only";

import { prisma } from "@/lib/db";
import {
  hashDisplayToken,
  hashesMatch,
  looksLikeDisplayToken,
} from "@/lib/display-token";

// Authorisation for the wall board. Two accepted routes:
//   1. a valid DisplayToken  — for the mini PC driving the TV
//   2. an admin session      — so a human can open /display without a token
//
// The token grants EXACTLY this page. It is not a session, carries no user
// identity, and cannot reach any other route.

export type DisplayAccess =
  | { ok: true; via: "token"; tokenId: string }
  | { ok: true; via: "admin" }
  | { ok: false };

/**
 * Validate a display token. Returns false for anything unknown, revoked, or
 * malformed — deliberately without distinguishing between them, so probing the
 * endpoint reveals nothing about which tokens exist.
 *
 * `lastUsedAt` is updated fire-and-forget: it is for the admin listing, and a
 * write failure must never take the wall board down.
 */
export async function verifyDisplayToken(
  token: string | undefined,
): Promise<DisplayAccess> {
  if (!token || !looksLikeDisplayToken(token)) return { ok: false };

  const hash = hashDisplayToken(token);
  const record = await prisma.displayToken.findUnique({
    where: { tokenHash: hash },
    select: { id: true, tokenHash: true, revokedAt: true },
  });

  if (!record || record.revokedAt !== null) return { ok: false };
  if (!hashesMatch(record.tokenHash, hash)) return { ok: false };

  void prisma.displayToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {
      // Best-effort telemetry only — never block the render.
    });

  return { ok: true, via: "token", tokenId: record.id };
}
