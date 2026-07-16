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

export const addCommentSchema = z.object({
  taskId: idSchema,
  body: bodySchema,
});

export const updateCommentSchema = z.object({
  commentId: idSchema,
  body: bodySchema,
});

export const deleteCommentSchema = z.object({
  commentId: idSchema,
});

export type AddCommentInput = z.infer<typeof addCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
export type DeleteCommentInput = z.infer<typeof deleteCommentSchema>;
