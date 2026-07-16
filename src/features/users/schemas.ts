// User-profile Zod schemas — the single source of truth reused on client
// (react-hook-form resolvers) and server (Server Actions in ./actions.ts).
// Username validation is NOT redefined here — it's imported from
// @/features/auth/schemas so registration and profile-editing never drift.

import { z } from "zod";

import { usernameSchema } from "@/features/auth/schemas";
import { AVATAR_ALLOWED_TYPES, AVATAR_MAX_BYTES } from "@/lib/r2";

/**
 * Self-service profile edit: name, username, bio. Ownership (which user this
 * applies to) is never part of the payload — the Server Action resolves the
 * target from the session (`requireUser()`), so there is no `userId` field to
 * validate or spoof here.
 */
export const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(80, "Name must be at most 80 characters"),
  username: usernameSchema,
  // Optional + capped. An empty string is valid input (clears the bio) — the
  // Server Action normalises "" to `null` before writing to the DB.
  bio: z
    .string()
    .trim()
    .max(280, "Bio must be at most 280 characters")
    .optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Pre-flight check before minting a presigned PUT for an avatar upload. */
export const avatarUploadSchema = z.object({
  contentType: z.enum(AVATAR_ALLOWED_TYPES, {
    error: "Only PNG, JPEG, or WebP images are allowed",
  }),
  size: z
    .number()
    .int()
    .positive()
    .max(
      AVATAR_MAX_BYTES,
      `File must be under ${Math.floor(AVATAR_MAX_BYTES / (1024 * 1024))}MB`,
    ),
});

export type AvatarUploadInput = z.infer<typeof avatarUploadSchema>;

/** Confirms a completed direct-to-R2 upload so the DB row can be updated. */
export const finalizeAvatarSchema = z.object({
  key: z.string().min(1, "Missing upload key"),
});

export type FinalizeAvatarInput = z.infer<typeof finalizeAvatarSchema>;
