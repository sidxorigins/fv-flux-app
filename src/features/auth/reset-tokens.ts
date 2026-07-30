// Password-reset token issuing — shared by the public forgot-password flow
// (features/auth/actions.ts) and the admin "reset password" action
// (features/admin/actions.ts).
//
// This lives outside both action modules on purpose: a `"use server"` file may
// only export async Server Actions, so a plain helper cannot live there. Keeping
// one issuer also stops the two callers drifting apart on TTL, entropy, or the
// retire-the-previous-token rule — a second live token per user would mean a
// reset link the user thought they had cancelled still worked.

import { prisma } from "@/lib/db";
import { generateInviteToken, hashToken } from "@/lib/tokens";

/** Reset links are deliberately short-lived — see the password-reset design doc. */
export const RESET_TOKEN_TTL_MINUTES = 60;

/**
 * Retire the user's outstanding reset tokens, mint a new one, and return the
 * URL carrying the raw token. Only the SHA-256 hash is persisted; the raw value
 * exists solely in what we hand back here (an email, or the copyable link an
 * admin passes on out-of-band).
 *
 * Callers are responsible for authorising the request and for confirming the
 * user can actually use a password — this function does no permission checks.
 */
export async function issuePasswordResetToken(userId: string): Promise<string> {
  const token = generateInviteToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000);

  // Issuing a new link retires any earlier one, so at most a single live token
  // exists per user.
  await prisma.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.passwordResetToken.create({
    data: { userId, tokenHash, expiresAt },
  });

  return buildResetUrl(token);
}

/** Absolute reset URL. Base comes from env — never hardcode the domain. */
export function buildResetUrl(rawToken: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${appUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
}
