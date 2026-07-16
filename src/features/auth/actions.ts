"use server";

// Auth Server Actions: invite-gated registration and login. Every action
// validates its input with the shared Zod schemas, rate-limits, and returns a
// discriminated `{ ok }` union — errors are deliberately generic so they never
// reveal whether an email/username already exists.

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/db";
import { signIn } from "@/lib/auth";
import { hashToken } from "@/lib/tokens";
import { rateLimit } from "@/lib/rate-limit";
import { loginSchema, registerSchema } from "./schemas";

export type ActionResult = { ok: true } | { ok: false; error: string };

const FIFTEEN_MIN = 15 * 60_000;

// Sentinel so we can distinguish "invite no longer usable" (claimed concurrently /
// expired mid-transaction) from other DB failures inside the transaction.
class InviteUnavailableError extends Error {}

/** Postgres unique-constraint violation (Prisma error code P2002). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/**
 * Register a new user from an invite link. Rate-limited per hashed token and via a
 * global fallback. On success (in one transaction): claim the invite, create the
 * ACTIVE user with the invite's intended global role, and write an audit entry.
 */
export async function registerWithInvite(input: unknown): Promise<ActionResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { token, name, username, password } = parsed.data;
  const tokenHash = hashToken(token);

  // Per-token limit stops brute-forcing one invite; global limit is an
  // instance-wide fallback so an attacker can't fan out across many tokens.
  const perToken = rateLimit(`register:token:${tokenHash}`, {
    limit: 5,
    windowMs: FIFTEEN_MIN,
  });
  const global = rateLimit("register:global", {
    limit: 100,
    windowMs: FIFTEEN_MIN,
  });
  if (!perToken.ok || !global.ok) {
    return { ok: false, error: "Too many attempts. Please try again later." };
  }

  const invite = await prisma.invite.findUnique({ where: { tokenHash } });
  const now = new Date();
  if (
    !invite ||
    invite.acceptedAt ||
    invite.revokedAt ||
    invite.expiresAt < now
  ) {
    return { ok: false, error: "This invite link is invalid or has expired." };
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  try {
    await prisma.$transaction(async (tx) => {
      // Atomically claim the invite first — updateMany lets us guard on the
      // still-open conditions, so two concurrent redemptions can't both win.
      const claimed = await tx.invite.updateMany({
        where: {
          id: invite.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now },
      });
      if (claimed.count === 0) throw new InviteUnavailableError();

      const email = invite.email.toLowerCase();

      // Admin-created accounts (see admin `createUser`) pre-create an INVITED
      // user with this email and no password; the set-password link they receive
      // is an ordinary invite. Complete THAT existing row rather than inserting a
      // duplicate (which would hit the unique-email constraint). A pure invite —
      // no pre-created user — still falls through to the create branch below.
      const existing = await tx.user.findUnique({ where: { email } });

      let user;
      if (existing) {
        // Only an as-yet-unregistered (INVITED) account may be completed this
        // way. An ACTIVE/SUSPENDED account already owns this email, so the invite
        // cannot be used to take it over.
        if (existing.status !== "INVITED") throw new InviteUnavailableError();

        user = await tx.user.update({
          where: { id: existing.id },
          data: {
            name,
            username,
            hashedPassword,
            globalRole: invite.intendedGlobalRole,
            status: "ACTIVE",
          },
        });
      } else {
        user = await tx.user.create({
          data: {
            name,
            username,
            email,
            hashedPassword,
            globalRole: invite.intendedGlobalRole,
            status: "ACTIVE",
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "user.registered_via_invite",
          targetType: "User",
          targetId: user.id,
          metadata: { inviteId: invite.id, email: user.email },
        },
      });
    });

    return { ok: true };
  } catch (err) {
    if (err instanceof InviteUnavailableError) {
      return { ok: false, error: "This invite link is invalid or has expired." };
    }
    // Generic on unique violations so we don't leak whether the email exists as a
    // user vs. the username is taken.
    if (isUniqueViolation(err)) {
      return { ok: false, error: "That email or username is already in use." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/**
 * Check an invite token before rendering the register form. Returns the target
 * email for prefill on success and nothing distinguishing on failure (no leak of
 * why it's invalid — expired vs. accepted vs. nonexistent all look the same).
 */
export async function validateInviteToken(
  token: string,
): Promise<{ valid: boolean; email?: string }> {
  if (!token) return { valid: false };

  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { email: true, acceptedAt: true, revokedAt: true, expiresAt: true },
  });

  if (
    !invite ||
    invite.acceptedAt ||
    invite.revokedAt ||
    invite.expiresAt < new Date()
  ) {
    return { valid: false };
  }
  return { valid: true, email: invite.email };
}

/**
 * Password login. Rate-limited per email. Delegates credential verification to the
 * Credentials provider via `signIn(..., { redirect: false })`; any auth failure is
 * collapsed to one generic message (no user-existence leak). Non-auth errors
 * (e.g. Next's redirect signal) are rethrown for the framework to handle.
 */
export async function loginAction(input: unknown): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid email or password" };
  }
  const { email, password } = parsed.data;

  const limited = rateLimit(`login:${email}`, {
    limit: 10,
    windowMs: FIFTEEN_MIN,
  });
  if (!limited.ok) {
    return { ok: false, error: "Too many attempts. Please try again later." };
  }

  try {
    await signIn("credentials", { email, password, redirect: false });
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthError) {
      return { ok: false, error: "Invalid email or password" };
    }
    throw err;
  }
}
