"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";

import { RichTextEditor, type MentionItem } from "@/components/editor";
import { Button } from "@/components/ui/button";
// Specific modules, not the feature barrel (which re-exports server-only queries).
import { ATTACHMENT_ALLOWED_TYPES } from "@/features/attachments/constants";
import { discardCommentUpload } from "@/features/attachments/actions";
import { formatBytes, truncateMiddle } from "@/features/attachments/components/fileMeta";

import type { CommentWithAuthor } from "../types";
import { addComment } from "../actions";
import { extractInlineImageIds, hasCommentContent } from "../text";
import { uploadCommentFile } from "../upload";
import { CommentItem } from "./CommentItem";

/** A file attached to the draft (paperclip uploads), shown as a tray chip. */
type TrayFile = { id: string; filename: string; size: number };

export interface CommentSectionProps {
  taskId: string;
  comments: CommentWithAuthor[];
  currentUserId: string;
  /** MEMBER+ on this project — controls whether the composer is shown. */
  canComment: boolean;
  /**
   * Project MANAGER (or global Admin). Enables the delete affordance on OTHER
   * users' comments. The author always sees edit/delete for their own. Hidden UI
   * is never the security boundary — `actions.ts` re-checks on the server.
   */
  canManage?: boolean;
  /** Project members offered by the @-mention autocomplete in the composer. */
  mentionItems?: MentionItem[];
}

/**
 * Comment thread + composer for the task drawer. The composer supports inline
 * images (paste / drop / toolbar button → uploaded and embedded) and file
 * attachments (paperclip → tray chips). Both upload as DRAFT attachments during
 * composition; `addComment` links them to the new comment on post. Server
 * Components fetch `comments`; mutations refresh via `router.refresh()`.
 */
export function CommentSection({
  taskId,
  comments,
  currentUserId,
  canComment,
  canManage = false,
  mentionItems,
}: CommentSectionProps) {
  const router = useRouter();
  const [draft, setDraft] = React.useState("");
  const [inlineIds, setInlineIds] = React.useState<string[]>([]);
  const [trayFiles, setTrayFiles] = React.useState<TrayFile[]>([]);
  const [uploading, setUploading] = React.useState(0);
  const [pending, startTransition] = React.useTransition();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const attachmentCount = inlineIds.length + trayFiles.length;
  const canPost = hasCommentContent(draft, trayFiles.length);
  const busy = pending || uploading > 0;

  // Inline-image upload for the editor: upload → track id → return it to embed.
  const onImageUpload = React.useCallback(
    async (file: File): Promise<string | null> => {
      setUploading((n) => n + 1);
      const res = await uploadCommentFile(taskId, file);
      setUploading((n) => n - 1);
      if (!res.ok) {
        toast.error(res.error);
        return null;
      }
      setInlineIds((prev) => [...prev, res.id]);
      return res.id;
    },
    [taskId],
  );

  // When the body changes, discard any inline image the user removed from the
  // text (its draft upload is no longer referenced).
  const onDraftChange = React.useCallback((html: string) => {
    setDraft(html);
    const present = new Set(extractInlineImageIds(html));
    setInlineIds((prev) => {
      const removed = prev.filter((id) => !present.has(id));
      if (removed.length === 0) return prev;
      for (const id of removed) void discardCommentUpload(id);
      return prev.filter((id) => present.has(id));
    });
  }, []);

  const attachFile = React.useCallback(
    async (file: File) => {
      setUploading((n) => n + 1);
      const res = await uploadCommentFile(taskId, file);
      setUploading((n) => n - 1);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setTrayFiles((prev) => [
        ...prev,
        { id: res.id, filename: res.filename, size: res.size },
      ]);
    },
    [taskId],
  );

  function onAttachChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    for (const file of files) void attachFile(file);
  }

  function removeTrayFile(id: string) {
    setTrayFiles((prev) => prev.filter((f) => f.id !== id));
    void discardCommentUpload(id);
  }

  function submit() {
    if (busy || !canPost) return;
    const body = draft;
    const attachmentIds = [...inlineIds, ...trayFiles.map((f) => f.id)];
    const keptInline = inlineIds;
    const keptTray = trayFiles;
    // Optimistic clear.
    setDraft("");
    setInlineIds([]);
    setTrayFiles([]);
    startTransition(async () => {
      const res = await addComment({ taskId, body, attachmentIds });
      if (!res.ok) {
        toast.error(res.error);
        setDraft(body); // restore so the user doesn't lose their work
        setInlineIds(keptInline);
        setTrayFiles(keptTray);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {comments.length > 0 ? (
        <ul className="space-y-4">
          {comments.map((comment) => (
            <li key={comment.id}>
              <CommentItem
                comment={comment}
                canEdit={comment.authorId === currentUserId}
                canDelete={comment.authorId === currentUserId || canManage}
                mentionItems={mentionItems}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      )}

      {canComment ? (
        <div className="space-y-2">
          <RichTextEditor
            value={draft}
            onChange={onDraftChange}
            minHeight="80px"
            placeholder="Add a comment… @ to mention, paste or drop an image"
            mentionItems={mentionItems}
            onImageUpload={onImageUpload}
            showEmoji
          />

          {trayFiles.length > 0 ? (
            <ul className="space-y-1">
              {trayFiles.map((file) => (
                <li
                  key={file.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5"
                >
                  <Paperclip
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-sm text-foreground"
                    title={file.filename}
                  >
                    {truncateMiddle(file.filename)}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatBytes(file.size)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 text-muted-foreground hover:text-danger"
                    aria-label={`Remove ${file.filename}`}
                    onClick={() => removeTrayFile(file.id)}
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                accept={ATTACHMENT_ALLOWED_TYPES.join(",")}
                onChange={onAttachChange}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={pending}
              >
                <Paperclip aria-hidden />
                Attach
              </Button>
              {uploading > 0 ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                    aria-hidden
                  />
                  Uploading…
                </span>
              ) : null}
            </div>
            <Button size="sm" onClick={submit} disabled={busy || !canPost}>
              {pending ? "Posting…" : "Comment"}
              {attachmentCount > 0 ? ` (${attachmentCount})` : ""}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
