// Attachment Zod schemas — the single source of truth reused on client and
// server. Limits/allowlist come from lib/r2 (via the client-safe constants
// re-export), never redefined here.

import { z } from "zod";

import { ATTACHMENT_ALLOWED_TYPES, ATTACHMENT_MAX_BYTES } from "./constants";

const idSchema = z.string().min(1, "Missing id");

const filenameSchema = z
  .string()
  .trim()
  .min(1, "Filename is required")
  .max(255, "Filename is too long");

// Allowlist enforced server-side: only the R2-approved content types get past
// validation, no matter what the client claims.
const contentTypeSchema = z.enum(ATTACHMENT_ALLOWED_TYPES, {
  error: "Unsupported file type",
});

const sizeSchema = z
  .number()
  .int()
  .positive("File is empty")
  .max(ATTACHMENT_MAX_BYTES, "File exceeds the 25 MB limit");

/** Step 1 — client asks for a presigned PUT before uploading bytes to R2. */
export const requestUploadSchema = z.object({
  taskId: idSchema,
  filename: filenameSchema,
  contentType: contentTypeSchema,
  size: sizeSchema,
});

/** Step 2 — after the direct-to-R2 upload succeeds, persist the metadata row. */
export const finalizeSchema = z.object({
  taskId: idSchema,
  key: z.string().min(1, "Missing key"),
  filename: filenameSchema,
  contentType: contentTypeSchema,
  size: sizeSchema,
});

export const deleteSchema = z.object({
  attachmentId: idSchema,
});

export type RequestUploadInput = z.infer<typeof requestUploadSchema>;
export type FinalizeInput = z.infer<typeof finalizeSchema>;
export type DeleteInput = z.infer<typeof deleteSchema>;
