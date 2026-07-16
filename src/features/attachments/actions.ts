"use server";

// Attachment Server Actions. Bytes NEVER pass through the app server — the
// browser uploads directly to R2 via a presigned PUT and downloads via a
// presigned GET. The server only authorises, mints URLs, and stores metadata.
// See CLAUDE.md "File Attachments".
//
// Authorisation:
//   - request/finalize: MEMBER+ on the task's project (upload = content edit).
//   - download:         VIEWER+ (read).
//   - delete:           UPLOADER or project MANAGER (global Admin → MANAGER).

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import {
  AuthorizationError,
  PROJECT_ROLE_ORDER,
  requireProjectRole,
} from "@/lib/permissions";
import {
  buildAttachmentKey,
  deleteObjects,
  presignDownloadUrl,
  presignUploadUrl,
} from "@/lib/r2";

import { deleteSchema, finalizeSchema, requestUploadSchema } from "./schemas";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function toError(err: unknown): { ok: false; error: string } {
  if (err instanceof AuthorizationError) {
    switch (err.code) {
      case "UNAUTHENTICATED":
        return { ok: false, error: "You need to sign in." };
      case "SUSPENDED":
        return { ok: false, error: "Your account has been suspended." };
      default:
        return { ok: false, error: "You don't have permission to do that." };
    }
  }
  return { ok: false, error: "Something went wrong. Please try again." };
}

function revalidate(): void {
  revalidatePath("/dashboard");
}

/**
 * Step 1: authorise + mint a short-lived presigned PUT. `presignUploadUrl` signs
 * the ContentType and ContentLength, so the client can't upload a different type
 * or exceed the declared size without invalidating the URL.
 */
export async function requestAttachmentUpload(
  input: unknown,
): Promise<ActionResult<{ uploadUrl: string; key: string }>> {
  const parsed = requestUploadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid file" };
  }
  const { taskId, filename, contentType, size } = parsed.data;

  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    if (!task) return { ok: false, error: "Task not found." };

    await requireProjectRole(task.projectId, "MEMBER");

    // Key is derived server-side from trusted ids + a random UUID + a sanitised
    // basename — the client never chooses the storage path.
    const key = buildAttachmentKey(taskId, filename);
    const uploadUrl = await presignUploadUrl(key, contentType, size);

    return { ok: true, data: { uploadUrl, key } };
  } catch (err) {
    return toError(err);
  }
}

/**
 * Step 2: after the direct-to-R2 upload, persist the Attachment row.
 *
 * HEAD verification: intentionally NOT performed. `lib/r2` exposes no HEAD helper
 * nor its S3 client, and this feature must not reconstruct one (that would
 * duplicate the endpoint/credential/env logic lib/r2 encapsulates). The safety
 * that matters is covered without it: the presigned PUT bound ContentType +
 * ContentLength, and the key-prefix check below blocks finalising a foreign key.
 * A row whose object failed to upload is a benign broken preview, not a security
 * issue.
 */
export async function finalizeAttachment(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid file" };
  }
  const { taskId, key, filename, contentType, size } = parsed.data;

  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    if (!task) return { ok: false, error: "Task not found." };

    const { user } = await requireProjectRole(task.projectId, "MEMBER");

    // The client cannot finalise a key it doesn't own: it must live under this
    // task's prefix (the same prefix `buildAttachmentKey` produces).
    if (!key.startsWith(`tasks/${taskId}/`)) {
      return { ok: false, error: "Invalid attachment key." };
    }

    const attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: { taskId, uploaderId: user.id, key, filename, contentType, size },
      });
      await tx.activityLog.create({
        data: {
          taskId,
          actorId: user.id,
          action: "attached",
          newValue: filename,
        },
      });
      return created;
    });

    revalidate();
    return { ok: true, data: { id: attachment.id } };
  } catch (err) {
    return toError(err);
  }
}

/**
 * Mint a short-lived presigned GET for download/preview. Generated on demand and
 * never stored — the raw R2 key is never exposed to the client (CLAUDE.md).
 */
export async function getAttachmentDownloadUrl(
  attachmentId: string,
): Promise<ActionResult<{ url: string }>> {
  if (typeof attachmentId !== "string" || attachmentId.length === 0) {
    return { ok: false, error: "Invalid attachment." };
  }

  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        key: true,
        filename: true,
        task: { select: { projectId: true } },
      },
    });
    if (!attachment) return { ok: false, error: "Attachment not found." };

    await requireProjectRole(attachment.task.projectId, "VIEWER");

    const url = await presignDownloadUrl(attachment.key, attachment.filename);
    return { ok: true, data: { url } };
  } catch (err) {
    return toError(err);
  }
}

/**
 * Delete an attachment: remove the DB row (+ activity) in a transaction, then
 * delete the R2 object. If the R2 delete fails, the row is still gone but we
 * write an AuditLog breadcrumb so the orphaned bytes can be cleaned up later
 * (CLAUDE.md "Lifecycle").
 */
export async function deleteAttachment(
  attachmentId: string,
): Promise<ActionResult> {
  const parsed = deleteSchema.safeParse({ attachmentId });
  if (!parsed.success) {
    return { ok: false, error: "Invalid attachment." };
  }

  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: parsed.data.attachmentId },
      select: {
        id: true,
        key: true,
        filename: true,
        uploaderId: true,
        task: { select: { id: true, projectId: true } },
      },
    });
    if (!attachment) return { ok: false, error: "Attachment not found." };

    const { user, role } = await requireProjectRole(
      attachment.task.projectId,
      "VIEWER",
    );
    const isUploader = attachment.uploaderId === user.id;
    const isManager = PROJECT_ROLE_ORDER[role] >= PROJECT_ROLE_ORDER.MANAGER;
    if (!isUploader && !isManager) {
      return {
        ok: false,
        error: "You don't have permission to delete this attachment.",
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.attachment.delete({ where: { id: attachment.id } });
      await tx.activityLog.create({
        data: {
          taskId: attachment.task.id,
          actorId: user.id,
          action: "attachment_deleted",
          oldValue: attachment.filename,
        },
      });
    });

    const result = await deleteObjects([attachment.key]);
    if (result.failed.length > 0) {
      // Row is gone but the bytes remain — leave a breadcrumb for orphan cleanup.
      await prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: "attachment.r2_delete_failed",
          targetType: "Attachment",
          targetId: attachment.id,
          metadata: { key: attachment.key },
        },
      });
    }

    revalidate();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}
