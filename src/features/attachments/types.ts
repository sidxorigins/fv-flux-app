import type { Attachment, User } from "@/generated/prisma/client";

/** Uploader fields safe to expose to the client — never hashedPassword/email/etc. */
export type AttachmentUploader = Pick<
  User,
  "id" | "name" | "username" | "avatarKey"
>;

/**
 * An attachment hydrated with its uploader, as returned by `getAttachments`.
 * The raw R2 `key` is present for server logic but must NEVER be rendered as a
 * link — downloads go through a short-lived presigned URL (see actions.ts).
 */
export type AttachmentWithUploader = Attachment & {
  uploader: AttachmentUploader;
};
