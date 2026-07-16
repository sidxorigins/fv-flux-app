// Cloudflare R2 (S3-compatible) client + presigned-URL helpers.
//
// The private bucket is never public — bytes move directly between the browser and
// R2 via short-lived presigned URLs; the app server only mints URLs and stores
// metadata (the Attachment row). Uploads are presigned PUTs; downloads/previews are
// presigned GETs. See CLAUDE.md "File Attachments".

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { sanitizePlainText } from "@/lib/sanitize";

// ── Limits & allowlists (enforce server-side before presigning) ──────────────

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// Allowlist, not blocklist. SVG is deliberately EXCLUDED — it can carry scripts
// and is an XSS vector when served/rendered inline.
export const ATTACHMENT_ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/zip",
] as const;

export const AVATAR_ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type AttachmentContentType = (typeof ATTACHMENT_ALLOWED_TYPES)[number];
export type AvatarContentType = (typeof AVATAR_ALLOWED_TYPES)[number];

const PRESIGN_EXPIRY_SECONDS = 10 * 60; // 10 minutes

// ── Lazy client so the app builds with empty env; fails loudly only on use ────

let cachedClient: S3Client | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `R2 is not configured: missing environment variable ${name}. ` +
        "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.",
    );
  }
  return value;
}

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  const accountId = requireEnv("R2_ACCOUNT_ID");
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return cachedClient;
}

function bucket(): string {
  return requireEnv("R2_BUCKET");
}

// ── Object-key construction ──────────────────────────────────────────────────

/**
 * Reduce a user-supplied filename to a safe last path segment: basename only
 * (path separators stripped), control chars removed, unsafe chars collapsed to
 * `_`, no leading dots. Never used to build the *directory* portion of a key —
 * that comes from trusted ids + a random UUID.
 */
function safeObjectName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "file";
  const cleaned = sanitizePlainText(base, 200)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned : "file";
}

/** `tasks/<taskId>/<uuid>/<sanitised-basename>` — the UUID guarantees uniqueness. */
export function buildAttachmentKey(taskId: string, filename: string): string {
  return `tasks/${taskId}/${randomUUID()}/${safeObjectName(filename)}`;
}

/** `avatars/<userId>/<uuid>` — replace-then-delete the old key on avatar change. */
export function buildAvatarKey(userId: string): string {
  return `avatars/${userId}/${randomUUID()}`;
}

// ── Presigned URLs ───────────────────────────────────────────────────────────

/**
 * Presigned PUT for a direct browser upload. Signing ContentType and
 * ContentLength binds the upload to exactly what was authorised — the client
 * cannot swap the type or exceed the declared size without invalidating the URL.
 */
export function presignUploadUrl(
  key: string,
  contentType: string,
  contentLength: number,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(getClient(), command, {
    expiresIn: PRESIGN_EXPIRY_SECONDS,
  });
}

/**
 * Presigned GET for download/preview. When `filename` is given, forces a
 * Content-Disposition: attachment with a sanitised, quote-safe filename.
 */
export function presignDownloadUrl(
  key: string,
  filename?: string,
): Promise<string> {
  let contentDisposition: string | undefined;
  if (filename) {
    const safe = safeObjectName(filename);
    contentDisposition = `attachment; filename="${safe}"`;
  }
  const command = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    ResponseContentDisposition: contentDisposition,
  });
  return getSignedUrl(getClient(), command, {
    expiresIn: PRESIGN_EXPIRY_SECONDS,
  });
}

// ── Deletion (tolerant of partial failure) ───────────────────────────────────

export interface DeleteObjectsResult {
  deleted: string[];
  failed: string[];
}

/**
 * Delete keys in batches (DeleteObjects caps at 1000 per call). Returns which
 * keys were deleted and which failed so callers can retry / enqueue an orphan
 * cleanup rather than throwing on a single bad key. Never throws for partial
 * failure; a whole-batch transport error marks that batch's keys as failed.
 */
export async function deleteObjects(
  keys: string[],
): Promise<DeleteObjectsResult> {
  const deleted: string[] = [];
  const failed: string[] = [];
  if (keys.length === 0) return { deleted, failed };

  const client = getClient();
  const bucketName = bucket();

  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    try {
      const res = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: false },
        }),
      );
      for (const d of res.Deleted ?? []) if (d.Key) deleted.push(d.Key);
      for (const e of res.Errors ?? []) if (e.Key) failed.push(e.Key);
    } catch {
      failed.push(...batch);
    }
  }

  return { deleted, failed };
}
