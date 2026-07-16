"use client";

// Avatar upload widget: presigned-PUT direct-to-R2 upload with a progress
// indicator, plus a remove option. Flow (per CLAUDE.md "File Attachments" /
// "User Profiles"): requestAvatarUpload (Server Action, mints a presigned
// PUT) → XHR PUT straight to R2 → finalizeAvatar (Server Action, swaps the
// user's avatarKey and cleans up the old object) → router.refresh().
//
// `allowedTypes` / `maxBytes` are passed down from the server (profile
// page reads them from @/lib/r2) rather than imported here directly — that
// module pulls in the AWS SDK and `node:crypto`, which must never enter the
// client bundle.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Loader2 } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  finalizeAvatar,
  removeAvatar,
  requestAvatarUpload,
} from "@/features/users/actions";

interface AvatarUploaderProps {
  name: string;
  avatarUrl: string | null;
  allowedTypes: readonly string[];
  maxBytes: number;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

function formatMaxSize(maxBytes: number): string {
  return `${Math.floor(maxBytes / (1024 * 1024))}MB`;
}

/** Direct browser → R2 PUT with progress, via the presigned URL from the server. */
function uploadWithProgress(
  uploadUrl: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed with status ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}

export function AvatarUploader({
  name,
  avatarUrl,
  allowedTypes,
  maxBytes,
}: AvatarUploaderProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [isRemoving, startRemoveTransition] = useTransition();

  const displayUrl = preview ?? avatarUrl;
  const canRemove = Boolean(avatarUrl) && !preview;

  function openPicker() {
    if (!uploading) inputRef.current?.click();
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    if (!allowedTypes.includes(file.type)) {
      toast.error("Unsupported file type. Use PNG, JPEG, or WebP.");
      return;
    }
    if (file.size > maxBytes) {
      toast.error(`File is too large. Max ${formatMaxSize(maxBytes)}.`);
      return;
    }

    const localPreview = URL.createObjectURL(file);
    setPreview(localPreview);
    setUploading(true);
    setProgress(0);

    try {
      const requested = await requestAvatarUpload({
        contentType: file.type,
        size: file.size,
      });
      if (!requested.ok || !requested.data) {
        toast.error(requested.ok ? "Could not prepare upload." : requested.error);
        return;
      }

      await uploadWithProgress(requested.data.uploadUrl, file, setProgress);

      const finalized = await finalizeAvatar({ key: requested.data.key });
      if (!finalized.ok) {
        toast.error(finalized.error);
        return;
      }

      toast.success("Avatar updated");
      router.refresh();
    } catch {
      toast.error("Could not upload avatar. Please try again.");
    } finally {
      setUploading(false);
      setProgress(0);
      setPreview((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
    }
  }

  function handleRemove() {
    startRemoveTransition(async () => {
      const result = await removeAvatar();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Avatar removed");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-4">
      <div className="group/avatar-uploader relative shrink-0">
        <Avatar className="size-20">
          {displayUrl ? <AvatarImage src={displayUrl} alt="" /> : null}
          <AvatarFallback className="bg-surface-raised text-lg font-medium text-foreground">
            {initialsFor(name)}
          </AvatarFallback>
        </Avatar>

        <button
          type="button"
          onClick={openPicker}
          disabled={uploading}
          aria-label="Change avatar"
          className={cn(
            "absolute inset-0 flex items-center justify-center rounded-full bg-black/60 opacity-0",
            "transition-opacity duration-150 group-hover/avatar-uploader:opacity-100 focus-visible:opacity-100",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            "disabled:cursor-not-allowed motion-reduce:transition-none",
          )}
        >
          {uploading ? (
            <Loader2 aria-hidden className="size-5 animate-spin text-white" />
          ) : (
            <span className="flex flex-col items-center gap-1 text-white">
              <Camera aria-hidden className="size-4" />
              <span className="text-[11px] font-medium">Change</span>
            </span>
          )}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept={allowedTypes.join(",")}
          onChange={handleFileChange}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          PNG, JPEG, or WebP. Up to {formatMaxSize(maxBytes)}.
        </p>

        {canRemove ? (
          <button
            type="button"
            onClick={handleRemove}
            disabled={isRemoving || uploading}
            className="w-fit text-left text-sm font-medium text-danger transition-opacity duration-150 hover:opacity-80 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
          >
            {isRemoving ? "Removing…" : "Remove avatar"}
          </button>
        ) : null}

        {uploading ? (
          <div
            role="progressbar"
            aria-label="Upload progress"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1 w-40 overflow-hidden rounded-full bg-surface-raised"
          >
            <div
              className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-150 ease-linear motion-reduce:transition-none"
              style={{ transform: `scaleX(${progress})` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
