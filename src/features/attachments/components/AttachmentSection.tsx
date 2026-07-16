"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Paperclip, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

import {
  ATTACHMENT_ALLOWED_TYPES,
  ATTACHMENT_MAX_BYTES,
} from "../constants";
import type { AttachmentWithUploader } from "../types";
import {
  deleteAttachment,
  finalizeAttachment,
  getAttachmentDownloadUrl,
  requestAttachmentUpload,
} from "../actions";
import {
  formatBytes,
  iconForContentType,
  sanitizeFilename,
  truncateMiddle,
} from "./fileMeta";
import { TimeAgo } from "./TimeAgo";

/** Transient in-flight / failed upload (successful ones are dropped after refresh). */
type UploadItem = {
  id: string;
  filename: string;
  size: number;
  progress: number; // 0..1
  status: "uploading" | "error";
  error?: string;
};

/**
 * PUT a file to a presigned URL with progress. `fetch` can't report upload
 * progress, so we use XMLHttpRequest for its `upload.progress` events. The
 * Content-Type must match what the presigned URL was signed with.
 */
function putWithProgress(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (HTTP ${xhr.status})`));
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
    xhr.send(file);
  });
}

/** Client-side pre-check mirroring the server limits (fast, friendly rejects). */
function precheck(file: File): string | null {
  if (!(ATTACHMENT_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return `"${file.name}" is not an allowed file type.`;
  }
  if (file.size <= 0) return `"${file.name}" is empty.`;
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return `"${file.name}" exceeds the ${formatBytes(ATTACHMENT_MAX_BYTES)} limit.`;
  }
  return null;
}

export interface AttachmentSectionProps {
  taskId: string;
  attachments: AttachmentWithUploader[];
  currentUserId: string;
  /** MEMBER+ — controls whether upload (button + drag-drop) is available. */
  canUpload: boolean;
  /** MANAGER (or global Admin) — may delete other users' attachments. */
  canManage: boolean;
}

/**
 * Attachment list + uploader for the task drawer. Compact, drawer-density
 * spacing. Uploads go straight to R2 (presigned PUT); the app only mints URLs
 * and stores metadata. Downloads fetch a fresh presigned GET on demand.
 */
export function AttachmentSection({
  taskId,
  attachments,
  currentUserId,
  canUpload,
  canManage,
}: AttachmentSectionProps) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = React.useState<UploadItem[]>([]);
  const [dragActive, setDragActive] = React.useState(false);
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  // Sequential upload queue so multiple files don't hammer R2/DB at once.
  const runningRef = React.useRef(false);
  const queueRef = React.useRef<File[]>([]);

  const patchUpload = React.useCallback(
    (id: string, patch: Partial<UploadItem>) => {
      setUploads((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
    },
    [],
  );

  const processQueue = React.useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const file = queueRef.current.shift();
        if (!file) break;
        const id = crypto.randomUUID();
        setUploads((prev) => [
          ...prev,
          {
            id,
            filename: file.name,
            size: file.size,
            progress: 0,
            status: "uploading",
          },
        ]);

        try {
          const requested = await requestAttachmentUpload({
            taskId,
            filename: file.name,
            contentType: file.type,
            size: file.size,
          });
          if (!requested.ok || !requested.data) {
            const message = requested.ok ? "Upload failed." : requested.error;
            patchUpload(id, { status: "error", error: message });
            toast.error(message);
            continue;
          }

          await putWithProgress(requested.data.uploadUrl, file, (fraction) =>
            patchUpload(id, { progress: fraction }),
          );

          const finalized = await finalizeAttachment({
            taskId,
            key: requested.data.key,
            filename: file.name,
            contentType: file.type,
            size: file.size,
          });
          if (!finalized.ok) {
            patchUpload(id, { status: "error", error: finalized.error });
            toast.error(finalized.error);
            continue;
          }

          // Success: drop the transient row; the refreshed list shows the real one.
          setUploads((prev) => prev.filter((item) => item.id !== id));
          router.refresh();
        } catch (err) {
          const message = err instanceof Error ? err.message : "Upload failed.";
          patchUpload(id, { status: "error", error: message });
          toast.error(message);
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, [taskId, router, patchUpload]);

  const enqueue = React.useCallback(
    (files: FileList | File[]) => {
      const accepted: File[] = [];
      for (const file of Array.from(files)) {
        const error = precheck(file);
        if (error) {
          toast.error(error);
          continue;
        }
        accepted.push(file);
      }
      if (accepted.length === 0) return;
      queueRef.current.push(...accepted);
      void processQueue();
    },
    [processQueue],
  );

  function onInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files) enqueue(event.target.files);
    event.target.value = ""; // allow re-selecting the same file
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragActive(false);
    if (!canUpload) return;
    if (event.dataTransfer.files) enqueue(event.dataTransfer.files);
  }

  function onDragOver(event: React.DragEvent) {
    event.preventDefault();
    if (canUpload && !dragActive) setDragActive(true);
  }

  function onDragLeave(event: React.DragEvent) {
    event.preventDefault();
    if (event.currentTarget === event.target) setDragActive(false);
  }

  async function handleDownload(id: string) {
    if (downloadingId) return;
    setDownloadingId(id);
    try {
      const res = await getAttachmentDownloadUrl(id);
      if (!res.ok || !res.data) {
        if (!res.ok) toast.error(res.error);
        return;
      }
      // Presigned GET forces Content-Disposition: attachment, so this downloads.
      const anchor = document.createElement("a");
      anchor.href = res.data.url;
      anchor.rel = "noopener noreferrer";
      anchor.target = "_blank";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await deleteAttachment(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  const isEmpty = attachments.length === 0 && uploads.length === 0;

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={cn(
        // Dashed border is always present (reserved space, no layout shift) and
        // only its colour changes on dragover — transition-colors is paint-only.
        "space-y-2 rounded-lg border border-dashed p-2 transition-colors duration-150 motion-reduce:transition-none",
        dragActive ? "border-primary bg-primary/5" : "border-transparent",
      )}
    >
      {isEmpty ? (
        <p className="px-1 py-1 text-sm text-muted-foreground">
          {canUpload ? "Drop files here, or use Upload." : "No attachments."}
        </p>
      ) : (
        <ul className="space-y-1">
          {attachments.map((attachment) => {
            const Icon = iconForContentType(attachment.contentType);
            const name = sanitizeFilename(attachment.filename);
            const canRemove =
              canManage || attachment.uploaderId === currentUserId;
            return (
              <li
                key={attachment.id}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-raised"
              >
                <Icon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <button
                  type="button"
                  onClick={() => handleDownload(attachment.id)}
                  disabled={downloadingId === attachment.id}
                  title={name}
                  className="min-w-0 flex-1 truncate text-left text-sm text-foreground hover:text-primary hover:underline disabled:opacity-60"
                >
                  {truncateMiddle(name)}
                </button>
                {downloadingId === attachment.id ? (
                  <Loader2
                    className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
                    aria-hidden
                  />
                ) : null}
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatBytes(attachment.size)}
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  {attachment.uploader.name}
                </span>
                <TimeAgo
                  date={attachment.createdAt}
                  className="hidden shrink-0 text-xs text-muted-foreground sm:inline"
                />
                {canRemove ? (
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="shrink-0 text-muted-foreground hover:text-danger"
                          aria-label={`Delete ${name}`}
                        />
                      }
                    >
                      <Trash2 aria-hidden />
                    </AlertDialogTrigger>
                    <AlertDialogContent size="sm">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete attachment?</AlertDialogTitle>
                        <AlertDialogDescription>
                          &ldquo;{truncateMiddle(name, 40)}&rdquo; will be
                          permanently removed.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => handleDelete(attachment.id)}
                          disabled={deletingId === attachment.id}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}
              </li>
            );
          })}

          {uploads.map((item) => (
            <li key={item.id} className="space-y-1 rounded-md px-2 py-1.5">
              <div className="flex items-center gap-2.5">
                <Paperclip
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span
                  className="min-w-0 flex-1 truncate text-sm text-foreground"
                  title={item.filename}
                >
                  {truncateMiddle(sanitizeFilename(item.filename))}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {item.status === "error"
                    ? "Failed"
                    : `${Math.round(item.progress * 100)}%`}
                </span>
                {item.status === "error" ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 text-muted-foreground"
                    aria-label="Dismiss"
                    onClick={() =>
                      setUploads((prev) =>
                        prev.filter((upload) => upload.id !== item.id),
                      )
                    }
                  >
                    <X aria-hidden />
                  </Button>
                ) : null}
              </div>
              {/* Thin progress bar — width via transform: scaleX, never width. */}
              <div
                className="h-0.5 w-full overflow-hidden rounded-full bg-border"
                role="progressbar"
                aria-valuenow={Math.round(item.progress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className={cn(
                    "h-full origin-left rounded-full transition-transform duration-150 motion-reduce:transition-none",
                    item.status === "error" ? "bg-danger" : "bg-primary",
                  )}
                  style={{
                    transform: `scaleX(${item.status === "error" ? 1 : item.progress})`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {canUpload ? (
        <div className="flex items-center gap-2 px-1">
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept={ATTACHMENT_ALLOWED_TYPES.join(",")}
            onChange={onInputChange}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
            <Upload aria-hidden />
            Upload
          </Button>
          <span className="text-xs text-muted-foreground">
            Max {formatBytes(ATTACHMENT_MAX_BYTES)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
