import { prisma } from "@/lib/db";
import { hashApiKey, API_KEY_PREFIX } from "./api-key";
import { rateLimit } from "./rate-limit";
import type { User } from "@/generated/prisma/client";

export interface ApiAuthError {
  status: 401 | 403 | 429;
  code: string;
  message: string;
}

/**
 * Resolve an `Authorization: Bearer flux_sk_…` header to its actor user. GLOBAL
 * scope — a valid, non-revoked key may act on any project; the actor is used for
 * attribution only. Returns `{ actor }` or `{ error }` with the right status.
 */
export async function authenticateApiKey(
  request: Request,
): Promise<{ actor: User } | { error: ApiAuthError }> {
  const header = request.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key.startsWith(API_KEY_PREFIX)) {
    return { error: { status: 401, code: "unauthenticated", message: "Missing or malformed API key." } };
  }

  const record = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(key) },
    select: { id: true, prefix: true, revokedAt: true, user: true },
  });
  if (!record) {
    return { error: { status: 401, code: "unauthenticated", message: "Invalid API key." } };
  }
  if (record.revokedAt) {
    return { error: { status: 401, code: "key_revoked", message: "This API key has been revoked." } };
  }
  if (record.user.status !== "ACTIVE") {
    return { error: { status: 403, code: "actor_inactive", message: "The key's user is not active." } };
  }

  const rl = rateLimit(record.prefix, { limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return { error: { status: 429, code: "rate_limited", message: `Rate limit exceeded. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.` } };
  }

  // Best-effort last-used touch — never blocks or fails the request.
  void prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return { actor: record.user };
}
