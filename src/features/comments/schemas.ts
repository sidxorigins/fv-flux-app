// Comment Zod schemas — the single source of truth reused on client and server.
// The `body` bound (1–20 000 chars) is validated against the RAW editor HTML at
// the boundary; the server additionally sanitises (lib/sanitize) and rejects a
// result that is blank once tags are stripped (see actions.ts).

import { z } from "zod";

/** Task/Comment ids are Prisma cuids — treated as opaque non-empty strings. */
const idSchema = z.string().min(1, "Missing id");

const bodySchema = z
  .string()
  .min(1, "Comment can't be empty")
  .max(20000, "Comment is too long");

/**
 * Ids of draft uploads (Attachment rows with `commentId` null) to attach to this
 * comment. Bounded to keep a single comment from linking an unreasonable number
 * of files; validated further server-side (must belong to the task, still be an
 * unlinked draft, and be the caller's own upload).
 */
const attachmentIdsSchema = z
  .array(idSchema)
  .max(20, "Too many attachments")
  .optional()
  .default([]);

export const addCommentSchema = z.object({
  taskId: idSchema,
  body: bodySchema,
  attachmentIds: attachmentIdsSchema,
});

export const updateCommentSchema = z.object({
  commentId: idSchema,
  body: bodySchema,
  attachmentIds: attachmentIdsSchema,
});

export const deleteCommentSchema = z.object({
  commentId: idSchema,
});

/** Toggle a reaction on a comment. The reacting user is always the SESSION user. */
export const reactionSchema = z.object({
  commentId: z.string().min(1),
  emoji: z.string().min(1).max(32),
});

export type AddCommentInput = z.infer<typeof addCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
export type DeleteCommentInput = z.infer<typeof deleteCommentSchema>;
export type ReactionInput = z.infer<typeof reactionSchema>;
