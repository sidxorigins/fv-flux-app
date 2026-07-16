// Server-only avatar URL resolution. Avatars are private-bucket R2 objects
// (see CLAUDE.md "File Attachments" / "User Profiles") — every render needs a
// fresh presigned GET rather than a stored public link. A dashboard-style
// screen can render many avatars in one pass (topbar, assignee lists, admin
// user table), so presigning the same key repeatedly per request is wasted
// R2 API calls; this module memoises in-process with a TTL comfortably under
// the presign expiry so a served URL never goes stale mid-render.

import { prisma } from "@/lib/db";
import { presignDownloadUrl } from "@/lib/r2";

// Presign expiry (lib/r2.ts) is 10 minutes; cache for less than that so a
// cached URL is never handed out close to expiring.
const CACHE_TTL_MS = 8 * 60 * 1000;

// Crude bound on the memo so a long-lived server process (many distinct
// users' avatars over time) doesn't grow this unboundedly — cheaper than a
// real LRU for what is a small hot-path cache.
const MAX_ENTRIES = 500;

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Presigned GET URL for an avatar object key, or `null` when there is no
 * avatar. Memoised per key for ~8 minutes so repeated calls in the same
 * render (or nearby ones) don't re-presign against R2 every time.
 */
export async function getAvatarUrl(
  avatarKey: string | null,
): Promise<string | null> {
  if (!avatarKey) return null;

  const now = Date.now();
  const cached = cache.get(avatarKey);
  if (cached && cached.expiresAt > now) {
    return cached.url;
  }

  const url = await presignDownloadUrl(avatarKey);

  if (cache.size >= MAX_ENTRIES) {
    cache.clear();
  }
  cache.set(avatarKey, { url, expiresAt: now + CACHE_TTL_MS });

  return url;
}

/** Convenience: resolve a user's avatar URL by id (looks up `avatarKey` first). */
export async function getUserAvatarUrl(
  userId: string,
): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarKey: true },
  });
  return getAvatarUrl(user?.avatarKey ?? null);
}
