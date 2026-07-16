import type { Comment, User } from "@/generated/prisma/client";

/** Author fields safe to expose to the client — never hashedPassword/email/etc. */
export type CommentAuthor = Pick<User, "id" | "name" | "username" | "avatarKey">;

/** A comment hydrated with its author, as returned by `getComments`. */
export type CommentWithAuthor = Comment & {
  author: CommentAuthor;
};
