"use server";

// Self-service profile Server Actions. Every action resolves the target user
// from the session via `requireUser()` — none of them accept a `userId`
// input, so ownership is enforced by construction rather than by a check a
// caller could omit (see CLAUDE.md "User Profiles": a Member must not be
// able to edit another user's profile by crafting the request).

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { AuthorizationError, requireUser } from "@/lib/permissions";
import { buildAvatarKey, deleteObjects, presignUploadUrl } from "@/lib/r2";

import {
  avatarUploadSchema,
  finalizeAvatarSchema,
  updateProfileSchema,
} from "./schemas";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/** Postgres unique-constraint violation (Prisma error code P2002). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/** Map an AuthorizationError to a user-facing message; anything else is generic. */
function friendlyAuthError(err: unknown): string {
  if (err instanceof AuthorizationError) {
    switch (err.code) {
      case "UNAUTHENTICATED":
        return "You must be signed in to do that.";
      case "SUSPENDED":
        return "Your account has been suspended.";
      case "FORBIDDEN":
        return "You don't have permission to do that.";
    }
  }
  return "Something went wrong. Please try again.";
}

/**
 * Update the signed-in user's own name / username / bio. Username changes are
 * a lightweight audit event (per CLAUDE.md: not a security event on their
 * own, but the one field worth a trail) — everything else is silent.
 */
export async function updateProfile(input: unknown): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }

  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const { name, username, bio } = parsed.data;
  const nextBio = bio && bio.length > 0 ? bio : null;
  const usernameChanged = username !== user.username;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { name, username, bio: nextBio },
      });

      if (usernameChanged) {
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: "user.username_changed",
            targetType: "User",
            targetId: user.id,
            metadata: { old: user.username, new: username },
          },
        });
      }
    });
  } catch (err) {
    // Only `username` is uniquely constrained among the fields this action
    // writes, so any P2002 here means the username is taken.
    if (isUniqueViolation(err)) {
      return { ok: false, error: "That username is already taken." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  revalidatePath("/profile");
  return { ok: true };
}

/**
 * Mint a presigned PUT for a direct browser-to-R2 avatar upload. The object
 * key is derived from the session user's id — never client-supplied — so a
 * finalize call can never be pointed at someone else's key prefix.
 */
export async function requestAvatarUpload(
  input: unknown,
): Promise<ActionResult<{ uploadUrl: string; key: string }>> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }

  const parsed = avatarUploadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid file",
    };
  }
  const { contentType, size } = parsed.data;
  const key = buildAvatarKey(user.id);

  try {
    const uploadUrl = await presignUploadUrl(key, contentType, size);
    return { ok: true, data: { uploadUrl, key } };
  } catch {
    return {
      ok: false,
      error: "Could not prepare the upload. Please try again.",
    };
  }
}

/**
 * Confirm a completed direct-to-R2 avatar upload: point the user row at the
 * new key, then clean up the old object. Replace-then-delete (per CLAUDE.md
 * "User Profiles") so the avatar is never briefly missing mid-swap, and a
 * failed delete is a cleanup-job problem, not a user-facing error.
 */
export async function finalizeAvatar(input: unknown): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }

  const parsed = finalizeAvatarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid upload." };
  }
  const { key } = parsed.data;

  // No foreign-key finalize: the key must live under this user's own avatar
  // prefix, never one requested (or guessed) for someone else.
  const expectedPrefix = `avatars/${user.id}/`;
  if (!key.startsWith(expectedPrefix)) {
    return { ok: false, error: "Invalid upload." };
  }

  const oldKey = user.avatarKey;

  await prisma.user.update({
    where: { id: user.id },
    data: { avatarKey: key },
  });

  if (oldKey && oldKey !== key) {
    const { failed } = await deleteObjects([oldKey]);
    if (failed.length > 0) {
      console.warn(
        `[users/actions] finalizeAvatar: failed to delete old avatar object ${oldKey}`,
      );
    }
  }

  revalidatePath("/profile");
  return { ok: true };
}

/** Clear the signed-in user's avatar and delete the underlying R2 object. */
export async function removeAvatar(): Promise<ActionResult> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }

  const oldKey = user.avatarKey;
  if (!oldKey) {
    return { ok: true };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { avatarKey: null },
  });

  const { failed } = await deleteObjects([oldKey]);
  if (failed.length > 0) {
    console.warn(
      `[users/actions] removeAvatar: failed to delete old avatar object ${oldKey}`,
    );
  }

  revalidatePath("/profile");
  return { ok: true };
}
