// Client-side upload pipeline for comment composer files (inline images + tray
// attachments). Three steps, all reusing the task-attachment infrastructure:
//   1. requestAttachmentUpload → presigned PUT (MEMBER+ authorised server-side)
//   2. PUT the bytes straight to R2
//   3. finalizeCommentUpload → create a DRAFT Attachment row (commentId null),
//      returns its id so the composer can reference it inline / in its tray.
// The comment is posted later via addComment, which links these drafts.

// Import from the specific modules, NOT the feature barrel: the barrel re-exports
// the server-only queries (Prisma), which would pull node-only code into this
// client-consumed util. Server Actions ("use server") are safe to import here.
import {
  ATTACHMENT_ALLOWED_TYPES,
  ATTACHMENT_MAX_BYTES,
} from "@/features/attachments/constants";
import {
  requestCommentUpload,
  finalizeCommentUpload,
} from "@/features/attachments/actions";

/** Inline-image content types (subset of the attachment allowlist). */
export const COMMENT_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export function isImageType(type: string): boolean {
  return (COMMENT_IMAGE_TYPES as readonly string[]).includes(type);
}

export type CommentUploadResult =
  | { ok: true; id: string; contentType: string; filename: string; size: number }
  | { ok: false; error: string };

/** Fast client-side pre-check mirroring the server limits (friendly rejects). */
export function precheckFile(file: File): string | null {
  if (!(ATTACHMENT_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return `"${file.name}" is not an allowed file type.`;
  }
  if (file.size <= 0) return `"${file.name}" is empty.`;
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return `"${file.name}" exceeds the 25 MB limit.`;
  }
  return null;
}

/**
 * PUT a file to a presigned URL with optional progress. `fetch` can't report
 * upload progress, so we use XMLHttpRequest. The Content-Type MUST match what the
 * presigned URL was signed with. (Kept local rather than shared with
 * AttachmentSection to avoid coupling the two features.)
 */
function putWithProgress(
  url: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    if (onProgress) {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      });
    }
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (HTTP ${xhr.status})`));
    });
    xhr.addEventListener("error", () =>
      reject(new Error("Network error during upload")),
    );
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
    xhr.send(file);
  });
}

/**
 * Run the full request → PUT → finalize pipeline for one file, producing a draft
 * Attachment id. Returns a discriminated result; never throws.
 */
export async function uploadCommentFile(
  taskId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<CommentUploadResult> {
  const precheck = precheckFile(file);
  if (precheck) return { ok: false, error: precheck };

  try {
    const requested = await requestCommentUpload({
      taskId,
      filename: file.name,
      contentType: file.type,
      size: file.size,
    });
    if (!requested.ok || !requested.data) {
      return { ok: false, error: requested.ok ? "Upload failed." : requested.error };
    }

    await putWithProgress(requested.data.uploadUrl, file, onProgress);

    const finalized = await finalizeCommentUpload({
      taskId,
      key: requested.data.key,
      filename: file.name,
      contentType: file.type,
      size: file.size,
    });
    if (!finalized.ok || !finalized.data) {
      return { ok: false, error: finalized.ok ? "Upload failed." : finalized.error };
    }

    return {
      ok: true,
      id: finalized.data.id,
      contentType: finalized.data.contentType,
      filename: file.name,
      size: file.size,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upload failed." };
  }
}
