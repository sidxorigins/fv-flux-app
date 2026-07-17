import type { Attachment, Comment, User } from "@/generated/prisma/client";

/** Author fields safe to expose to the client — never hashedPassword/email/etc. */
export type CommentAuthor = Pick<User, "id" | "name" | "username" | "avatarKey">;

/**
 * A comment's attachment as shown under it (file list + inline-image resolution).
 * The raw R2 `key` is deliberately absent — bytes are served only via the
 * authorised `/api/files/<id>` route, never by exposing the key.
 */
export type CommentAttachment = Pick<
  Attachment,
  "id" | "filename" | "contentType" | "size" | "uploaderId"
>;

/** A comment hydrated with its author and attachments, as returned by `getComments`. */
export type CommentWithAuthor = Comment & {
  author: CommentAuthor;
  attachments: CommentAttachment[];
};
